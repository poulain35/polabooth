using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

public sealed class PrintLogSyncService : IPrintLogSyncService
{
    internal const string LogContext = "sync-print-logs";

    // Envoi juste après l'impression, boucle de 2 minutes et retour du réseau peuvent se croiser :
    // une même ligne n'est envoyée que par un seul passage.
    private readonly SemaphoreSlim _sendGate = new(1, 1);

    private readonly IServiceScopeFactory   _scopes;
    private readonly ISupabaseService       _supabase;
    private readonly INetworkMonitorService _network;
    private readonly IKioskLogService       _log;

    public PrintLogSyncService(IServiceScopeFactory scopes, ISupabaseService supabase,
        INetworkMonitorService network, IKioskLogService log)
    {
        _scopes   = scopes;
        _supabase = supabase;
        _network  = network;
        _log      = log;
    }

    /// <summary>Tâche du dernier essai lancé par <see cref="SendSoon"/> (tests).</summary>
    internal Task LastBackgroundSend { get; private set; } = Task.CompletedTask;

    public void SendSoon()
    {
        if (!_network.IsOnline) return;
        LastBackgroundSend = Task.Run(async () =>
        {
            try { await SendPendingAsync(); }
            catch (Exception ex)
            {
                try { await _log.LogErrorAsync(LogContext, $"{ex.GetType().Name}: {ex.Message}", ex.ToString()); }
                catch { FatalLog.Write(LogContext, ex); }
            }
        });
    }

    public async Task<PrintLogSendSummary> SendPendingAsync()
    {
        if (!await _sendGate.WaitAsync(0)) return PrintLogSendSummary.None;
        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var rows = await db.PrintLogs.Where(l => !l.Synced).OrderBy(l => l.PrintedAt).ToListAsync();
            if (rows.Count == 0) return PrintLogSendSummary.None;

            var accessCodes = await LoadAccessCodesAsync(db, rows);
            int sent = 0, failed = 0, skipped = 0, rejected = 0;
            var codes = new SortedSet<string>(StringComparer.Ordinal);
            foreach (var row in rows)
            {
                if (!accessCodes.TryGetValue(row.EventId, out var accessCode))
                {
                    skipped++;
                    continue;
                }

                PrintLogSendResult result;
                try { result = await _supabase.RecordPrintAsync(ToRecord(row, accessCode)); }
                catch (Exception ex)
                {
                    // Réseau coupé ou trop lent : les suivantes échoueraient de même.
                    codes.Add(ex.GetType().Name);
                    failed++;
                    break;
                }

                if (result.Accepted)
                {
                    row.Synced = true;
                    await db.SaveChangesAsync();
                    sent++;
                }
                else if (result.ErrorCode == PrintLogSendResult.InvalidDataCode)
                {
                    // Refus définitif : sortie de la file, la ligne reste dans le compteur local.
                    row.Synced = true;
                    await db.SaveChangesAsync();
                    rejected++;
                }
                else
                {
                    // Licence ou événement refusés, erreur serveur : nouvel essai au cycle suivant.
                    codes.Add(result.ErrorCode ?? "inconnu");
                    failed++;
                }
            }

            if (sent > 0)
                await _log.LogInfoAsync(LogContext, $"{sent} impression(s) envoyée(s).");
            if (rejected > 0)
                await _log.LogWarningAsync(LogContext,
                    $"{rejected} impression(s) refusée(s) par le serveur (code {PrintLogSendResult.InvalidDataCode}) : retirée(s) de la file d'envoi.");
            if (skipped > 0)
                await _log.LogWarningAsync(LogContext,
                    $"{skipped} impression(s) sans code d'accès local : non envoyée(s).");
            if (failed > 0)
                await _log.LogWarningAsync(LogContext,
                    $"{failed} impression(s) non envoyée(s) (code : {string.Join(", ", codes)}) : nouvel essai au prochain cycle.");

            return new PrintLogSendSummary(sent, failed, skipped, rejected);
        }
        finally { _sendGate.Release(); }
    }

    private static async Task<Dictionary<Guid, string>> LoadAccessCodesAsync(AppDbContext db, List<PrintLogEntity> rows)
    {
        var eventIds = rows.Select(r => r.EventId).Distinct().ToList();
        var events = await db.Events.AsNoTracking()
            .Where(e => eventIds.Contains(e.Id))
            .Select(e => new { e.Id, e.AccessCode })
            .ToListAsync();
        return events.Where(e => !string.IsNullOrWhiteSpace(e.AccessCode))
                     .ToDictionary(e => e.Id, e => e.AccessCode);
    }

    internal static PrintLogRecord ToRecord(PrintLogEntity row, string accessCode) => new(
        Id:           row.Id,
        EventId:      row.EventId,
        AccessCode:   accessCode,
        SessionId:    row.SessionId,
        Copies:       row.Copies,
        PrintedAtUtc: DateTime.SpecifyKind(row.PrintedAt, DateTimeKind.Utc));
}
