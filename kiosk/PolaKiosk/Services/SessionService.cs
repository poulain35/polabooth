using System.Collections.Concurrent;
using System.IO;
using Microsoft.EntityFrameworkCore;
using PolaKiosk.Models.LocalDb;

namespace PolaKiosk.Services;

/// <summary>
/// Séances photo (table Sessions) : enregistrement après le montage, envoi (R2 puis table photos)
/// et reprise des envois en attente.
/// </summary>
public class SessionService : ISessionService
{
    // Un seul envoi à la fois par séance : l'écran résultat et la reprise en arrière-plan ne doivent
    // jamais envoyer la même séance en parallèle (doublon en galerie). Verrou par séance (LAB-237) :
    // un clip envoyé en fond sur une 4G faible ne retient pas le QR de l'invité suivant. Quelques
    // centaines de séances par lancement au plus : les verrous ne sont pas retirés.
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> UploadLocks = new();

    private static SemaphoreSlim LockFor(Guid sessionId) => UploadLocks.GetOrAdd(sessionId, _ => new SemaphoreSlim(1, 1));

    private readonly AppDbContext       _db;
    private readonly ISupabaseService   _supabase;
    private readonly IKioskLogService   _log;
    private readonly SessionPathService _paths;

    public SessionService(AppDbContext db, ISupabaseService supabase, IKioskLogService log, SessionPathService paths)
    {
        _db       = db;
        _supabase = supabase;
        _log      = log;
        _paths    = paths;
    }

    public async Task<Guid> RecordSessionAsync(Guid sessionId, Guid eventId, DateTime capturedAtUtc,
        string photoPath, string compositePath, Action<AppDbContext>? stageInSameTransaction = null,
        Guid? templateId = null, AnimationClip? animation = null)
    {
        _db.Sessions.Add(NewSession(sessionId, eventId, capturedAtUtc, photoPath, compositePath, templateId, animation));
        stageInSameTransaction?.Invoke(_db);
        await _db.SaveChangesAsync();

        // Sans ce fichier, la galerie retrouve quand même la séance par son chemin en base.
        await TryWriteSessionIdAsync(compositePath, sessionId);
        return sessionId;
    }

    // ── Photo en attente (questionnaire obligatoire, LAB-222) ─────────────────────────────

    public async Task<string> CommitPendingSessionAsync(Guid sessionId, Guid eventId, string eventName,
        DateTime capturedAtUtc, string photoPath, string compositePath, Action<AppDbContext>? stageInSameTransaction = null,
        Guid? templateId = null, AnimationClip? animation = null)
    {
        var pendingDir     = _paths.GetPendingDirectory(sessionId);
        var eventDir       = _paths.GetEventDirectory(eventName, eventId);
        var finalPhoto     = MapToEventDirectory(photoPath, pendingDir, eventDir);
        var finalComposite = MapToEventDirectory(compositePath, pendingDir, eventDir);
        var finalAnimation = animation == null ? null : animation with
        {
            VideoPath  = MapToEventDirectory(animation.VideoPath, pendingDir, eventDir),
            PosterPath = MapToEventDirectory(animation.PosterPath, pendingDir, eventDir),
        };

        // 1. Une seule transaction : la séance (chemins définitifs) et ce que l'appelant y ajoute
        //    (réponse au questionnaire, LAB-225). Tant que les fichiers ne sont pas déplacés, la
        //    boucle d'envoi ignore la séance : son montage n'existe pas encore (File.Exists).
        var recorded = false;
        try
        {
            _db.Sessions.Add(NewSession(sessionId, eventId, capturedAtUtc, finalPhoto, finalComposite, templateId, finalAnimation));
            stageInSameTransaction?.Invoke(_db);
            await _db.SaveChangesAsync();
            recorded = true;
        }
        catch (Exception ex)
        {
            // Même repli que sans questionnaire : l'écran résultat rattachera la séance au montage.
            _db.ChangeTracker.Clear();
            await _log.LogErrorAsync("session",
                $"Enregistrement de la séance validée impossible (event {eventId}) : {ex.Message}", ex.ToString());
        }

        // 2. Déplacement vers originals\ et composites\ (même disque). Un échec est repris au démarrage.
        var failures = MovePendingFiles(pendingDir, eventDir);
        if (failures > 0)
            await _log.LogWarningAsync("session",
                $"{failures} fichier(s) de la séance validée non déplacé(s) : reprise au prochain démarrage.");

        var displayed = File.Exists(finalComposite) || !File.Exists(compositePath) ? finalComposite : compositePath;
        if (recorded) await TryWriteSessionIdAsync(displayed, sessionId);
        return displayed;
    }

    public bool DiscardPendingSession(Guid sessionId)
    {
        var dir = _paths.GetPendingDirectory(sessionId);
        try
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
            return true;
        }
        catch { return false; /* fichier verrouillé : le nettoyage du démarrage s'en charge */ }
    }

    public async Task<PendingCleanupResult> CleanupPendingAsync()
    {
        int completed = 0, discarded = 0, failed = 0;
        try
        {
            var root = _paths.GetPendingRoot();
            if (!Directory.Exists(root)) return new PendingCleanupResult(0, 0, 0);

            foreach (var dir in Directory.GetDirectories(root))
            {
                try
                {
                    SessionEntity? session = null;
                    if (Guid.TryParse(Path.GetFileName(dir), out var sessionId))
                        session = await _db.Sessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sessionId);

                    var eventDir = session == null ? null : EventDirectoryOf(session.PhotoPath);
                    if (session == null)
                    {
                        // Parcours jamais validé (crash ou coupure pendant le questionnaire) : supprimé.
                        Directory.Delete(dir, recursive: true);
                        discarded++;
                    }
                    else if (eventDir != null && MovePendingFiles(dir, eventDir) == 0)
                    {
                        // Validé, coupure avant la fin du déplacement : on le termine.
                        if (session.CompositePath != null && File.Exists(session.CompositePath)
                            && ShareInfoFile.Read(session.CompositePath)?.SessionId != session.Id)
                            await TryWriteSessionIdAsync(session.CompositePath, session.Id);
                        completed++;
                    }
                    else failed++;
                }
                catch { failed++; }
            }
        }
        catch (Exception ex)
        {
            await _log.LogErrorAsync("session", $"Nettoyage des photos en attente impossible : {ex.Message}", ex.StackTrace);
        }

        // Des nombres seulement : aucun contenu ni chemin de photo dans les journaux.
        if (discarded > 0)
            await _log.LogInfoAsync("session", $"{discarded} photo(s) en attente non validée(s) supprimée(s) au démarrage.");
        if (completed > 0)
            await _log.LogInfoAsync("session", $"{completed} photo(s) validée(s) rangée(s) au démarrage.");
        if (failed > 0)
            await _log.LogWarningAsync("session", $"{failed} dossier(s) en attente non traité(s) au démarrage.");
        return new PendingCleanupResult(completed, discarded, failed);
    }

    /// <summary>Chemin définitif d'un fichier du dossier d'attente (même chemin relatif dans le dossier de l'événement).</summary>
    internal static string MapToEventDirectory(string path, string pendingDir, string eventDir)
    {
        var relative = Path.GetRelativePath(pendingDir, path);
        if (relative.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relative))
            return path; // hors du dossier d'attente : inchangé
        return Path.Combine(eventDir, relative);
    }

    // originals\photo.jpg → dossier de l'événement (parent de originals\).
    private static string? EventDirectoryOf(string? photoPath)
    {
        var originals = Path.GetDirectoryName(photoPath ?? "");
        return string.IsNullOrEmpty(originals) ? null : Path.GetDirectoryName(originals);
    }

    // Déplace tout le contenu du dossier d'attente (en gardant la structure) puis le supprime.
    // Retourne le nombre de fichiers non déplacés.
    private static int MovePendingFiles(string pendingDir, string eventDir)
    {
        if (!Directory.Exists(pendingDir)) return 0;

        int failures = 0;
        foreach (var file in Directory.EnumerateFiles(pendingDir, "*", SearchOption.AllDirectories).ToList())
        {
            try
            {
                var destination = Path.Combine(eventDir, Path.GetRelativePath(pendingDir, file));
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                File.Move(file, destination, overwrite: false);
            }
            catch { failures++; }
        }

        if (failures == 0)
        {
            try { Directory.Delete(pendingDir, recursive: true); }
            catch { /* dossier vide verrouillé : repris au prochain démarrage */ }
        }
        return failures;
    }

    private static SessionEntity NewSession(Guid sessionId, Guid eventId, DateTime capturedAtUtc,
        string photoPath, string compositePath, Guid? templateId, AnimationClip? animation) => new()
    {
        Id            = sessionId,
        TemplateId    = templateId,
        EventId       = eventId,
        CapturedAt    = capturedAtUtc,
        PhotoPath     = photoPath,
        CompositePath = compositePath,
        Uploaded      = false,
        MediaType     = animation == null ? SessionMediaType.Photo : SessionMediaType.Gif,
        VideoPath     = animation?.VideoPath,
        PosterPath    = animation?.PosterPath,
        DurationMs    = animation is { DurationMs: > 0 } ? animation.DurationMs : null,
        Width         = animation is { Width: > 0, Height: > 0 } ? animation.Width : null,
        Height        = animation is { Width: > 0, Height: > 0 } ? animation.Height : null,
    };

    public async Task AttachCompositeAsync(Guid sessionId, Guid eventId, string compositePath)
    {
        var uploadLock = LockFor(sessionId);
        await uploadLock.WaitAsync();
        try
        {
            var info    = ShareInfoFile.Read(compositePath);
            var session = await _db.Sessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sessionId);

            if (session == null)
            {
                // Enregistrement raté après le montage : on rattache la séance pour qu'elle soit comptée
                // et envoyée. Heure de début perdue : celle du montage, écrit juste après la prise de vue.
                _db.Sessions.Add(new SessionEntity
                {
                    Id            = sessionId,
                    EventId       = eventId,
                    CapturedAt    = File.Exists(compositePath) ? File.GetLastWriteTimeUtc(compositePath) : DateTime.UtcNow,
                    PhotoPath     = compositePath,
                    CompositePath = compositePath,
                    Uploaded      = info?.IsShared == true,
                });
                await _db.SaveChangesAsync();
            }
            else if (session.CompositePath != compositePath && !session.Uploaded)
            {
                // Effet choisi après le montage : c'est la version finale qu'on envoie.
                await _db.Sessions.Where(s => s.Id == sessionId)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.CompositePath, compositePath));
            }

            if (info?.SessionId != sessionId)
                await TryWriteSessionIdAsync(compositePath, sessionId);
        }
        finally { uploadLock.Release(); }
    }

    public async Task<(string PublicUrl, Guid PhotoId)> UploadSessionAsync(Guid sessionId)
    {
        var uploadLock = LockFor(sessionId);
        await uploadLock.WaitAsync();
        try
        {
            var session = await _db.Sessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sessionId)
                ?? throw new InvalidOperationException($"Séance {sessionId} introuvable.");
            if (string.IsNullOrEmpty(session.CompositePath))
                throw new InvalidOperationException($"Séance {sessionId} sans montage.");

            // Déjà envoyée (par l'écran résultat ou une reprise précédente) : rien à refaire.
            var info = ShareInfoFile.Read(session.CompositePath);
            if (info is { IsShared: true })
            {
                if (!session.Uploaded) await MarkUploadedAsync(sessionId);
                return (info.Url!, info.PhotoId);
            }

            // Refusée une fois par le serveur : jamais renvoyée (galerie, écran résultat rouvert).
            if (session.UploadRejected)
                throw new MediaRecordRejectedException(MediaRecordRejectedException.InvalidDataCode);

            string url;
            Guid photoId;
            try
            {
                (url, photoId) = AnimationToSend(session) is { } clip
                    ? await _supabase.UploadAnimationAsync(session.Id, session.EventId, clip, session.CapturedAt)
                    : await _supabase.UploadPhotoAsync(session.Id, session.EventId, session.CompositePath, session.CapturedAt);
            }
            catch (MediaRecordRejectedException ex)
            {
                // Refus définitif (donnée invalide, LAB-230) : sortie de la file, fichiers gardés sur la borne.
                await _db.Sessions.Where(s => s.Id == sessionId)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.UploadRejected, true));
                await _log.LogWarningAsync("photo_upload",
                    $"Séance ({session.MediaType}) refusée par le serveur (code {ex.Code}) : retirée de la file d'envoi, fichiers gardés sur la borne.");
                throw;
            }

            // Fichier écrit avant de marquer la séance : en cas de coupure entre les deux,
            // la reprise relit l'URL au lieu de renvoyer la photo.
            try { ShareInfoFile.Write(session.CompositePath, new ShareInfo(session.Id, url, photoId)); }
            catch (Exception ex)
            {
                await _log.LogWarningAsync("photo_upload", $"Fichier de partage non écrit ({session.CompositePath}) : {ex.Message}");
            }

            await MarkUploadedAsync(sessionId);
            return (url, photoId);
        }
        finally { uploadLock.Release(); }
    }

    /// <summary>
    /// Clip et affiche à envoyer pour une séance animée, s'ils sont sur le disque. Sinon (séance photo,
    /// fichiers supprimés) : null, le montage des photos part à la place.
    /// </summary>
    internal static AnimationClip? AnimationToSend(SessionEntity session)
        => session.MediaType != SessionMediaType.Photo
           && session.VideoPath is { } video && File.Exists(video)
           && session.PosterPath is { } poster && File.Exists(poster)
            ? new AnimationClip(video, poster, session.DurationMs ?? 0, session.Width ?? 0, session.Height ?? 0)
            : null;

    /// <summary>
    /// Séances à envoyer : non envoyées, non refusées, dont le montage est sur le disque ; les photos
    /// d'abord, puis les animations (plus lourdes, LAB-237), chacune de la plus ancienne à la plus
    /// récente. Montage supprimé : rien à envoyer (ni échec journalisé à chaque cycle, ni envoi compté
    /// en attente dans le battement de cœur).
    /// </summary>
    internal static async Task<List<Guid>> LoadPendingIdsAsync(AppDbContext db)
    {
        var rows = await db.Sessions.AsNoTracking()
            .Where(s => !s.Uploaded && !s.UploadRejected && s.CompositePath != null)
            .OrderBy(s => s.CapturedAt)
            .Select(s => new { s.Id, s.CompositePath, s.MediaType })
            .ToListAsync();
        return rows.Where(r => File.Exists(r.CompositePath))
                   .OrderBy(r => r.MediaType == SessionMediaType.Photo ? 0 : 1) // tri stable : heure gardée
                   .Select(r => r.Id).ToList();
    }

    public async Task<int> UploadPendingSessionsAsync()
    {
        List<Guid> pending;
        try { pending = await LoadPendingIdsAsync(_db); }
        catch (Exception ex)
        {
            await _log.LogErrorAsync("photo_upload", $"Lecture des séances en attente impossible : {ex.Message}", ex.StackTrace);
            return 0;
        }

        int sent = 0, failed = 0;
        string? lastError = null;
        foreach (var id in pending)
        {
            try
            {
                await UploadSessionAsync(id);
                sent++;
            }
            catch (MediaRecordRejectedException) { /* journalisée, retirée de la file */ }
            catch (Exception ex)
            {
                failed++;
                lastError = ex.Message;
            }
        }

        if (sent > 0)
            await _log.LogInfoAsync("photo_upload", $"{sent} séance(s) en attente envoyée(s).");
        if (failed > 0)
            await _log.LogWarningAsync("photo_upload",
                $"{failed} séance(s) toujours en attente d'envoi. Dernière erreur : {lastError}");

        return sent;
    }

    /// <summary>
    /// Identifiant de séance d'un montage rouvert depuis la galerie : celui du .share.json,
    /// à défaut celui de la base, à défaut un nouvel identifiant, que l'écran Result rattache
    /// au montage (<see cref="AttachCompositeAsync"/>) : la réouverture suivante le retrouve.
    /// </summary>
    public async Task<Guid> ResolveSessionIdAsync(string compositePath)
    {
        if (ShareInfoFile.Read(compositePath)?.SessionId is { } fromFile)
            return fromFile;

        var fromDb = await _db.Sessions.AsNoTracking()
            .Where(s => s.CompositePath == compositePath)
            .Select(s => (Guid?)s.Id)
            .FirstOrDefaultAsync();

        return fromDb ?? Guid.NewGuid();
    }

    public async Task<Guid?> GetSessionTemplateIdAsync(Guid sessionId)
        => await _db.Sessions.AsNoTracking()
            .Where(s => s.Id == sessionId)
            .Select(s => s.TemplateId)
            .FirstOrDefaultAsync();

    private Task MarkUploadedAsync(Guid sessionId)
        => _db.Sessions.Where(s => s.Id == sessionId)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.Uploaded, true));

    private async Task TryWriteSessionIdAsync(string compositePath, Guid sessionId)
    {
        try
        {
            var current = ShareInfoFile.Read(compositePath) ?? new ShareInfo(null, null, Guid.Empty);
            ShareInfoFile.Write(compositePath, current with { SessionId = sessionId });
        }
        catch (Exception ex)
        {
            await _log.LogWarningAsync("session", $"Fichier de partage non écrit ({compositePath}) : {ex.Message}");
        }
    }
}
