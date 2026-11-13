using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

/// <summary>
/// Journaux de la borne : écrits d'abord dans SQLite, puis envoyés par la RPC kiosk_record_logs
/// (LAB-278), qui exige la licence du poste. Sans secret (borne pas encore associée), rien ne part :
/// les lignes attendent l'association ou la purge à 90 jours. Aucune erreur d'envoi ne remonte.
/// </summary>
public class KioskLogService : IKioskLogService
{
    // Journaux envoyés conservés 30 jours ; au-delà de 90 jours, même non envoyés (borne longtemps hors ligne).
    internal static readonly TimeSpan SyncedRetention = TimeSpan.FromDays(30);
    internal static readonly TimeSpan MaxRetention    = TimeSpan.FromDays(90);
    private static readonly TimeSpan PurgeInterval    = TimeSpan.FromHours(6);

    /// <summary>Lignes par appel : plafond accepté par la RPC.</summary>
    internal const int BatchSize = 100;

    /// <summary>Pause des envois après un PT429 (la limite serveur porte sur 15 min glissantes).</summary>
    internal static readonly TimeSpan RateLimitBackoff = TimeSpan.FromMinutes(5);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly INetworkMonitorService _network;
    // Pas ILicenseService : LicenseService → AdminPinService → journaux formerait une boucle.
    private readonly IKioskCredentials _credentials;
    private readonly ISupabaseService _supabase;
    private readonly TimeProvider _clock;
    private readonly string _appVersion;

    // Boucle de 2 minutes et retour du réseau peuvent se croiser : un seul envoi de la file à la fois.
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private long _lastPurgeTicks;
    private long _rateLimitedUntilTicks;
    // 1 = licence refusée : plus d'envoi immédiat, nouvel essai à la synchro suivante (UploadPendingAsync).
    private int _licenseRefused;

    public KioskLogService(
        IServiceScopeFactory scopeFactory,
        INetworkMonitorService network,
        IKioskCredentials credentials,
        ISupabaseService supabase)
        : this(scopeFactory, network, credentials, supabase, TimeProvider.System) { }

    internal KioskLogService(
        IServiceScopeFactory scopeFactory,
        INetworkMonitorService network,
        IKioskCredentials credentials,
        ISupabaseService supabase,
        TimeProvider clock)
    {
        _scopeFactory = scopeFactory;
        _network      = network;
        _credentials  = credentials;
        _supabase     = supabase;
        _clock        = clock;
        _appVersion   = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "?";
    }

    public Task LogErrorAsync  (string context, string message, string? stackTrace = null)
        => WriteAsync("error",   context, message, stackTrace);

    public Task LogWarningAsync(string context, string message)
        => WriteAsync("warning", context, message);

    public Task LogInfoAsync   (string context, string message)
        => WriteAsync("info",    context, message);

    private async Task WriteAsync(string level, string context, string message, string? stackTrace = null)
    {
        var entry = new KioskLogEntity
        {
            MachineId  = _credentials.MachineId,
            Level      = level,
            Context    = context,
            Message    = message.Length > 2000 ? message[..2000] : message,
            StackTrace = stackTrace?.Length > 4000 ? stackTrace[..4000] : stackTrace,
            AppVersion = _appVersion,
            OccurredAt = DateTime.UtcNow,
        };

        // 1. Écriture SQLite immédiate (survit hors ligne)
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.KioskLogs.Add(entry);
            await db.SaveChangesAsync();
            await PurgeIfDueAsync(db);
        }
        catch { /* non bloquant */ }

        // 2. Envoi immédiat si en ligne, sauf licence refusée depuis la dernière synchro
        if (_network.IsOnline && Volatile.Read(ref _licenseRefused) == 0)
            await TrySendOneAsync(entry);
    }

    public async Task UploadPendingAsync()
    {
        if (!await _sendGate.WaitAsync(0)) return;
        try
        {
            Volatile.Write(ref _licenseRefused, 0);
            if (!CanSendNow()) return;

            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            while (true)
            {
                var batch = await db.KioskLogs
                    .Where(l => !l.Synced)
                    .OrderBy(l => l.OccurredAt)
                    .Take(BatchSize)
                    .ToListAsync();
                if (batch.Count == 0) return;

                var result = await _supabase.RecordLogsAsync(batch.Select(ToRecord).ToList());
                if (!HandleResult(result)) return;

                foreach (var l in batch) l.Synced = true;
                await db.SaveChangesAsync();
                if (batch.Count < BatchSize) return;
            }
        }
        catch { /* non bloquant : nouvel essai à la synchro suivante */ }
        finally { _sendGate.Release(); }
    }

    private async Task TrySendOneAsync(KioskLogEntity entry)
    {
        try
        {
            if (!CanSendNow()) return;

            var result = await _supabase.RecordLogsAsync([ToRecord(entry)]);
            if (!HandleResult(result)) return;

            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var stored = await db.KioskLogs.FindAsync(entry.Id);
            if (stored != null) { stored.Synced = true; await db.SaveChangesAsync(); }
        }
        catch { /* non bloquant */ }
    }

    /// <summary>Secret lu à chaque envoi : la borne peut être associée après le démarrage.</summary>
    private bool CanSendNow()
        => !string.IsNullOrWhiteSpace(_credentials.Secret)
           && _clock.GetUtcNow().UtcTicks >= Interlocked.Read(ref _rateLimitedUntilTicks);

    /// <summary>
    /// <c>true</c> si le lot est accepté. Un refus laisse les lignes en attente ; licence refusée ou
    /// limite de débit suspendent les envois (jamais de journal ici : il relancerait un envoi).
    /// </summary>
    private bool HandleResult(KioskLogSendResult result)
    {
        if (result.Accepted) return true;

        if (result.ErrorCode == KioskLogSendResult.LicenseRefusedCode)
            Volatile.Write(ref _licenseRefused, 1);
        else if (result.ErrorCode is KioskLogSendResult.RateLimitedCode or "HTTP 429")
            Interlocked.Exchange(ref _rateLimitedUntilTicks, (_clock.GetUtcNow() + RateLimitBackoff).UtcTicks);
        return false;
    }

    internal static KioskLogRecord ToRecord(KioskLogEntity l) => new(
        Id:            l.Id,
        Level:         l.Level,
        Context:       l.Context,
        Message:       l.Message,
        StackTrace:    l.StackTrace,
        AppVersion:    l.AppVersion,
        OccurredAtUtc: DateTime.SpecifyKind(l.OccurredAt, DateTimeKind.Utc));

    private async Task PurgeIfDueAsync(AppDbContext db)
    {
        var now  = DateTime.UtcNow;
        var last = Interlocked.Read(ref _lastPurgeTicks);
        if (now.Ticks - last < PurgeInterval.Ticks) return;
        if (Interlocked.CompareExchange(ref _lastPurgeTicks, now.Ticks, last) != last) return;

        try { await PurgeOldLogsAsync(db, now); }
        catch { /* non bloquant : nouvel essai au prochain intervalle */ }
    }

    /// <summary>Supprime les journaux envoyés trop anciens, et tous ceux au-delà de la durée maximale.</summary>
    internal static Task<int> PurgeOldLogsAsync(AppDbContext db, DateTime nowUtc)
    {
        var syncedLimit = nowUtc - SyncedRetention;
        var maxLimit    = nowUtc - MaxRetention;
        return db.KioskLogs
            .Where(l => (l.Synced && l.OccurredAt < syncedLimit) || l.OccurredAt < maxLimit)
            .ExecuteDeleteAsync();
    }
}
