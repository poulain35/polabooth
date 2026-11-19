using System.Windows.Threading;
using Microsoft.Extensions.DependencyInjection;
using PolaKiosk.Services;
using PolaKiosk.Views;

namespace PolaKiosk;

/// <summary>
/// Tâches de fond de la borne (LAB-405, sorties de App) : cycle de 2 minutes, lecture de l'événement envoyé
/// depuis le SaaS (20 s), réglages de l'appareil photo demandés (LAB-428), mise à jour demandée, licence
/// refusée, et leur reprise au retour sur un écran sûr. Une seule mise à jour et un seul chargement d'événement à la fois, quel que soit l'appelant
/// (démarrage, boucles, navigation). Les erreurs passent par le journal de App (fatal.log puis kiosk).
/// </summary>
internal sealed class KioskBackgroundTasks
{
    internal static readonly TimeSpan UpdatePollTimeout   = TimeSpan.FromSeconds(10);
    // Synchro d'un événement envoyé depuis le SaaS (design compris) : au-delà, nouvel essai au cycle suivant.
    private static readonly TimeSpan EventPushApplyTimeout = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan ShutdownTimeout     = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan BackgroundInterval  = TimeSpan.FromMinutes(2);
    // Lecture de l'événement envoyé depuis le SaaS sur l'accueil ou la saisie du code (LAB-246).
    private static readonly TimeSpan EventPushQuickInterval = TimeSpan.FromSeconds(20);

    private readonly IServiceProvider _services;
    private readonly Dispatcher _dispatcher;
    private readonly Action _shutdown;
    private readonly Action<string, Exception> _logError;
    private readonly Func<bool> _isRunning;
    private int _updateRunning;
    private UpdateRequest? _pendingUpdate; // demande reçue du SaaS, pas encore installée (modifiée sous _updateRunning)
    private int _eventPushRunning;
    private int _cameraSyncRunning;

    /// <param name="shutdown">Fermeture de l'app (mise à jour lancée), appelée sur le fil d'affichage.</param>
    /// <param name="isRunning">Faux après la fermeture de l'hôte : les boucles s'arrêtent.</param>
    public KioskBackgroundTasks(IServiceProvider services, Dispatcher dispatcher, Action shutdown,
        Action<string, Exception> logError, Func<bool> isRunning)
    {
        _services   = services;
        _dispatcher = dispatcher;
        _shutdown   = shutdown;
        _logError   = logError;
        _isRunning  = isRunning;
    }

    /// <summary>Lance les deux boucles de fond (2 minutes et 20 s).</summary>
    public void Start(INetworkMonitorService networkMonitor, INavigationService navigation)
    {
        StartBackgroundLoop(networkMonitor, navigation);
        StartEventPushLoop(networkMonitor, navigation);
    }

    /// <summary>
    /// Demande reçue pendant une séance invité : elle s'installe dès le retour sur un écran sûr
    /// (accueil, saisie du code), sans attendre le prochain cycle de fond.
    /// </summary>
    public void WatchNavigation(INavigationService navigation, INetworkMonitorService networkMonitor, IEventPushService eventPush,
        ICameraSettingsSync cameraSync)
    {
        navigation.Navigated += (_, _) =>
        {
            // Licence refusée pendant une séance invité : retour à l'association dès l'écran sûr suivant.
            if (navigation.CurrentViewType == typeof(PairingView))
                Volatile.Write(ref _licenseRefused, 0);
            else if (Volatile.Read(ref _licenseRefused) == 1 && UpdateCoordinator.CanApplyNow(navigation.CurrentViewType))
            {
                Volatile.Write(ref _licenseRefused, 0);
                _dispatcher.BeginInvoke(() => navigation.NavigateTo<PairingView>());
                return;
            }

            // Événement envoyé depuis le SaaS pendant une séance invité (LAB-245) : chargé au retour à l'accueil.
            if (networkMonitor.IsOnline && eventPush.HasPending && UpdateCoordinator.CanApplyNow(navigation.CurrentViewType))
                _ = RunEventPushAsync(poll: false, showLoadingScreen: true, CancellationToken.None);

            // Réglages de l'appareil demandés pendant une séance invité (LAB-428) : appliqués au retour à l'accueil.
            if (networkMonitor.IsOnline && cameraSync.HasPending && UpdateCoordinator.CanApplyNow(navigation.CurrentViewType))
                _ = RunCameraSyncAsync(poll: false, CancellationToken.None);

            if (networkMonitor.IsOnline && Volatile.Read(ref _pendingUpdate) != null
                && UpdateCoordinator.CanApplyNow(navigation.CurrentViewType))
                _ = RunUpdateAsync(poll: false, CancellationToken.None);
        };
    }

    /// <summary>1 = licence refusée en ligne, retour à l'association au prochain écran sûr.</summary>
    private int _licenseRefused;

    /// <summary>
    /// Toutes les 2 minutes : heartbeat (monitoring SaaS), nettoyage du PC (au démarrage puis une fois
    /// par jour), réponses au questionnaire, consentements photo, impressions, journaux et séances en attente,
    /// MAJ demandée depuis le SaaS. L'événement envoyé depuis le SaaS a sa propre boucle (20 s).
    /// </summary>
    private void StartBackgroundLoop(INetworkMonitorService networkMonitor, INavigationService navigation)
    {
        var services       = _services;
        var licenseService = services.GetRequiredService<ILicenseService>();
        var cleanup        = services.GetRequiredService<IEventCleanupService>();
        var printLogs      = services.GetRequiredService<IPrintLogSyncService>();
        var kioskLogs      = services.GetRequiredService<IKioskLogService>();
        var cameraSync     = services.GetRequiredService<ICameraSettingsSync>();
        _ = Task.Run(async () =>
        {
            try { await cleanup.RunIfDueAsync(); }
            catch (Exception ex) { _logError("cleanup", ex); }

            while (true)
            {
                await Task.Delay(BackgroundInterval);
                if (!_isRunning()) break;

                // Étapes isolées : l'échec de l'une n'empêche pas les autres (nouvel essai au prochain cycle).
                // Heartbeat en premier : un long envoi de photos ne retarde pas le « vu à ». Les envois en
                // attente qu'il annonce sont ceux restant après le cycle précédent (2 min de décalage).
                // Rapport de l'appareil (LAB-428) relu juste avant, sur un écran sûr seulement.
                try { await _dispatcher.InvokeAsync(() => cameraSync.RefreshReportIfDueAsync()).Task.Unwrap(); }
                catch (Exception ex) { _logError(CameraSettingsSyncService.LogContext, ex); }

                try { await licenseService.SendHeartbeatAsync(); }
                catch (Exception ex) { _logError("heartbeat", ex); }

                try { await cleanup.RunIfDueAsync(); }
                catch (Exception ex) { _logError("cleanup", ex); }

                // Réponses au questionnaire : envoi si en ligne, purge à 30 jours même hors ligne.
                try
                {
                    using var scope = services.CreateScope();
                    var responses = scope.ServiceProvider.GetRequiredService<IGuestResponseService>();
                    if (networkMonitor.IsOnline) await responses.SendPendingAsync();
                    else await responses.PurgeExpiredAsync();
                }
                catch (Exception ex) { _logError("sync-guest-responses", ex); }

                // Consentements photo (LAB-223) : même cycle, sans donnée personnelle.
                try
                {
                    using var scope = services.CreateScope();
                    var consents = scope.ServiceProvider.GetRequiredService<IPhotoConsentService>();
                    if (networkMonitor.IsOnline) await consents.SendPendingAsync();
                    else await consents.PurgeExpiredAsync();
                }
                catch (Exception ex) { _logError("sync-photo-consents", ex); }

                if (!networkMonitor.IsOnline) continue;

                // Borne retirée ou licence désactivée dans le SaaS (LAB-244) : retour à l'association.
                // Seul un refus du serveur compte ; une coupure réseau ne renvoie jamais à cet écran.
                try { await CheckLicenseStillValidAsync(licenseService, navigation); }
                catch (Exception ex) { _logError("license", ex); }

                // Réglages de l'appareil demandés depuis le SaaS (LAB-428), hors accueil compris.
                using (var cts = new CancellationTokenSource(UpdatePollTimeout))
                    await RunCameraSyncAsync(poll: true, cts.Token);

                // Impressions (LAB-230) : avant les séances, plus longues à envoyer (photos).
                try { await printLogs.SendPendingAsync(); }
                catch (Exception ex) { _logError(PrintLogSyncService.LogContext, ex); }

                // Journaux en attente (LAB-278) : licence refusée, limite de débit ou borne associée depuis.
                // Un refus garde les lignes pour le cycle suivant.
                try { await kioskLogs.UploadPendingAsync(); }
                catch (Exception ex) { _logError("sync-kiosk-logs", ex); }

                // Reprise des envois échoués alors que le réseau n'a jamais coupé (NetworkRestored
                // ne se redéclenche pas dans ce cas).
                try
                {
                    using var scope = services.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<ISessionService>().UploadPendingSessionsAsync();
                }
                catch (Exception ex) { _logError("background", ex); }

                if (await RunUpdateAsync(poll: true, CancellationToken.None)) break;
            }
        });
    }

    /// <summary>
    /// LAB-246 : toutes les 20 s, en ligne sur l'accueil ou la saisie du code, lecture de l'événement envoyé
    /// depuis le SaaS (une petite RPC) puis chargement. Jamais pendant une séance invité : il attend le
    /// retour à l'accueil (gestionnaire Navigated, puis cette boucle). Une seule lecture à la fois
    /// (_eventPushRunning, partagé avec le démarrage et Navigated).
    /// </summary>
    private void StartEventPushLoop(INetworkMonitorService networkMonitor, INavigationService navigation)
    {
        _ = Task.Run(async () =>
        {
            while (true)
            {
                await Task.Delay(EventPushQuickInterval);
                if (!_isRunning()) break;
                try
                {
                    var current = await _dispatcher.InvokeAsync(() => navigation.CurrentViewType);
                    if (!EventPushService.ShouldPollQuickly(current, networkMonitor.IsOnline)) continue;

                    using (var cts = new CancellationTokenSource(UpdatePollTimeout))
                        await RunEventPushAsync(poll: true, showLoadingScreen: true, cts.Token);

                    // Réglages de l'appareil (LAB-428) : même rythme sur l'accueil, appliqués aussitôt.
                    using (var cts = new CancellationTokenSource(UpdatePollTimeout))
                        await RunCameraSyncAsync(poll: true, cts.Token);
                }
                catch (Exception ex) { _logError(EventPushService.LogContext, ex); }
            }
        });
    }

    /// <summary>
    /// Licence refusée par le serveur : écran d'association tout de suite si aucune séance invité n'est
    /// en cours, sinon au prochain écran sûr (voir le gestionnaire Navigated).
    /// </summary>
    private async Task CheckLicenseStillValidAsync(ILicenseService licenseService, INavigationService navigation)
    {
        var current = await _dispatcher.InvokeAsync(() => navigation.CurrentViewType);
        if (current == typeof(PairingView)) return; // l'écran vérifie lui-même
        if (!await licenseService.IsRefusedOnlineAsync()) return;

        await _dispatcher.InvokeAsync(() =>
        {
            if (navigation.CurrentViewType == typeof(PairingView)) return;
            if (UpdateCoordinator.CanApplyNow(navigation.CurrentViewType))
                navigation.NavigateTo<PairingView>();
            else
                Volatile.Write(ref _licenseRefused, 1);
        });
    }

    /// <summary>
    /// LAB-200 : la borne ne se met à jour que sur demande depuis le SaaS. <paramref name="poll"/> = lit
    /// d'abord la demande en attente (kiosk_get_update_request) ; sinon applique celle déjà reçue. La
    /// demande s'installe si aucune séance invité n'est en cours (<see cref="UpdateCoordinator"/>), sinon
    /// elle attend le prochain écran sûr. True = installation lancée et fermeture demandée.
    /// Ne lève jamais : un échec (signalé au SaaS) laisse l'app tourner.
    /// </summary>
    internal async Task<bool> RunUpdateAsync(bool poll, CancellationToken pollToken)
    {
        // Démarrage, cycle de fond et arrivée sur un écran sûr : une seule opération à la fois, et
        // _pendingUpdate n'est modifiée que sous ce verrou.
        if (Interlocked.Exchange(ref _updateRunning, 1) == 1) return false;
        try
        {
            var services = _services;
            if (poll)
                _pendingUpdate = await services.GetRequiredService<IUpdateService>().GetPendingRequestAsync(pollToken);

            var request = _pendingUpdate;
            if (request == null) return false;

            var coordinator = services.GetRequiredService<UpdateCoordinator>();
            var outcome = await _dispatcher.InvokeAsync(() => coordinator.TryApplyAsync(request)).Task.Unwrap();
            switch (outcome)
            {
                case UpdateOutcome.Installing:
                    await _dispatcher.InvokeAsync(_shutdown);
                    return true;
                case UpdateOutcome.Failed:
                    _pendingUpdate = null; // échec signalé : plus d'essai sans nouvelle demande
                    return false;
                default:
                    return false; // séance invité en cours : la demande attend le prochain écran sûr
            }
        }
        catch (OperationCanceledException) when (pollToken.IsCancellationRequested)
        {
            return false; // lecture trop lente au démarrage : nouvel essai au prochain cycle
        }
        catch (Exception ex)
        {
            _logError("update", ex);
            return false;
        }
        finally { Volatile.Write(ref _updateRunning, 0); }
    }

    /// <summary>
    /// LAB-245 : événement envoyé depuis le SaaS. <paramref name="poll"/> = relit d'abord l'envoi en attente
    /// (kiosk_get_event_request) ; sinon charge celui déjà lu. Il se charge si aucune séance invité n'est
    /// en cours, sinon au prochain écran sûr. True = événement chargé. Ne lève jamais.
    /// </summary>
    internal async Task<bool> RunEventPushAsync(bool poll, bool showLoadingScreen, CancellationToken pollToken)
    {
        // Démarrage, cycle de fond et arrivée sur un écran sûr : un seul chargement à la fois.
        if (Interlocked.Exchange(ref _eventPushRunning, 1) == 1) return false;
        try
        {
            var push = _services.GetRequiredService<IEventPushService>();
            if (poll) await push.PollAsync(pollToken);
            if (!push.HasPending) return false;

            using var cts = new CancellationTokenSource(EventPushApplyTimeout);
            var outcome = await _dispatcher.InvokeAsync(() => push.TryApplyAsync(showLoadingScreen, cts.Token)).Task.Unwrap();
            return outcome == EventPushOutcome.Applied;
        }
        catch (OperationCanceledException) when (pollToken.IsCancellationRequested)
        {
            return false; // lecture trop lente : nouvel essai au prochain cycle
        }
        catch (Exception ex) when (SyncService.IsNetworkUnavailable(ex, pollToken))
        {
            return false; // réseau coupé : pas de journal toutes les 20 s, nouvel essai au prochain cycle
        }
        catch (Exception ex)
        {
            _logError(EventPushService.LogContext, ex);
            return false;
        }
        finally { Volatile.Write(ref _eventPushRunning, 0); }
    }

    /// <summary>
    /// LAB-428 : réglages de l'appareil photo demandés depuis le SaaS. <paramref name="poll"/> = relit
    /// d'abord la demande (kiosk_get_camera_request) ; sinon applique celle déjà lue. Appliquée seulement
    /// sur un écran sûr, sinon au prochain. Une seule synchro à la fois. Ne lève jamais.
    /// </summary>
    internal async Task RunCameraSyncAsync(bool poll, CancellationToken pollToken)
    {
        if (Interlocked.Exchange(ref _cameraSyncRunning, 1) == 1) return;
        try
        {
            var sync = _services.GetRequiredService<ICameraSettingsSync>();
            if (poll) await sync.PollAsync(pollToken);
            if (!sync.HasPending) return;
            await _dispatcher.InvokeAsync(() => sync.TryApplyAsync()).Task.Unwrap();
        }
        catch (OperationCanceledException) when (pollToken.IsCancellationRequested)
        {
            // lecture trop lente : nouvel essai au prochain cycle
        }
        catch (Exception ex) when (SyncService.IsNetworkUnavailable(ex, pollToken))
        {
            // réseau coupé : pas de journal toutes les 20 s, nouvel essai au prochain cycle
        }
        catch (Exception ex) { _logError(CameraSettingsSyncService.LogContext, ex); }
        finally { Volatile.Write(ref _cameraSyncRunning, 0); }
    }

    internal async Task OnNetworkRestoredAsync(IOnlineSyncService onlineSync)
    {
        // Levé sur un fil du minuteur : aucune exception ne doit en sortir.
        try
        {
            await onlineSync.RunAsync();
        }
        catch (Exception ex) { _logError("network-restored", ex); }
    }
}
