using Microsoft.EntityFrameworkCore;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

public sealed class PhotoConsentService : IPhotoConsentService
{
    internal const string LogContext = "photo_consents";

    // Pas de donnée personnelle : la limite protège seulement d'un refus serveur sans fin (licence
    // désactivée). 90 jours = le plus long choix de conservation des photos de l'admin (EventCleanupService).
    internal static readonly TimeSpan Retention = TimeSpan.FromDays(90);

    // Boucle de 2 minutes et retour du réseau peuvent se croiser : une ligne n'est envoyée et
    // supprimée que par un seul passage (le service est transitoire, d'où le verrou statique).
    private static readonly SemaphoreSlim SendGate = new(1, 1);

    private readonly AppDbContext _db;
    private readonly ISupabaseService _supabase;
    private readonly IKioskLogService _log;

    public PhotoConsentService(AppDbContext db, ISupabaseService supabase, IKioskLogService log)
    {
        _db       = db;
        _supabase = supabase;
        _log      = log;
    }

    /// <summary>
    /// Ajoute le consentement de la séance au contexte SANS l'enregistrer : appelé juste avant le
    /// SaveChanges de la séance (<see cref="ISessionService.RecordSessionAsync"/> ou
    /// <see cref="ISessionService.CommitPendingSessionAsync"/>), même transaction SQLite.
    /// </summary>
    public static void Stage(AppDbContext db, PhotoConsent consent, Guid sessionId, Guid eventId, string accessCode)
        => db.PhotoConsents.Add(CreateEntity(consent, sessionId, eventId, accessCode));

    internal static PhotoConsentEntity CreateEntity(PhotoConsent consent, Guid sessionId, Guid eventId, string accessCode) => new()
    {
        Id          = Guid.NewGuid(),
        EventId     = eventId,
        SessionId   = sessionId,
        AccessCode  = accessCode,
        ConsentText = consent.Text,
        ConsentedAt = consent.ConsentedAtUtc.ToUniversalTime(),
    };

    public async Task<int> PurgeExpiredAsync()
    {
        var cutoff = DateTime.UtcNow - Retention;
        var purged = await _db.PhotoConsents.Where(c => c.ConsentedAt < cutoff).ExecuteDeleteAsync();
        if (purged > 0)
            await _log.LogWarningAsync(LogContext,
                $"{purged} consentement(s) photo non envoyé(s) en {Retention.Days} jours supprimé(s) de la borne.");
        return purged;
    }

    public async Task<PhotoConsentSendSummary> SendPendingAsync()
    {
        if (!await SendGate.WaitAsync(0)) return new PhotoConsentSendSummary(0, 0, 0);
        try
        {
            await PurgeExpiredAsync();

            int sent = 0, rejected = 0, failed = 0;
            var codes = new SortedSet<string>(StringComparer.Ordinal);
            var rows = await _db.PhotoConsents.OrderBy(c => c.ConsentedAt).ToListAsync();
            foreach (var row in rows)
            {
                PhotoConsentSendResult result;
                try { result = await _supabase.RecordPhotoConsentAsync(ToRecord(row)); }
                catch (Exception ex)
                {
                    // Réseau coupé ou trop lent : les suivants échoueraient de même.
                    row.Attempts++;
                    row.LastError = ex.GetType().Name;
                    await _db.SaveChangesAsync();
                    codes.Add(row.LastError);
                    failed++;
                    break;
                }

                if (result.Accepted)
                {
                    _db.PhotoConsents.Remove(row);
                    sent++;
                }
                else if (result.ErrorCode == PhotoConsentSendResult.InvalidDataCode)
                {
                    _db.PhotoConsents.Remove(row);
                    rejected++;
                }
                else
                {
                    // Licence ou événement refusés, erreur serveur : nouvel essai au cycle suivant.
                    row.Attempts++;
                    row.LastError = result.ErrorCode;
                    codes.Add(result.ErrorCode ?? "inconnu");
                    failed++;
                }
                await _db.SaveChangesAsync();
            }

            if (sent > 0)
                await _log.LogInfoAsync(LogContext, $"{sent} consentement(s) photo envoyé(s).");
            if (rejected > 0)
                await _log.LogWarningAsync(LogContext,
                    $"{rejected} consentement(s) photo refusé(s) par le serveur (code {PhotoConsentSendResult.InvalidDataCode}) : supprimé(s) de la borne.");
            if (failed > 0)
                await _log.LogWarningAsync(LogContext,
                    $"{failed} consentement(s) photo non envoyé(s) (code : {string.Join(", ", codes)}) : nouvel essai au prochain cycle.");

            return new PhotoConsentSendSummary(sent, rejected, failed);
        }
        finally { SendGate.Release(); }
    }

    internal static PhotoConsentRecord ToRecord(PhotoConsentEntity row) => new(
        Id:             row.Id,
        EventId:        row.EventId,
        AccessCode:     row.AccessCode,
        SessionId:      row.SessionId,
        ConsentedAtUtc: DateTime.SpecifyKind(row.ConsentedAt, DateTimeKind.Utc),
        ConsentText:    row.ConsentText);
}
