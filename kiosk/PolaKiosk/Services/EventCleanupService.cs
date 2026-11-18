using System.IO;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PolaKiosk.Models.LocalDb;

namespace PolaKiosk.Services;

public record EventCleanupReport(int Deleted, int KeptUnsent, long FreedBytes);

/// <summary>
/// Supprime du PC le dossier d'un événement terminé (originaux, montages, vignettes) une fois le
/// délai de conservation passé, puis ses séances en base. Les montages sont déjà en ligne.
/// Fin d'un événement = sa dernière activité sur cette borne (synchro, séance, fichier écrit) :
/// le kiosk ne reçoit pas la date de fin du SaaS, et un événement repris repousse le délai.
/// Jamais l'événement actif, jamais un événement dont une séance n'est pas envoyée, jamais
/// en dehors de <c>{DataDirectory}\events\</c>.
/// </summary>
public class EventCleanupService : IEventCleanupService
{
    public const int DefaultRetentionDays = 30;
    public static readonly IReadOnlyList<int> RetentionChoices = [7, 15, 30, 60, 90];
    private static readonly TimeSpan Interval = TimeSpan.FromDays(1);

    private static readonly EnumerationOptions AllFiles = new()
    {
        RecurseSubdirectories = true,
        IgnoreInaccessible    = true,
        AttributesToSkip      = FileAttributes.ReparsePoint,
    };

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly SessionPathService _paths;
    private readonly IMachineSettingsService _machine;
    private readonly IKioskStateService _state;
    private readonly IKioskLogService _log;
    private long _lastRunTicks;

    public EventCleanupService(IServiceScopeFactory scopeFactory, SessionPathService paths,
        IMachineSettingsService machine, IKioskStateService state, IKioskLogService log)
    {
        _scopeFactory = scopeFactory;
        _paths        = paths;
        _machine      = machine;
        _state        = state;
        _log          = log;
    }

    public static int ClampRetentionDays(int days) => Math.Clamp(days, 1, 365);

    public static int RetentionDays(MachineSettings settings)
        => settings.EventRetentionDays is { } days ? ClampRetentionDays(days) : DefaultRetentionDays;

    public async Task RunIfDueAsync()
    {
        var now  = DateTime.UtcNow;
        var last = Interlocked.Read(ref _lastRunTicks);
        if (last != 0 && now.Ticks - last < Interval.Ticks) return;
        if (Interlocked.CompareExchange(ref _lastRunTicks, now.Ticks, last) != last) return;

        try
        {
            var root = _paths.GetEventsRoot();
            EventCleanupReport report;
            using (var scope = _scopeFactory.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                report = await CleanAsync(db, root, _state.ActiveEventId, RetentionDays(_machine.Current), now, _log);
            }
            // Bilan seulement si un dossier a été supprimé : sinon une ligne vide à chaque démarrage (LAB-326).
            // L'espace disque libre figure dans la ligne de démarrage.
            if (report.Deleted > 0)
                await _log.LogInfoAsync("cleanup",
                    $"Nettoyage du PC : {report.Deleted} événement(s) supprimé(s), {FormatSize(report.FreedBytes)} libéré(s) ; " +
                    $"espace disque libre : {FreeSpace(root)}.");
        }
        catch (Exception ex)
        {
            await _log.LogErrorAsync("cleanup", $"Nettoyage du PC impossible : {ex.Message}", ex.StackTrace);
        }
    }

    internal static async Task<EventCleanupReport> CleanAsync(AppDbContext db, string eventsRoot, Guid? activeEventId,
        int retentionDays, DateTime nowUtc, IKioskLogService? log)
    {
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(eventsRoot));
        if (!Directory.Exists(root)) return new EventCleanupReport(0, 0, 0);

        var limit = nowUtc.AddDays(-retentionDays);
        var activeShortId = activeEventId is { } active && active != Guid.Empty ? SessionPathService.ShortId(active) : null;

        var knownIds = (await db.Events.AsNoTracking().Select(e => e.Id).ToListAsync())
            .Concat(await db.Sessions.AsNoTracking().Select(s => s.EventId).Distinct().ToListAsync())
            .Distinct()
            .ToList();
        var unsent = await db.Sessions.AsNoTracking().Where(s => !s.Uploaded).ToListAsync();

        int deleted = 0, keptUnsent = 0;
        long freed = 0;
        foreach (var dir in Directory.EnumerateDirectories(root).ToList())
        {
            var name    = Path.GetFileName(dir);
            var shortId = SessionPathService.ShortIdFromDirectoryName(name);
            if (shortId == null || shortId == activeShortId || !IsEventDirectory(root, dir)) continue;

            var ids = knownIds.Where(id => SessionPathService.ShortId(id) == shortId).ToList();
            var (newestFileUtc, bytes) = Scan(dir);
            var lastActivity = (await db.Events.AsNoTracking().Where(e => ids.Contains(e.Id)).Select(e => e.SyncedAt).ToListAsync())
                .Concat(await db.Sessions.AsNoTracking().Where(s => ids.Contains(s.EventId)).Select(s => s.CapturedAt).ToListAsync())
                .Append(newestFileUtc)
                .Max();
            if (lastActivity > limit) continue;

            var pending = unsent.Count(s => ids.Contains(s.EventId) || IsUnder(s.CompositePath, dir) || IsUnder(s.PhotoPath, dir));
            if (pending > 0)
            {
                keptUnsent++;
                _ = log?.LogWarningAsync("cleanup",
                    $"Événement « {name} » conservé sur le PC : {pending} séance(s) pas encore envoyée(s).");
                continue;
            }

            try { DeleteEventDirectory(root, dir); }
            catch (Exception ex)
            {
                _ = log?.LogWarningAsync("cleanup", $"Suppression du dossier « {name} » impossible : {ex.Message}");
                continue;
            }

            // Séances dont les fichiers n'existent plus (toutes envoyées). Les journaux d'impression
            // restent : ils portent le plafond par événement et ne pointent vers aucun fichier local.
            var sessions = await db.Sessions.AsNoTracking().Where(s => ids.Contains(s.EventId)).ToListAsync();
            var gone = sessions.Where(s => IsUnder(s.CompositePath, dir) || IsUnder(s.PhotoPath, dir)).Select(s => s.Id).ToList();
            if (gone.Count > 0)
            {
                await db.PrintCounts.Where(p => gone.Contains(p.SessionId)).ExecuteDeleteAsync();
                await db.Sessions.Where(s => gone.Contains(s.Id)).ExecuteDeleteAsync();
            }

            deleted++;
            freed += bytes;
            _ = log?.LogInfoAsync("cleanup", $"Événement « {name} » supprimé du PC ({FormatSize(bytes)} libéré(s)).");
        }

        return new EventCleanupReport(deleted, keptUnsent, freed);
    }

    /// <summary>
    /// Vrai seulement pour un dossier d'événement du kiosk (<c>{nom}_{id8}</c>) placé directement
    /// sous la racine des événements, et qui n'est pas un lien vers un autre dossier.
    /// </summary>
    internal static bool IsEventDirectory(string eventsRoot, string path)
    {
        try
        {
            var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(eventsRoot));
            var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
            if (!string.Equals(Path.GetDirectoryName(full), root, StringComparison.OrdinalIgnoreCase)) return false;
            if (SessionPathService.ShortIdFromDirectoryName(Path.GetFileName(full)) == null) return false;

            var info = new DirectoryInfo(full);
            return info.Exists && !info.Attributes.HasFlag(FileAttributes.ReparsePoint);
        }
        catch { return false; }
    }

    internal static void DeleteEventDirectory(string eventsRoot, string path)
    {
        if (!IsEventDirectory(eventsRoot, path))
            throw new InvalidOperationException($"Suppression refusée hors du dossier des événements : {path}");
        Directory.Delete(path, recursive: true);
    }

    private static bool IsUnder(string? file, string directory)
    {
        if (string.IsNullOrWhiteSpace(file)) return false;
        try
        {
            var dir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(directory)) + Path.DirectorySeparatorChar;
            return Path.GetFullPath(file).StartsWith(dir, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    /// <summary>Date d'écriture la plus récente (dossier compris) et taille totale des fichiers.</summary>
    private static (DateTime NewestWriteUtc, long Bytes) Scan(string directory)
    {
        var info   = new DirectoryInfo(directory);
        var newest = info.LastWriteTimeUtc;
        long bytes = 0;
        foreach (var file in info.EnumerateFiles("*", AllFiles))
        {
            bytes += file.Length;
            if (file.LastWriteTimeUtc > newest) newest = file.LastWriteTimeUtc;
        }
        return (newest, bytes);
    }

    private static string FreeSpace(string root)
    {
        try { return FormatSize(new DriveInfo(Path.GetPathRoot(Path.GetFullPath(root))!).AvailableFreeSpace); }
        catch { return "inconnu"; }
    }

    internal static string FormatSize(long bytes) => bytes >= 1L << 30
        ? $"{bytes / (double)(1L << 30):0.0} Go"
        : $"{bytes / (double)(1L << 20):0.0} Mo";
}
