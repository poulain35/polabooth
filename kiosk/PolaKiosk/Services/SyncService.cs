using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

public class SyncService : ISyncService
{
    private readonly ISupabaseService   _supabase;
    private readonly AppDbContext       _db;
    private readonly AppSettings        _settings;
    private readonly IKioskStateService _state;
    private readonly IKioskLogService   _log;

    public SyncService(ISupabaseService supabase, AppDbContext db, AppSettings settings, IKioskStateService state, IKioskLogService log)
    {
        _supabase = supabase;
        _db       = db;
        _settings = settings;
        _state    = state;
        _log      = log;
    }

    public async Task<bool> SyncAsync(Guid eventId, CancellationToken ct = default)
    {
        try
        {
            // 1. Téléchargement de l'événement. La lecture se fait par code d'accès (LAB-112) :
            //    on reprend celui mémorisé en local lors de la connexion à l'événement.
            var accessCode = (await _db.Events.FindAsync(eventId))?.AccessCode;
            if (string.IsNullOrWhiteSpace(accessCode))
            {
                await _log.LogWarningAsync("sync", $"SyncAsync ignoré (event {eventId}) : aucun code d'accès en cache local.");
                return false;
            }

            var eventDto = await _supabase.GetEventByCodeAsync(accessCode, ct);
            if (eventDto == null || eventDto.Id != eventId) return false;

            await RememberAccountAsync(eventDto);
            await UpsertEventAsync(eventDto);
            await CacheHomeBackgroundAsync(eventDto, ct);

            // 2. Design client approuvé (LE cadre imposé de l'événement — un seul).
            //    La bibliothèque globale de templates n'est pas synchronisée : elle n'est
            //    liée à aucun événement et n'est pas utilisée par le kiosk.
            await SyncApprovedDesignAsync(eventId, ct);
            await RefreshContactAsync(eventId, ct);

            return true;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            await _log.LogErrorAsync("sync", $"SyncAsync a échoué (event {eventId}) : {ex.Message}", ex.ToString());
            return false;
        }
    }

    public async Task ImportPolaFileAsync(string polaFilePath)
    {
        var bundle = PolaBundle.Parse(await DecompressPolaFileAsync(polaFilePath));
        bundle.EnsureSameAccount(_state.AccountOrgId);
        await ImportBundleAsync(bundle);

        // Copie dans pola\ : la saisie du code sans réseau y cherche l'événement (FindAndImportPolaByCodeAsync).
        var kept = Path.Combine(GetPolaDirectory(), $"{bundle.Event.Id:N}.pola");
        if (!string.Equals(Path.GetFullPath(polaFilePath), Path.GetFullPath(kept), StringComparison.OrdinalIgnoreCase))
            AtomicFile.WriteAllBytes(kept, await File.ReadAllBytesAsync(polaFilePath));
    }

    /// <summary>
    /// Enregistre le contenu d'un .pola exactement comme la synchro en ligne (SyncByCodeAsync) :
    /// événement, fond d'accueil, design approuvé + PNG, contact.
    /// </summary>
    private async Task ImportBundleAsync(PolaBundle bundle)
    {
        var ev = bundle.Event;
        await UpsertEventAsync(ev);

        var bgUrl = ev.FormConfig?.Kiosk?.Home?.BackgroundUrl;
        if (!string.IsNullOrWhiteSpace(bgUrl) && bundle.HomeBackground != null)
            WriteReplacingOlder(GetHomeBackgroundPath(ev.Id, bgUrl), $"{ev.Id:N}_*.img", bundle.HomeBackground);

        // PNG écrit avant la ligne du modèle : le modèle enregistré a toujours son cadre sur le disque.
        var design = bundle.Design;
        WriteReplacingOlder(GetDesignPngPath(design.Id, design.ThumbnailUrl!), $"{design.Id:N}_*.png", bundle.DesignPng);
        await SaveApprovedDesignAsync(design, ev.Id);

        if (bundle.Contact is { } contact)
        {
            await _state.SetContactInfoAsync(contact.Company, contact.Phone, contact.Email);

            // Logo (LAB-257) : effacé si la société n'en a plus ; gardé tel quel si le fichier dit
            // qu'il existe mais n'a pas pu l'embarquer.
            if (contact.LogoUrl == null) DeleteOrgLogo();
            else if (bundle.Logo != null) WriteReplacingOlder(GetOrgLogoPath(contact.LogoUrl), "*.img", bundle.Logo);
        }
    }

    public async Task<EventEntity?> GetCurrentEventAsync(Guid eventId)
        => await _db.Events.FindAsync(eventId);

    public async Task<List<TemplateEntity>> GetTemplatesAsync(Guid eventId)
        => await _db.Templates.Where(t => t.EventId == eventId).ToListAsync();

    // ── Helpers privés ────────────────────────────────────────────────────────

    private async Task UpsertEventAsync(EventDto dto)
    {
        var existing = await _db.Events.FindAsync(dto.Id);
        if (existing == null)
        {
            _db.Events.Add(new EventEntity
            {
                Id = dto.Id,
                Name = dto.Name,
                AccessCode = dto.AccessCode,
                FormConfigJson = JsonConvert.SerializeObject(dto.FormConfig),
                StartDate = dto.StartDate,
                EndDate = dto.EndDate,
                SyncedAt = DateTime.UtcNow
            });
        }
        else
        {
            existing.Name = dto.Name;
            existing.AccessCode = dto.AccessCode;
            existing.FormConfigJson = JsonConvert.SerializeObject(dto.FormConfig);
            existing.StartDate = dto.StartDate;
            existing.EndDate = dto.EndDate;
            existing.SyncedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
    }

    // Un événement = un cadre : le design approuvé remplace tout autre modèle de l'événement.
    private async Task SaveApprovedDesignAsync(TemplateDto dto, Guid eventId)
    {
        var localPath = string.IsNullOrEmpty(dto.ThumbnailUrl) ? null : GetDesignPngPath(dto.Id, dto.ThumbnailUrl);

        _db.Templates.RemoveRange(_db.Templates.Where(t => t.EventId == eventId && t.Id != dto.Id));

        var existing = await _db.Templates.FindAsync(dto.Id);
        if (existing == null)
        {
            _db.Templates.Add(new TemplateEntity
            {
                Id            = dto.Id,
                EventId       = eventId,
                Name          = dto.Name,
                Format        = dto.Format,
                CanvasJson    = dto.CanvasJson,
                ThumbnailPath = localPath,
            });
        }
        else
        {
            existing.EventId       = eventId;
            existing.Name          = dto.Name;
            existing.Format        = dto.Format;
            existing.CanvasJson    = dto.CanvasJson;
            existing.ThumbnailPath = localPath;
        }
        await _db.SaveChangesAsync();
    }

    public string GetHomeBackgroundPath(Guid eventId, string backgroundUrl)
    {
        // L'URL fait partie du nom : un fond changé dans le SaaS est retéléchargé, l'ancien supprimé.
        return Path.Combine(DataDirectory, "backgrounds", $"{eventId:N}_{UrlHash(backgroundUrl)}.img");
    }

    // Même principe pour le PNG du design : un design renvoyé puis réapprouvé garde son id
    // (un design par événement) mais change d'URL, donc de fichier.
    private string GetDesignPngPath(Guid designId, string pngUrl)
        => Path.Combine(DataDirectory, "templates", $"{designId:N}_{UrlHash(pngUrl)}.png");

    private static string UrlHash(string url)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(url)))[..12];

    private string DataDirectory => Environment.ExpandEnvironmentVariables(_settings.Kiosk.DataDirectory);

    private string GetPolaDirectory() => Path.Combine(DataDirectory, "pola");

    // Téléchargé une seule fois pendant la synchro (et non à chaque affichage de l'accueil).
    private async Task CacheHomeBackgroundAsync(EventDto dto, CancellationToken ct)
    {
        var url = dto.FormConfig?.Kiosk?.Home?.BackgroundUrl;
        if (string.IsNullOrWhiteSpace(url)) return;

        try
        {
            await DownloadReplacingOlderAsync(url, GetHomeBackgroundPath(dto.Id, url), $"{dto.Id:N}_*.img", ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            // Non bloquant : l'accueil garde le fond crème.
            await _log.LogWarningAsync("sync-background", $"Fond d'accueil non téléchargé (event {dto.Id}) : {ex.Message}");
        }
    }

    // Écriture dans un .tmp puis renommage : l'écran ne lit jamais un fichier à moitié écrit.
    // Les anciennes versions (même motif, autre URL) sont ensuite supprimées.
    private async Task DownloadReplacingOlderAsync(string url, string path, string olderPattern, CancellationToken ct)
    {
        if (File.Exists(path)) return;
        await _supabase.DownloadAssetAsync(url, path + ".tmp", ct);
        File.Move(path + ".tmp", path, overwrite: true);
        DeleteOlder(path, olderPattern);
    }

    private static void WriteReplacingOlder(string path, string olderPattern, byte[] bytes)
    {
        AtomicFile.WriteAllBytes(path, bytes);
        DeleteOlder(path, olderPattern);
    }

    private static void DeleteOlder(string path, string olderPattern)
    {
        foreach (var old in Directory.EnumerateFiles(Path.GetDirectoryName(path)!, olderPattern))
        {
            if (!string.Equals(old, path, StringComparison.OrdinalIgnoreCase))
                try { File.Delete(old); } catch { /* fichier encore ouvert : supprimé à la prochaine synchro */ }
        }
    }

    public async Task SyncSetupConfigAsync(CancellationToken ct = default)
    {
        var url = $"{_settings.Supabase.Url.TrimEnd('/')}/storage/v1/object/public/kiosk-backgrounds/default/setup_config.json";
        var localPath = GetSetupConfigPath();
        try { await _supabase.DownloadAssetAsync(url, localPath, ct); }
        catch when (!ct.IsCancellationRequested) { /* non configuré → garder le fichier local existant */ }
    }

    public string GetSetupConfigPath()
    {
        var dataDir = Environment.ExpandEnvironmentVariables(_settings.Kiosk.DataDirectory);
        return Path.Combine(dataDir, "setup_bg_config.json");
    }

    /// <summary>Synchronise le design client approuvé (LE cadre de l'événement). Retourne true si un design existe.</summary>
    private async Task<bool> SyncApprovedDesignAsync(Guid eventId, CancellationToken ct)
    {
        try
        {
            var design = await _supabase.GetApprovedDesignAsync(eventId, ct);
            if (design == null) return false;

            if (!string.IsNullOrEmpty(design.ThumbnailUrl))
            {
                try
                {
                    await DownloadReplacingOlderAsync(design.ThumbnailUrl,
                        GetDesignPngPath(design.Id, design.ThumbnailUrl), $"{design.Id:N}_*.png", ct);
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    await _log.LogWarningAsync("sync-design", $"PNG du design non téléchargé (event {eventId}) : {ex.Message}");
                }
            }
            await SaveApprovedDesignAsync(design, eventId);
            return true;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            // Non bloquant, mais on trace : sans design, les photos seront sans cadre.
            await _log.LogWarningAsync("sync-design", $"Échec de la sync du design approuvé (event {eventId}) : {ex.Message}");
            return false;
        }
    }

    // Fiche contact du loueur (RPC accessible anon), affichée sur l'écran de saisie du code,
    // et logo de la société affiché sur l'accueil (LAB-257).
    private async Task RefreshContactAsync(Guid eventId, CancellationToken ct)
    {
        OrgContact? contact;
        try { contact = await _supabase.GetOrgContactByEventAsync(eventId, ct); }
        catch when (!ct.IsCancellationRequested) { return; /* non bloquant : valeurs en cache conservées */ }
        if (contact == null) return;

        if (!string.IsNullOrEmpty(contact.Company))
            await _state.SetContactInfoAsync(contact.Company, contact.Phone, contact.Email);
        await CacheOrgLogoAsync(contact.LogoUrl, ct);
    }

    // ── Logo de la société (LAB-257) ──────────────────────────────────────────
    // Un seul fichier dans logo\ : celui de la société de l'événement chargé. Il est gardé hors
    // ligne, d'un événement à l'autre, jusqu'à ce que la synchro dise qu'il a changé ou disparu.

    public string? GetOrgLogoPath()
    {
        var dir = GetOrgLogoDirectory();
        if (!Directory.Exists(dir)) return null;
        return new DirectoryInfo(dir).GetFiles("*.img")
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .Select(f => f.FullName)
            .FirstOrDefault();
    }

    // L'URL fait partie du nom : un logo remplacé dans l'admin (URL versionnée) est retéléchargé.
    private string GetOrgLogoPath(string logoUrl) => Path.Combine(GetOrgLogoDirectory(), $"{UrlHash(logoUrl)}.img");

    private string GetOrgLogoDirectory() => Path.Combine(DataDirectory, "logo");

    private async Task CacheOrgLogoAsync(string? logoUrl, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(logoUrl))
        {
            DeleteOrgLogo();
            return;
        }

        try
        {
            await DownloadReplacingOlderAsync(logoUrl, GetOrgLogoPath(logoUrl), "*.img", ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            // Non bloquant : l'accueil garde le logo précédent, sinon le nom de la société.
            await _log.LogWarningAsync("sync-logo", $"Logo de la société non téléchargé : {ex.Message}");
        }
    }

    private void DeleteOrgLogo()
    {
        var dir = GetOrgLogoDirectory();
        if (!Directory.Exists(dir)) return;
        foreach (var file in Directory.EnumerateFiles(dir))
            try { File.Delete(file); } catch { /* fichier encore ouvert : supprimé à la prochaine synchro */ }
    }

    public async Task<EventEntity?> SyncByCodeAsync(string accessCode, CancellationToken ct = default)
    {
        var code = accessCode.Trim().ToUpperInvariant();

        // 1. Tentative en ligne via Supabase
        EventDto? dto;
        try
        {
            dto = await _supabase.GetEventByCodeAsync(code, ct);
        }
        catch (KioskLicenseRefusedException)
        {
            throw; // licence refusée (borne retirée) : l'appelant renvoie à l'association
        }
        catch (HttpRequestException ex) when (ex.StatusCode is not null)
        {
            // Supabase a répondu (4xx/5xx) : on remonte le vrai message
            throw new Exception($"Erreur Supabase ({(int)ex.StatusCode}) : {ex.Message}", ex);
        }
        catch (Exception ex) when (IsNetworkUnavailable(ex, ct))
        {
            // 2. Réseau indisponible → tentative hors ligne via fichiers .pola
            return await FindAndImportPolaByCodeAsync(code);
        }

        // Supabase accessible mais code inconnu → pas de fallback offline utile
        if (dto == null) return null;

        return await SyncEventDtoAsync(dto, "event-setup", ct);
    }

    // LAB-245 : événement envoyé depuis le SaaS (kiosk_get_event_request), déjà lu avec la licence :
    // mêmes étapes que la saisie du code, sans repli .pola (l'envoi n'existe qu'en ligne).
    public Task<EventEntity?> SyncPushedEventAsync(EventDto dto, CancellationToken ct = default)
        => SyncEventDtoAsync(dto, "event-push", ct);

    private async Task<EventEntity?> SyncEventDtoAsync(EventDto dto, string logSource, CancellationToken ct)
    {
        await RememberAccountAsync(dto);
        await UpsertEventAsync(dto);
        await CacheHomeBackgroundAsync(dto, ct);

        // Un événement = UN cadre imposé : le design client approuvé (RPC kiosk_get_approved_design).
        // On ne synchronise que lui — pas la bibliothèque globale de templates, qui n'est
        // pas liée à l'événement et pèse plusieurs dizaines de Mo pour rien.
        var hasDesign = await SyncApprovedDesignAsync(dto.Id, ct);
        if (!hasDesign)
            await _log.LogWarningAsync(logSource,
                $"Événement '{dto.Name}' ({dto.AccessCode}) connecté SANS design approuvé — les photos seront sans cadre.");

        await RefreshContactAsync(dto.Id, ct);

        return await _db.Events.FindAsync([dto.Id], ct);
    }

    /// <summary>
    /// Compte de la borne : celui des événements renvoyés par kiosk_get_event (filtrés sur la licence).
    /// Sert à refuser un .pola d'un autre compte (LAB-244).
    /// </summary>
    private async Task RememberAccountAsync(EventDto dto)
    {
        if (dto.OrgId == Guid.Empty || _state.AccountOrgId == dto.OrgId) return;
        await _state.SetAccountOrgIdAsync(dto.OrgId);
    }

    /// <summary>
    /// Pas de réponse du serveur : pas de réseau (statut HTTP absent) ou délai du HttpClient dépassé.
    /// Une réponse 4xx/5xx n'en fait pas partie, ni une annulation demandée par l'appelant.
    /// </summary>
    internal static bool IsNetworkUnavailable(Exception ex, CancellationToken ct)
        => ex is HttpRequestException { StatusCode: null }
        || (ex is TaskCanceledException && !ct.IsCancellationRequested);

    private async Task<EventEntity?> FindAndImportPolaByCodeAsync(string code)
    {
        var polaDir = GetPolaDirectory();
        if (!Directory.Exists(polaDir)) return null;

        // Le plus récent d'abord : un fichier réimporté prime sur une ancienne copie du même événement.
        foreach (var file in new DirectoryInfo(polaDir).GetFiles("*.pola").OrderByDescending(f => f.LastWriteTimeUtc))
        {
            PolaBundle bundle;
            try { bundle = PolaBundle.Parse(await DecompressPolaFileAsync(file.FullName)); }
            catch (Exception ex) when (ex is InvalidDataException or IOException)
            {
                await _log.LogWarningAsync("sync-pola", $"Fichier {file.Name} ignoré : {ex.Message}");
                continue;
            }

            if (!string.Equals(bundle.Event.AccessCode, code, StringComparison.OrdinalIgnoreCase)) continue;

            // Événement d'un autre compte : comme en ligne, il n'existe pas pour cette borne.
            try { bundle.EnsureSameAccount(_state.AccountOrgId); }
            catch (InvalidDataException)
            {
                await _log.LogWarningAsync("sync-pola", $"Fichier {file.Name} ignoré : il vient d'un autre compte.");
                continue;
            }

            await ImportBundleAsync(bundle);
            return await _db.Events.FindAsync(bundle.Event.Id);
        }

        return null;
    }

    private static async Task<string> DecompressPolaFileAsync(string path)
    {
        try
        {
            await using var fileStream = File.OpenRead(path);
            await using var gzip = new GZipStream(fileStream, CompressionMode.Decompress);
            using var reader = new StreamReader(gzip);
            return await reader.ReadToEndAsync();
        }
        catch (InvalidDataException)
        {
            throw new InvalidDataException(PolaBundle.UnreadableMessage);
        }
    }
}
