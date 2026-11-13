using Microsoft.Extensions.DependencyInjection;

namespace PolaKiosk.Services;

/// <summary>
/// Appelé sur un fil du minuteur réseau (NetworkRestored) ou en arrière-plan au démarrage :
/// chaque étape est isolée, une erreur (JSON tronqué, « database is locked »…) est journalisée
/// et n'empêche ni les étapes suivantes ni le reste de l'application.
/// </summary>
public class OnlineSyncService : IOnlineSyncService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IPrintLogSyncService _printLogs;
    private readonly IKioskLogService     _log;
    private readonly IKioskStateService   _state;
    private readonly IAdminPinService     _adminPin;
    private int _running;

    public OnlineSyncService(IServiceScopeFactory scopes, IPrintLogSyncService printLogs,
        IKioskLogService log, IKioskStateService state, IAdminPinService adminPin)
    {
        _scopes    = scopes;
        _printLogs = printLogs;
        _log       = log;
        _state     = state;
        _adminPin  = adminPin;
    }

    public async Task UploadPendingAsync()
    {
        await RunStepAsync("sync-sessions", async () =>
        {
            using var scope = _scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<ISessionService>().UploadPendingSessionsAsync();
        });
        await RunStepAsync("sync-guest-responses", async () =>
        {
            using var scope = _scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IGuestResponseService>().SendPendingAsync();
        });
        await RunStepAsync("sync-photo-consents", async () =>
        {
            using var scope = _scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IPhotoConsentService>().SendPendingAsync();
        });
        await RunStepAsync(PrintLogSyncService.LogContext, () => _printLogs.SendPendingAsync());
        await RunStepAsync("sync-kiosk-logs", _log.UploadPendingAsync);
    }

    public async Task<bool> ResyncAsync(CancellationToken ct = default)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var sync = scope.ServiceProvider.GetRequiredService<ISyncService>();

            await sync.SyncSetupConfigAsync(ct);
            if (_state.ActiveEventId is { } eventId && eventId != Guid.Empty)
                return await sync.SyncAsync(eventId, ct);
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return false; }
        catch (Exception ex)
        {
            await SafeLogAsync("sync", ex);
            return false;
        }
    }

    public async Task RunAsync()
    {
        // Deux retours du réseau rapprochés : le second passage est inutile.
        if (Interlocked.Exchange(ref _running, 1) == 1) return;
        try
        {
            await UploadPendingAsync();
            await ResyncAsync();
            // PIN admin envoyé depuis le SaaS pendant la coupure (RefreshAsync ne lève pas).
            await _adminPin.RefreshAsync();
        }
        catch (Exception ex) { FatalLog.Write("network-restored", ex); }
        finally { Volatile.Write(ref _running, 0); }
    }

    private async Task RunStepAsync(string context, Func<Task> step)
    {
        try { await step(); }
        catch (Exception ex) { await SafeLogAsync(context, ex); }
    }

    private async Task SafeLogAsync(string context, Exception ex)
    {
        try { await _log.LogErrorAsync(context, $"{ex.GetType().Name}: {ex.Message}", ex.ToString()); }
        catch { FatalLog.Write(context, ex); }
    }
}
