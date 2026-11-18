using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
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
    private readonly IPolaHistory       _history;

    public SyncService(ISupabaseService supabase, AppDbContext db, AppSettings settings, IKioskStateService state,
        IKioskLogService log, IPolaHistory history)
    {
        _supabase = supabase;
        _db       = db;
        _settings = settings;
        _state    = state;
        _log      = log;
        _history  = history;
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
            await SyncScreensAsync(eventId, ct);
            await RefreshContactAsync(eventId, ct);

            return true;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            await _log.LogErrorAsync("sync", $"SyncAsync a échoué (event {eventId}) : {ex.Message}", ex.ToString());
            return false;
        }
    }

    public async Task<EventEntity> ImportPolaFileAsync(string polaFilePath)
    {
        var bundle = PolaBundle.Parse(await DecompressPolaFileAsync(polaFilePath, MaxPolaBytes));
        bundle.EnsureSameAccount(_state.AccountOrgId);
        await ImportBundleAsync(bundle);

        // Copie dans pola\ : la saisie du code sans réseau y cherche l'événement (FindAndImportPolaByCodeAsync).
        var content = await File.ReadAllBytesAsync(polaFilePath);
        var kept = Path.Combine(GetPolaDirectory(), $"{bundle.Event.Id:N}.pola");
        if (!string.Equals(Path.GetFullPath(polaFilePath), Path.GetFullPath(kept), StringComparison.OrdinalIgnoreCase))
            AtomicFile.WriteAllBytes(kept, content);

        // Historique de l'Admin (LAB-321) : l'événement est déjà enregistré, un échec ici ne l'annule pas.
        var ev = bundle.Event;
        try { _history.Add(content, ev.Id, bundle.Design.Id, ev.Name, ev.StartDate, ev.EndDate); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            await _log.LogWarningAsync("pola-history", $"Copie du .pola dans l'historique impossible : {ex.Message}");
        }

        return (await _db.Events.FindAsync(bundle.Event.Id))!;
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

        // PNG écrits avant les lignes des modèles : un modèle enregistré a toujours son cadre sur le disque.
        // PolaBundle ne garde que les cadres dont le fichier porte le PNG (LAB-315).
        var design = bundle.Design;
        WriteReplacingOlder(GetDesignPngPath(design.Id, design.ThumbnailUrl!), $"{design.Id:N}_*.png", bundle.DesignPng);
        foreach (var frame in design.Frames)
            WriteReplacingOlder(GetDesignPngPath(frame.Id, frame.ThumbnailUrl!), $"{frame.Id:N}_*.png", bundle.FramePngs![frame.Id]);
        await SaveApprovedDesignAsync(design, ev.Id);

        // Écran d'accueil du client (LAB-291) : comme home_design de la RPC. Absent du fichier : effacé.
        // Décrit sans son PNG (le SaaS n'a pas pu le télécharger) : l'écran en cache est gardé s'il a
        // le même id, sinon effacé (docs/format-pola.md).
        if (design.HomeDesign is { } home)
        {
            if (bundle.HomeDesignPng != null) WriteReplacingOlder(GetHomeDesignPath(home), "*.png", bundle.HomeDesignPng);
            else DeleteHomeDesigns(exceptId: home.Id);
        }
        else DeleteHomeDesigns();

        await ImportScreensAsync(bundle.Screens);

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
        => (await _db.Templates.Where(t => t.EventId == eventId).ToListAsync())
            .OrderBy(t => t.SortOrder ?? 0).ThenBy(t => t.Id)
            .ToList();

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

    // Les cadres de l'événement sont exactement ceux reçus (design principal puis frames, LAB-315) :
    // un cadre qui n'est plus validé perd sa ligne et son PNG.
    private async Task SaveApprovedDesignAsync(TemplateDto dto, Guid eventId)
    {
        var frames = new[] { dto }.Concat(dto.Frames).ToList();
        var keptIds = frames.Select(f => f.Id).ToHashSet();

        var removed = await _db.Templates.Where(t => t.EventId == eventId && !keptIds.Contains(t.Id)).ToListAsync();
        _db.Templates.RemoveRange(removed);

        for (var order = 0; order < frames.Count; order++)
        {
            var frame = frames[order];
            var localPath = string.IsNullOrEmpty(frame.ThumbnailUrl) ? null : GetDesignPngPath(frame.Id, frame.ThumbnailUrl);
            var existing = await _db.Templates.FindAsync(frame.Id);
            if (existing == null)
            {
                existing = new TemplateEntity { Id = frame.Id };
                _db.Templates.Add(existing);
            }
            existing.EventId       = eventId;
            existing.Name          = frame.Name;
            existing.Format        = frame.Format;
            existing.CanvasJson    = frame.CanvasJson;
            existing.ThumbnailPath = localPath;
            existing.SortOrder     = order;
        }
        await _db.SaveChangesAsync();

        foreach (var template in removed) DeleteDesignPngs(template.Id);
    }

    private void DeleteDesignPngs(Guid designId)
    {
        var directory = Paths.TemplatesDirectory;
        if (!Directory.Exists(directory)) return;
        foreach (var file in Directory.EnumerateFiles(directory, $"{designId:N}_*.png"))
            try { File.Delete(file); } catch { /* fichier encore ouvert : il ne sert plus, la ligne est supprimée */ }
    }

    public string GetHomeBackgroundPath(Guid eventId, string backgroundUrl)
    {
        // L'URL fait partie du nom : un fond changé dans le SaaS est retéléchargé, l'ancien supprimé.
        return Path.Combine(Paths.BackgroundsDirectory, $"{eventId:N}_{UrlHash(backgroundUrl)}.img");
    }

    // Même principe pour le PNG du design : un design renvoyé puis réapprouvé garde son id
    // (un design par événement) mais change d'URL, donc de fichier.
    private string GetDesignPngPath(Guid designId, string pngUrl)
        => Path.Combine(Paths.TemplatesDirectory, $"{designId:N}_{UrlHash(pngUrl)}.png");

    private static string UrlHash(string url)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(url)))[..12];

    private KioskPaths Paths => KioskPaths.From(_settings);

    private string GetPolaDirectory() => Paths.PolaDirectory;

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

    // Le téléchargement est atomique (DownloadAssetAsync) : l'écran ne lit jamais un fichier à moitié
    // écrit. Les anciennes versions (même motif, autre URL) sont ensuite supprimées.
    private async Task DownloadReplacingOlderAsync(string url, string path, string olderPattern, CancellationToken ct)
    {
        if (File.Exists(path)) return;
        await _supabase.DownloadAssetAsync(url, path, ct);
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

        // LAB-394 : l'image de fond est mise en cache ici ; l'écran la lit sur le disque, jamais sur le réseau.
        var bgUrl = ReadSetupBackgroundUrl();
        if (bgUrl == null) return;
        try { await DownloadReplacingOlderAsync(bgUrl, GetSetupBackgroundCachePath(bgUrl), "*.img", ct); }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            await _log.LogWarningAsync("sync-background", $"Fond de l'écran de saisie non téléchargé : {ex.Message}");
        }
    }

    public string? GetSetupBackgroundPath()
    {
        var url = ReadSetupBackgroundUrl();
        if (url == null) return null;
        var path = GetSetupBackgroundCachePath(url);
        return File.Exists(path) ? path : null;
    }

    private string? ReadSetupBackgroundUrl()
    {
        try
        {
            var path = GetSetupConfigPath();
            if (!File.Exists(path)) return null;
            var cfg = JsonConvert.DeserializeObject<KioskSetupConfig>(File.ReadAllText(path));
            return cfg?.BgType == "image" && !string.IsNullOrWhiteSpace(cfg.BgImageUrl) ? cfg.BgImageUrl : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    private string GetSetupBackgroundCachePath(string url)
        => Path.Combine(Paths.SetupBackgroundsDirectory, $"{UrlHash(url)}.img");

    public string GetSetupConfigPath() => Paths.SetupConfigFile;

    /// <summary>
    /// Synchronise les cadres validés de l'événement (design principal + frames, LAB-315). Retourne
    /// true si un design existe ; sans design, les modèles en cache sont gardés.
    /// </summary>
    private async Task<bool> SyncApprovedDesignAsync(Guid eventId, CancellationToken ct)
    {
        try
        {
            var design = await _supabase.GetApprovedDesignAsync(eventId, ct);
            await CacheHomeDesignAsync(design?.HomeDesign, eventId, ct);
            if (design == null) return false;

            // Un PNG manquant ne bloque pas : l'accueil écarte un cadre illisible (journal « frames »).
            foreach (var frame in new[] { design }.Concat(design.Frames))
            {
                if (string.IsNullOrEmpty(frame.ThumbnailUrl)) continue;
                try
                {
                    await DownloadReplacingOlderAsync(frame.ThumbnailUrl,
                        GetDesignPngPath(frame.Id, frame.ThumbnailUrl), $"{frame.Id:N}_*.png", ct);
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    await _log.LogWarningAsync("sync-design", $"PNG du cadre {frame.Id} non téléchargé (event {eventId}) : {ex.Message}");
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

    private string GetOrgLogoDirectory() => Paths.LogoDirectory;

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

    // ── Écran d'accueil créé par le client (LAB-291) ──────────────────────────
    // Un seul fichier dans home-designs\ : l'écran validé de l'événement chargé, gardé hors ligne.
    // La RPC (ou le .pola) dit à chaque synchro s'il existe encore : sinon il est effacé.

    public string? GetHomeDesignPath()
    {
        var dir = GetHomeDesignDirectory();
        if (!Directory.Exists(dir)) return null;
        return new DirectoryInfo(dir).GetFiles("*.png")
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .Select(f => f.FullName)
            .FirstOrDefault();
    }

    // L'URL fait partie du nom : un écran renvoyé puis revalidé garde son id mais change d'URL.
    private string GetHomeDesignPath(HomeDesignDto home)
        => Path.Combine(GetHomeDesignDirectory(), $"{home.Id:N}_{UrlHash(home.FinalPngUrl)}.png");

    private string GetHomeDesignDirectory() => Paths.HomeDesignsDirectory;

    /// <summary>
    /// <paramref name="home"/> null : la RPC a répondu sans écran validé (option coupée, écran refusé ou
    /// pas de design) → cache effacé. Échec du téléchargement : l'écran déjà en cache reste affiché.
    /// </summary>
    private async Task CacheHomeDesignAsync(HomeDesignDto? home, Guid eventId, CancellationToken ct)
    {
        if (home == null)
        {
            DeleteHomeDesigns();
            return;
        }

        try
        {
            await DownloadReplacingOlderAsync(home.FinalPngUrl, GetHomeDesignPath(home), "*.png", ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            await _log.LogWarningAsync("sync-home", $"Écran d'accueil du client non téléchargé (event {eventId}) : {ex.Message}");
        }
    }

    // exceptId : garde les fichiers de cet écran ({id}_{hash url}.png), quelle que soit leur URL.
    private void DeleteHomeDesigns(Guid? exceptId = null)
    {
        var dir = GetHomeDesignDirectory();
        if (!Directory.Exists(dir)) return;
        foreach (var file in Directory.EnumerateFiles(dir))
        {
            if (exceptId is { } id && Path.GetFileName(file).StartsWith($"{id:N}_", StringComparison.OrdinalIgnoreCase)) continue;
            try { File.Delete(file); } catch { /* fichier encore ouvert : supprimé à la prochaine synchro */ }
        }
    }

    // ── Écrans composés par l'admin (LAB-297) ──────────────────────────────────
    // screens\{home,result}\ : le dernier plan publié de l'organisation, ses images et ses polices
    // (LAB-331), gardés hors ligne. Rien de publié → cache effacé. Échec (réseau, image illisible) →
    // version précédente gardée, et sans version, l'écran standard. Police manquante → DM Sans.

    private static readonly string[] ScreenKinds = [ScreenLayout.KindHome, ScreenLayout.KindResult];

    private ScreenCache Screens => new(Paths.Root);

    public CachedScreen? GetScreen(string kind) => Screens.Get(kind);

    private async Task SyncScreensAsync(Guid eventId, CancellationToken ct)
    {
        PublishedScreens published;
        try { published = await _supabase.GetScreensAsync(eventId, ct) ?? PublishedScreens.None; }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            await _log.LogWarningAsync("screens", $"Écrans de la borne non lus (event {eventId}) : {ex.Message}. Cache gardé.");
            return;
        }

        foreach (var kind in ScreenKinds)
            await StoreScreenAsync(kind, published.For(kind), "synchro",
                (url, path, c) => _supabase.DownloadAssetAsync(url, path, c), ct);
    }

    // Fichier sans bloc screens : écrans standard, comme une dépublication. Police absente du fichier :
    // DM Sans, puis la synchro en ligne suivante la télécharge.
    private async Task ImportScreensAsync(PolaScreens? screens)
    {
        foreach (var kind in ScreenKinds)
            await StoreScreenAsync(kind, screens?.For(kind), "fichier .pola", (url, path, _) =>
            {
                var bytes = screens!.AssetFor(url) ?? throw new InvalidDataException("absente du fichier");
                File.WriteAllBytes(path, bytes);
                return Task.CompletedTask;
            }, CancellationToken.None);
    }

    private async Task StoreScreenAsync(string kind, JObject? plan, string origin,
        Func<string, string, CancellationToken, Task> fetch, CancellationToken ct)
    {
        var cache = Screens;
        if (plan == null)
        {
            cache.Clear(kind);
            return;
        }

        var (stored, error, warnings) = await cache.StoreAsync(kind, plan, fetch, ct);
        if (error != null)
        {
            var fallback = cache.Get(kind) != null ? "version précédente gardée" : "écran standard affiché";
            await _log.LogWarningAsync("screens", $"Écran « {kind} » non mis à jour ({origin}) : {error} ; {fallback}.");
            return;
        }
        if (stored is { Ignored.Count: > 0 })
            await _log.LogWarningAsync("screens", $"Écran « {kind} » v{stored.Version} : valeurs inconnues ignorées : {stored.IgnoredSummary()}.");
        if (warnings.Count > 0)
            await _log.LogWarningAsync("screens", $"Écran « {kind} » ({origin}) : {string.Join(", ", warnings)} ; ces textes seront écrits en DM Sans.");
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

        await SyncScreensAsync(dto.Id, ct);
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
            try { bundle = PolaBundle.Parse(await DecompressPolaFileAsync(file.FullName, MaxPolaBytes)); }
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

    /// <summary>
    /// Taille maximale d'un .pola une fois décompressé (LAB-394) : un fichier piégé (bombe GZip) ne
    /// remplit ni la mémoire ni le disque. Un vrai .pola fait quelques dizaines de Mo.
    /// </summary>
    internal const long DefaultMaxPolaBytes = 300L * 1024 * 1024;

    internal long MaxPolaBytes { get; set; } = DefaultMaxPolaBytes;

    internal static async Task<string> DecompressPolaFileAsync(string path, long maxBytes)
    {
        try
        {
            await using var fileStream = File.OpenRead(path);
            await using var gzip = new BoundedReadStream(new GZipStream(fileStream, CompressionMode.Decompress),
                maxBytes, PolaBundle.TooLargeMessage);
            using var reader = new StreamReader(gzip);
            return await reader.ReadToEndAsync();
        }
        catch (InvalidDataException)
        {
            throw new InvalidDataException(PolaBundle.UnreadableMessage);
        }
    }
}
