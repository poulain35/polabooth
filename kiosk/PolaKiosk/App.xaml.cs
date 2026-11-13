using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Threading;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Newtonsoft.Json;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk;

public partial class App : Application
{
    // Reprises tolérées après une erreur d'affichage, par minute.
    // Au-delà, l'erreur d'affichage revient en boucle : on quitte et le watchdog relance.
    private const int MaxRecoveriesPerMinute = 5;
    private static readonly TimeSpan NetworkCheckTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan StartupSyncTimeout  = TimeSpan.FromSeconds(4);
    private static readonly TimeSpan UpdatePollTimeout   = TimeSpan.FromSeconds(10);
    // Synchro d'un événement envoyé depuis le SaaS (design compris) : au-delà, nouvel essai au cycle suivant.
    private static readonly TimeSpan EventPushApplyTimeout = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan ShutdownTimeout     = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan BackgroundInterval  = TimeSpan.FromMinutes(2);
    // Lecture de l'événement envoyé depuis le SaaS sur l'accueil ou la saisie du code (LAB-246).
    private static readonly TimeSpan EventPushQuickInterval = TimeSpan.FromSeconds(20);

    private IHost? _host;
    private SingleInstance? _instance;
    private int _updateRunning;
    private UpdateRequest? _pendingUpdate; // demande reçue du SaaS, pas encore installée (modifiée sous _updateRunning)
    private int _eventPushRunning;
    private bool _restartRequested; // RestartApplication : relance après la fermeture (OnExit)
    private readonly RecoveryLimiter _recoveries = new(MaxRecoveriesPerMinute, TimeSpan.FromMinutes(1));

    protected override async void OnStartup(StartupEventArgs e)
    {
        // En tout premier : une erreur pendant l'initialisation (base, configuration) est aussi journalisée.
        AttachGlobalErrorHandlers();
        base.OnStartup(e);

        _instance = SingleInstance.TryAcquire();
        if (_instance == null)
        {
            FatalLog.Write("startup", "PolaKiosk est déjà lancé : cette nouvelle instance se ferme.");
            Shutdown();
            return;
        }

        try { await StartAsync(); }
        catch (Exception ex)
        {
            // Démarrage impossible : mieux vaut quitter (le watchdog relance) que rester ouvert sans écran.
            ExitForWatchdog("startup", ex);
        }
    }

    private async Task StartAsync()
    {
        // Réglages lus à côté de l'exécutable, quel que soit le dossier de lancement (raccourci,
        // démarrage auto, terminal) : sinon appsettings.json est introuvable et l'URL Supabase vide
        // (« Problème de connexion » au code événement). Tous les appsettings sont copiés dans bin.
        _host = Host.CreateDefaultBuilder()
            .UseContentRoot(AppContext.BaseDirectory)
            .ConfigureAppConfiguration((ctx, config) =>
            {
                // CreateDefaultBuilder charge déjà appsettings.json + appsettings.{DOTNET_ENVIRONMENT}.json.
                // appsettings.Instance.json (réglages privés de l'instance) se glisse entre les deux.
                InstanceSettings.Add(config);
                // appsettings.local.json = overrides DÉVELOPPEUR uniquement, jamais en production :
                // sinon une clé Supabase de dev (chargée en dernier) écraserait la prod
                // → URL prod + clé dev = authentification cassée. En prod (env=Production par défaut
                // sur un build publié), ce fichier est ignoré. Les réglages machine (imprimante…)
                // passent par machine-settings.json dans le DataDirectory, pas par ce fichier.
                if (ctx.HostingEnvironment.IsDevelopment())
                    config.AddJsonFile("appsettings.local.json", optional: true, reloadOnChange: false);
            })
            .ConfigureServices(ConfigureServices)
            .Build();

        await _host.StartAsync();
        var services = _host.Services;

        var dbContext = services.GetRequiredService<AppDbContext>();
        await dbContext.Database.EnsureCreatedAsync();

        // Mode WAL : écritures atomiques, base bien plus résistante à une coupure de courant.
        // journal_mode est persisté dans le fichier (une fois suffit) ; busy_timeout évite
        // les erreurs "database is locked" entre l'UI et les tâches de sync en arrière-plan.
        await dbContext.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");
        await dbContext.Database.ExecuteSqlRawAsync("PRAGMA synchronous=NORMAL;");
        await dbContext.Database.ExecuteSqlRawAsync("PRAGMA busy_timeout=5000;");

        await EnsureMissingTablesAsync(dbContext);

        // Photos en attente du questionnaire obligatoire (LAB-222), AVANT tout envoi : termine les
        // validations interrompues par un crash, supprime les parcours jamais validés.
        await services.GetRequiredService<ISessionService>().CleanupPendingAsync();

        // Écran admin bloqué tant qu'aucun PIN n'a été envoyé depuis le SaaS (page Licences)
        if (!services.GetRequiredService<IAdminPinService>().IsConfigured)
            _ = services.GetRequiredService<IKioskLogService>().LogWarningAsync("security",
                "Aucun PIN admin reçu : définissez-le dans le SaaS (page Licences) puis envoyez-le à la borne.");

        var navigation  = (NavigationService)services.GetRequiredService<INavigationService>();
        var mainWindow  = services.GetRequiredService<MainWindow>();
        navigation.SetFrame(mainWindow.MainFrame);
        // État du parcours invité (LAB-222) : créé tôt pour être remis à zéro à chaque accueil.
        services.GetRequiredService<IGuestJourneyService>();

        // ①② Afficher la fenêtre sur l'écran de chargement (couleurs fixes de la borne, rien à appliquer)
        mainWindow.Show();
        var kioskService = services.GetRequiredService<IKioskService>();
        kioskService.EnableKioskMode();
        mainWindow.Closing += (_, ev) => { if (kioskService.IsKioskModeEnabled) ev.Cancel = true; };

        // Retour automatique à l'accueil après inactivité (session abandonnée)
        services.GetRequiredService<IIdleTimeoutService>().Attach(mainWindow);

        // Aucune adresse Supabase (ni appsettings, ni machine-settings.json) : borne d'un autre loueur au
        // premier démarrage (open core K2). Saisie de l'adresse du SaaS, puis redémarrage ; rien d'autre
        // ne démarre (réseau, synchro, licence) tant qu'aucun serveur n'est connu.
        if (services.GetRequiredService<AppSettings>().Supabase.Source == SaasEndpointSource.None)
        {
            navigation.NavigateTo<SaasAddressView>();
            return;
        }

        navigation.NavigateTo<SplashView>();

        // Attendre que WPF ait rendu SplashView (ContextIdle = après tous les rendus en attente)
        await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle);

        // ③ Vrai contrôle du réseau (ping Supabase), puis synchro bornée : le jeton d'annulation
        //    va jusqu'aux appels HTTP. Hors ligne ou trop lent → le cache suffit.
        var networkMonitor = services.GetRequiredService<INetworkMonitorService>();
        var onlineSync     = services.GetRequiredService<IOnlineSyncService>();
        bool online;
        using (var cts = new CancellationTokenSource(NetworkCheckTimeout))
            online = await networkMonitor.CheckNowAsync(cts.Token);

        var resynced = false;
        if (online)
        {
            using (var cts = new CancellationTokenSource(StartupSyncTimeout))
                resynced = await onlineSync.ResyncAsync(cts.Token);
        }

        // ④ Mise à jour, seulement si le SaaS l'a demandée (LAB-200). Un échec (réseau, délai,
        //    empreinte) est signalé au SaaS et ramène sur Splash : licence, écran, réseau et
        //    heartbeat démarrent quand même.
        if (online)
        {
            using var cts = new CancellationTokenSource(UpdatePollTimeout);
            if (await RunUpdateAsync(poll: true, cts.Token)) return; // l'app se ferme, le watchdog relance la nouvelle version
        }

        // ④ bis Événement envoyé depuis le SaaS (LAB-245) : chargé dès le démarrage, sans saisie du code.
        //    La borne était éteinte ou hors ligne à l'envoi : il s'affiche à son prochain démarrage.
        var eventPushed = false;
        if (online)
        {
            using var cts = new CancellationTokenSource(UpdatePollTimeout);
            eventPushed = await RunEventPushAsync(poll: true, showLoadingScreen: false, cts.Token);
        }

        // ⑤ Pré-charger l'image de fond dans les ressources (zéro flash au chargement d'EventSetupView)
        await PreloadSetupBgImageAsync();

        // ⑥ Licence puis écran : reprise sur l'accueil si un événement était actif (relance
        //    après un plantage en plein événement), sinon saisie du code.
        StartScreen screen;
        using (var scope = services.CreateScope())
        {
            screen = await StartupFlow.ChooseStartScreenAsync(
                services.GetRequiredService<ILicenseService>(),
                services.GetRequiredService<IKioskStateService>(),
                scope.ServiceProvider.GetRequiredService<ISyncService>(),
                eventPushed);
        }
        switch (screen)
        {
            case StartScreen.Home:       navigation.NavigateTo<HomeView>();       break;
            case StartScreen.EventSetup: navigation.NavigateTo<EventSetupView>(); break;
            case StartScreen.EventLoading:
                navigation.NavigateTo<EventLoadingView>(new EventLoadingParameters(
                    services.GetRequiredService<IKioskStateService>().ActiveEventName ?? ""));
                break;
            default:                     navigation.NavigateTo<PairingView>();    break;
        }

        // Retour du réseau → envois en attente + resynchro. Le contrôle du ③ a déjà fixé l'état :
        // en ligne au démarrage, NetworkRestored ne sera pas levé, d'où le lancement ici.
        networkMonitor.NetworkRestored += (_, _) => _ = OnNetworkRestoredAsync(onlineSync);
        networkMonitor.Start();
        if (online)
            _ = resynced ? onlineSync.UploadPendingAsync() : onlineSync.RunAsync();

        var eventPush = services.GetRequiredService<IEventPushService>();

        // Demande reçue pendant une séance invité : elle s'installe dès le retour sur un écran sûr
        // (accueil, saisie du code), sans attendre le prochain cycle de fond.
        navigation.Navigated += (_, _) =>
        {
            // Licence refusée pendant une séance invité : retour à l'association dès l'écran sûr suivant.
            if (navigation.CurrentViewType == typeof(PairingView))
                Volatile.Write(ref _licenseRefused, 0);
            else if (Volatile.Read(ref _licenseRefused) == 1 && UpdateCoordinator.CanApplyNow(navigation.CurrentViewType))
            {
                Volatile.Write(ref _licenseRefused, 0);
                Dispatcher.BeginInvoke(() => navigation.NavigateTo<PairingView>());
                return;
            }

            // Événement envoyé depuis le SaaS pendant une séance invité (LAB-245) : chargé au retour à l'accueil.
            if (networkMonitor.IsOnline && eventPush.HasPending && UpdateCoordinator.CanApplyNow(navigation.CurrentViewType))
                _ = RunEventPushAsync(poll: false, showLoadingScreen: true, CancellationToken.None);

            if (networkMonitor.IsOnline && Volatile.Read(ref _pendingUpdate) != null
                && UpdateCoordinator.CanApplyNow(navigation.CurrentViewType))
                _ = RunUpdateAsync(poll: false, CancellationToken.None);
        };

        // Appareil photo vérifié dès le démarrage (LAB-263) : le premier battement de cœur le dit déjà.
        // L'accueil revérifie à chaque affichage puis toutes les 30 s.
        _ = services.GetRequiredService<ICameraHealthService>().CheckNowAsync();

        StartBackgroundLoop(networkMonitor, navigation);
        StartEventPushLoop(networkMonitor, navigation);
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
        var services       = _host!.Services;
        var licenseService = services.GetRequiredService<ILicenseService>();
        var cleanup        = services.GetRequiredService<IEventCleanupService>();
        var printLogs      = services.GetRequiredService<IPrintLogSyncService>();
        var kioskLogs      = services.GetRequiredService<IKioskLogService>();
        _ = Task.Run(async () =>
        {
            try { await cleanup.RunIfDueAsync(); }
            catch (Exception ex) { LogError("cleanup", ex); }

            while (true)
            {
                await Task.Delay(BackgroundInterval);
                if (_host == null) break;

                // Étapes isolées : l'échec de l'une n'empêche pas les autres (nouvel essai au prochain cycle).
                // Heartbeat en premier : un long envoi de photos ne retarde pas le « vu à ». Les envois en
                // attente qu'il annonce sont ceux restant après le cycle précédent (2 min de décalage).
                try { await licenseService.SendHeartbeatAsync(); }
                catch (Exception ex) { LogError("heartbeat", ex); }

                try { await cleanup.RunIfDueAsync(); }
                catch (Exception ex) { LogError("cleanup", ex); }

                // Réponses au questionnaire : envoi si en ligne, purge à 30 jours même hors ligne.
                try
                {
                    using var scope = services.CreateScope();
                    var responses = scope.ServiceProvider.GetRequiredService<IGuestResponseService>();
                    if (networkMonitor.IsOnline) await responses.SendPendingAsync();
                    else await responses.PurgeExpiredAsync();
                }
                catch (Exception ex) { LogError("sync-guest-responses", ex); }

                // Consentements photo (LAB-223) : même cycle, sans donnée personnelle.
                try
                {
                    using var scope = services.CreateScope();
                    var consents = scope.ServiceProvider.GetRequiredService<IPhotoConsentService>();
                    if (networkMonitor.IsOnline) await consents.SendPendingAsync();
                    else await consents.PurgeExpiredAsync();
                }
                catch (Exception ex) { LogError("sync-photo-consents", ex); }

                if (!networkMonitor.IsOnline) continue;

                // Borne retirée ou licence désactivée dans le SaaS (LAB-244) : retour à l'association.
                // Seul un refus du serveur compte ; une coupure réseau ne renvoie jamais à cet écran.
                try { await CheckLicenseStillValidAsync(licenseService, navigation); }
                catch (Exception ex) { LogError("license", ex); }

                // Impressions (LAB-230) : avant les séances, plus longues à envoyer (photos).
                try { await printLogs.SendPendingAsync(); }
                catch (Exception ex) { LogError(PrintLogSyncService.LogContext, ex); }

                // Journaux en attente (LAB-278) : licence refusée, limite de débit ou borne associée depuis.
                // Un refus garde les lignes pour le cycle suivant.
                try { await kioskLogs.UploadPendingAsync(); }
                catch (Exception ex) { LogError("sync-kiosk-logs", ex); }

                // Reprise des envois échoués alors que le réseau n'a jamais coupé (NetworkRestored
                // ne se redéclenche pas dans ce cas).
                try
                {
                    using var scope = services.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<ISessionService>().UploadPendingSessionsAsync();
                }
                catch (Exception ex) { LogError("background", ex); }

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
                if (_host == null) break;
                try
                {
                    var current = await Dispatcher.InvokeAsync(() => navigation.CurrentViewType);
                    if (!EventPushService.ShouldPollQuickly(current, networkMonitor.IsOnline)) continue;

                    using var cts = new CancellationTokenSource(UpdatePollTimeout);
                    await RunEventPushAsync(poll: true, showLoadingScreen: true, cts.Token);
                }
                catch (Exception ex) { LogError(EventPushService.LogContext, ex); }
            }
        });
    }

    /// <summary>
    /// Licence refusée par le serveur : écran d'association tout de suite si aucune séance invité n'est
    /// en cours, sinon au prochain écran sûr (voir le gestionnaire Navigated).
    /// </summary>
    private async Task CheckLicenseStillValidAsync(ILicenseService licenseService, INavigationService navigation)
    {
        var current = await Dispatcher.InvokeAsync(() => navigation.CurrentViewType);
        if (current == typeof(PairingView)) return; // l'écran vérifie lui-même
        if (!await licenseService.IsRefusedOnlineAsync()) return;

        await Dispatcher.InvokeAsync(() =>
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
    private async Task<bool> RunUpdateAsync(bool poll, CancellationToken pollToken)
    {
        // Démarrage, cycle de fond et arrivée sur un écran sûr : une seule opération à la fois, et
        // _pendingUpdate n'est modifiée que sous ce verrou.
        if (Interlocked.Exchange(ref _updateRunning, 1) == 1) return false;
        try
        {
            var services = _host!.Services;
            if (poll)
                _pendingUpdate = await services.GetRequiredService<IUpdateService>().GetPendingRequestAsync(pollToken);

            var request = _pendingUpdate;
            if (request == null) return false;

            var coordinator = services.GetRequiredService<UpdateCoordinator>();
            var outcome = await Dispatcher.InvokeAsync(() => coordinator.TryApplyAsync(request)).Task.Unwrap();
            switch (outcome)
            {
                case UpdateOutcome.Installing:
                    await Dispatcher.InvokeAsync(() => Shutdown());
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
            LogError("update", ex);
            return false;
        }
        finally { Volatile.Write(ref _updateRunning, 0); }
    }

    /// <summary>
    /// LAB-245 : événement envoyé depuis le SaaS. <paramref name="poll"/> = relit d'abord l'envoi en attente
    /// (kiosk_get_event_request) ; sinon charge celui déjà lu. Il se charge si aucune séance invité n'est
    /// en cours, sinon au prochain écran sûr. True = événement chargé. Ne lève jamais.
    /// </summary>
    private async Task<bool> RunEventPushAsync(bool poll, bool showLoadingScreen, CancellationToken pollToken)
    {
        // Démarrage, cycle de fond et arrivée sur un écran sûr : un seul chargement à la fois.
        if (Interlocked.Exchange(ref _eventPushRunning, 1) == 1) return false;
        try
        {
            var push = _host!.Services.GetRequiredService<IEventPushService>();
            if (poll) await push.PollAsync(pollToken);
            if (!push.HasPending) return false;

            using var cts = new CancellationTokenSource(EventPushApplyTimeout);
            var outcome = await Dispatcher.InvokeAsync(() => push.TryApplyAsync(showLoadingScreen, cts.Token)).Task.Unwrap();
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
            LogError(EventPushService.LogContext, ex);
            return false;
        }
        finally { Volatile.Write(ref _eventPushRunning, 0); }
    }

    private async Task OnNetworkRestoredAsync(IOnlineSyncService onlineSync)
    {
        // Levé sur un fil du minuteur : aucune exception ne doit en sortir.
        try
        {
            await onlineSync.RunAsync();
        }
        catch (Exception ex) { LogError("network-restored", ex); }
    }

    // ── Erreurs globales ─────────────────────────────────────────────────────

    private void AttachGlobalErrorHandlers()
    {
        // Le processus va s'arrêter : seul un journal synchrone est sûr d'être écrit.
        AppDomain.CurrentDomain.UnhandledException += (_, ev) =>
            FatalLog.Write("app", ev.ExceptionObject?.ToString() ?? "exception inconnue");

        TaskScheduler.UnobservedTaskException += (_, ev) =>
        {
            ev.SetObserved();
            LogError("task", ev.Exception);
        };

        // Exceptions sur le thread UI (le cas le plus fréquent) : on récupère au lieu de crasher
        // → retour à un écran sûr (accueil si un événement est chargé, sinon saisie du code).
        DispatcherUnhandledException += (_, ev) =>
        {
            ev.Handled = true;
            LogError("ui", ev.Exception);

            if (!_recoveries.TryRecover(DateTime.UtcNow))
            {
                ExitForWatchdog("ui", $"Plus de {MaxRecoveriesPerMinute} reprises en une minute.");
                return;
            }

            try
            {
                var nav   = _host!.Services.GetRequiredService<INavigationService>();
                var state = _host.Services.GetRequiredService<IKioskStateService>();
                if (_host.Services.GetRequiredService<AppSettings>().Supabase.Source == SaasEndpointSource.None)
                    nav.NavigateTo<SaasAddressView>();
                else if (state.ActiveEventId is { } id && id != Guid.Empty)
                    nav.NavigateTo<HomeView>();
                else
                    nav.NavigateTo<EventSetupView>();
            }
            catch (Exception ex) { ExitForWatchdog("ui-recovery", ex.ToString()); }
        };
    }

    /// <summary>Journal synchrone (fatal.log), puis copie dans les journaux kiosk si l'hôte est prêt.</summary>
    private void LogError(string context, Exception ex)
    {
        FatalLog.Write(context, ex);
        try
        {
            var log = _host?.Services.GetService<IKioskLogService>();
            if (log != null)
                _ = log.LogErrorAsync(context, $"{ex.GetType().Name}: {ex.Message}", ex.StackTrace);
        }
        catch { /* hôte en cours d'arrêt : fatal.log suffit */ }
    }

    private void ExitForWatchdog(string context, Exception ex) => ExitForWatchdog(context, ex.ToString());

    private void ExitForWatchdog(string context, string reason)
    {
        FatalLog.Write(context, $"{reason}{Environment.NewLine}Arrêt de l'application, relance par le watchdog.");
        ShutdownCamera();
        Environment.Exit(1);
    }

    // ── Helpers de chargement ────────────────────────────────────────────────

    /// <summary>
    /// Pré-charge l'image de fond de l'écran de saisie (config globale du SaaS, fichier local)
    /// dans Application.Resources → zéro flash dans EventSetupView. Les couleurs de cette config
    /// ne sont plus lues : l'identité de la borne est fixe (LAB-249).
    /// </summary>
    private async Task PreloadSetupBgImageAsync()
    {
        string? url = null;
        try
        {
            using var scope = _host!.Services.CreateScope();
            var path = scope.ServiceProvider.GetRequiredService<ISyncService>().GetSetupConfigPath();
            if (File.Exists(path))
            {
                var cfg = JsonConvert.DeserializeObject<KioskSetupConfig>(File.ReadAllText(path));
                if (cfg?.BgType == "image") url = cfg.BgImageUrl;
            }
        }
        catch { }

        if (string.IsNullOrEmpty(url)) return;
        try
        {
            var bmp = await Task.Run(() =>
            {
                var b = new System.Windows.Media.Imaging.BitmapImage();
                b.BeginInit();
                b.UriSource   = new Uri(url);
                b.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                b.EndInit();
                b.Freeze();
                return b;
            });
            Application.Current.Resources["KioskSetupBgImage"] = bmp;
        }
        catch { }
    }

    /// <summary>
    /// Adresse du SaaS enregistrée ou effacée (open core K2) : fermeture propre (caméra, hôte, verrou
    /// d'instance unique) puis relance aussitôt dans <see cref="OnExit"/>. Le watchdog relancerait de
    /// toute façon ; une seconde copie lancée par lui se fermerait (instance unique). Fil d'affichage.
    /// </summary>
    internal void RestartApplication()
    {
        _restartRequested = true;
        Shutdown();
    }

    // Synchrone et borné : un OnExit async rend la main avant la fin du nettoyage, le processus
    // s'arrête et la session Canon reste ouverte (« appareil occupé » au démarrage suivant).
    protected override void OnExit(ExitEventArgs e)
    {
        var host = _host;
        if (host != null)
        {
            ShutdownCamera();
            try
            {
                host.Services.GetService<INetworkMonitorService>()?.Stop();
                Task.Run(() => host.StopAsync(ShutdownTimeout)).Wait(ShutdownTimeout);
                host.Dispose();
            }
            catch (Exception ex) { FatalLog.Write("exit", ex); }
            _host = null;
        }
        _instance?.Dispose();
        if (_restartRequested) Relaunch();
        base.OnExit(e);
    }

    private static void Relaunch()
    {
        try
        {
            var exe = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(exe))
                Process.Start(new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = AppContext.BaseDirectory });
        }
        catch (Exception ex) { FatalLog.Write("restart", ex); } // le watchdog relancera
    }

    /// <summary>
    /// Ferme la session caméra : sinon l'appareil Canon reste « occupé » et le prochain démarrage
    /// échoue avec « aucun appareil détecté ». Hors du fil d'affichage, 5 s au plus.
    /// </summary>
    private void ShutdownCamera()
    {
        try
        {
            var camera = _host?.Services.GetService<ICameraService>();
            if (camera != null && !Task.Run(camera.ShutdownAsync).Wait(ShutdownTimeout))
                FatalLog.Write("exit", "Fermeture de la caméra non terminée après 5 s.");
        }
        catch (Exception ex) { FatalLog.Write("exit", ex); }
    }

    /// <summary>
    /// EnsureCreatedAsync ne modifie pas une DB existante.
    /// Cette méthode crée les tables ajoutées après la création initiale du fichier SQLite.
    /// </summary>
    private static async Task EnsureMissingTablesAsync(AppDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "PrintLogs" (
                "Id"           TEXT    NOT NULL CONSTRAINT "PK_PrintLogs" PRIMARY KEY,
                "EventId"      TEXT    NOT NULL,
                "SessionId"    TEXT    NOT NULL,
                "CompositeUrl" TEXT,
                "Copies"       INTEGER NOT NULL DEFAULT 1,
                "MachineId"    TEXT,
                "PrintedAt"    TEXT    NOT NULL,
                "Synced"       INTEGER NOT NULL DEFAULT 0
            )
            """);

        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "KioskLogs" (
                "Id"          TEXT    NOT NULL CONSTRAINT "PK_KioskLogs" PRIMARY KEY,
                "MachineId"   TEXT    NOT NULL DEFAULT '',
                "Level"       TEXT    NOT NULL DEFAULT 'error',
                "Context"     TEXT,
                "Message"     TEXT    NOT NULL DEFAULT '',
                "StackTrace"  TEXT,
                "AppVersion"  TEXT,
                "OccurredAt"  TEXT    NOT NULL,
                "Synced"      INTEGER NOT NULL DEFAULT 0
            )
            """);

        // LAB-225 : réponses au questionnaire en attente d'envoi (contenu chiffré DPAPI).
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "GuestResponses" (
                "Id"               TEXT    NOT NULL CONSTRAINT "PK_GuestResponses" PRIMARY KEY,
                "EventId"          TEXT    NOT NULL,
                "PayloadProtected" BLOB    NOT NULL,
                "MarketingConsent" INTEGER NOT NULL DEFAULT 0,
                "AnsweredAt"       TEXT    NOT NULL,
                "SessionIds"       TEXT    NOT NULL DEFAULT '[]',
                "Attempts"         INTEGER NOT NULL DEFAULT 0,
                "LastError"        TEXT
            )
            """);

        // LAB-223 : consentements photo en attente d'envoi (une ligne par séance).
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "PhotoConsents" (
                "Id"          TEXT    NOT NULL CONSTRAINT "PK_PhotoConsents" PRIMARY KEY,
                "EventId"     TEXT    NOT NULL,
                "SessionId"   TEXT    NOT NULL,
                "AccessCode"  TEXT    NOT NULL DEFAULT '',
                "ConsentText" TEXT    NOT NULL DEFAULT '',
                "ConsentedAt" TEXT    NOT NULL,
                "Attempts"    INTEGER NOT NULL DEFAULT 0,
                "LastError"   TEXT
            )
            """);

        // Colonnes ajoutées à des tables existantes (LAB-251 : dates de l'événement).
        await LocalDbColumns.EnsureAsync(db);
    }

    internal static void ConfigureServices(HostBuilderContext ctx, IServiceCollection services)
    {
        // Settings
        var settings = ctx.Configuration.Get<AppSettings>() ?? new AppSettings();

        // Réglages spécifiques à la machine (imprimante choisie dans l'admin) — persistés
        // dans le DataDirectory, prioritaires sur la config du build, conservés entre MAJ.
        var dataDir = Environment.ExpandEnvironmentVariables(settings.Kiosk.DataDirectory);
        Directory.CreateDirectory(dataDir);
        var machineSettings = new MachineSettingsService(dataDir);

        // Adresse Supabase (open core K2) : celle des appsettings prime ; sinon celle saisie sur la borne
        // (machine-settings.json), avec l'adresse du SaaS pour les QR codes ; sinon aucune.
        SaasEndpoint.Apply(settings, machineSettings.Current);
        if (!string.IsNullOrWhiteSpace(machineSettings.Current.PrinterName))
            settings.Kiosk.PrinterName = machineSettings.Current.PrinterName!;

        // Caméra choisie dans l'admin (null = détection automatique)
        var camMode = machineSettings.Current.CameraMode;
        if (!string.IsNullOrWhiteSpace(camMode))
        {
            settings.Camera.ForcedSource = camMode switch
            {
                "canon"  => CameraSource.Canon,
                "webcam" => CameraSource.Webcam,
                "mock"   => CameraSource.Mock,
                _        => settings.Camera.ForcedSource,
            };
            if (camMode == "webcam" && machineSettings.Current.WebcamIndex.HasValue)
                settings.Camera.WebcamIndex = machineSettings.Current.WebcamIndex.Value;
        }

        services.AddSingleton(settings);
        services.AddSingleton<IMachineSettingsService>(machineSettings);

        // Identité du poste (secret reçu à l'association, protégé par DPAPI) et PIN admin propre à la
        // borne. Le secret et le PIN de développement n'existent qu'en build Debug lancé en environnement
        // Development : jamais actifs sur une borne de production.
        string? devAdminPin = null, devSecret = null;
#if DEBUG
        if (ctx.HostingEnvironment.IsDevelopment())
        {
            devAdminPin = settings.Kiosk.DevAdminPin;
            devSecret   = settings.Kiosk.LicenseSecret;
        }
#endif
        services.AddSingleton<IKioskCredentials>(_ => new KioskCredentialsService(dataDir, devSecret));
        services.AddSingleton<IAdminPinService>(sp => new AdminPinService(
            sp.GetRequiredService<ISupabaseService>(), dataDir, devAdminPin, sp.GetRequiredService<IKioskLogService>()));

        var dbPath = Path.Combine(dataDir, "polakiosk.db");
        services.AddTransient<AppDbContext>(_ => new AppDbContext(
            new DbContextOptionsBuilder<AppDbContext>()
                .UseSqlite($"Data Source={dbPath}")
                .Options));

        // Détection caméra
        services.AddSingleton<ICameraDetectionService, CameraDetectionService>();

        // Sélection du service caméra selon la config et le matériel détecté
        services.AddSingleton<ICameraService>(sp =>
        {
            var detection = sp.GetRequiredService<ICameraDetectionService>();
            var selected = detection.SelectBestCamera();

            return selected.Source switch
            {
                CameraSource.Canon => new EdsdkCameraService(
                    sp.GetRequiredService<IKioskLogService>(), sp.GetRequiredService<IMachineSettingsService>()),
                CameraSource.Webcam => new WebcamCameraService(selected.DeviceIndex,
                    machineSettings.Current.WebcamWidthOrDefault, machineSettings.Current.WebcamHeightOrDefault),
                _ => new MockCameraService()
            };
        });

        // État de l'appareil photo (LAB-263) : présent / absent / inconnu, partagé par l'accueil, la prise
        // de vue et le battement de cœur. Vérifie la source choisie ci-dessus, sans jamais en changer.
        services.AddSingleton<ICameraHealthService>(sp => new CameraHealthService(
            new DeferredPresenceCheck(() => CameraPresence.For(sp.GetRequiredService<ICameraService>())),
            sp.GetRequiredService<IKioskLogService>()));

        // Autres services
        services.AddSingleton<INavigationService, NavigationService>();
        services.AddSingleton<IIdleTimeoutService, IdleTimeoutService>();
        services.AddSingleton<IUpdateService, UpdateService>();
        services.AddSingleton<UpdateCoordinator>();
        services.AddSingleton<IEventPushService, EventPushService>();
        services.AddSingleton<IDialogService, DialogService>();
        services.AddTransient<IPrintService, PrintService>();
        // Une seule instance : LicenseService prend la classe concrète.
        services.AddSingleton<SupabaseService>();
        services.AddSingleton<ISupabaseService>(sp => sp.GetRequiredService<SupabaseService>());
        services.AddSingleton<ICompositeService, CompositeService>();
        services.AddSingleton<SessionPathService>();
        services.AddSingleton<IEventCleanupService, EventCleanupService>();
        services.AddTransient<ISyncService, SyncService>();
        services.AddTransient<ISessionService, SessionService>();
        services.AddSingleton<IGuestJourneyService, GuestJourneyService>();
        services.AddTransient<IGuestResponseService, GuestResponseService>();
        services.AddTransient<IPhotoConsentService, PhotoConsentService>();
        services.AddSingleton<IPrintLogSyncService, PrintLogSyncService>();
        services.AddSingleton<INetworkMonitorService, NetworkMonitorService>();
        services.AddSingleton<IOnlineSyncService, OnlineSyncService>();
        services.AddSingleton<IKioskService, KioskService>();
        services.AddSingleton<IPendingUploadsCounter, PendingUploadsCounter>();
        services.AddSingleton<ILicenseService>(sp => new LicenseService(
            sp.GetRequiredService<SupabaseService>(), settings,
            sp.GetRequiredService<IKioskCredentials>(), sp.GetRequiredService<IAdminPinService>(),
            sp.GetRequiredService<IPendingUploadsCounter>(), dataDir, sp.GetRequiredService<ICameraHealthService>()));
        services.AddSingleton<IKioskLogService, KioskLogService>();
        services.AddTransient<IPairingService, PairingService>(); // une clé K par écran d'association
        services.AddTransient<PairingView>();
        services.AddTransient<PairingViewModel>();

        // Adresse du SaaS saisie sur la borne et « Changer de SaaS » (open core K2)
        services.AddSingleton<IKioskConfigClient, KioskConfigClient>();
        services.AddSingleton<IAppRestart, AppRestart>();
        services.AddTransient<ISaasSwitchService, SaasSwitchService>();
        services.AddTransient<SaasAddressView>();
        services.AddTransient<SaasAddressViewModel>();
        services.AddSingleton<IKioskStateService, KioskStateService>();
        services.AddTransient<SplashView>();
        services.AddTransient<UpdateView>();
        services.AddTransient<EventSetupView>();
        services.AddTransient<EventSetupViewModel>();
        services.AddTransient<AdminView>();
        services.AddTransient<AdminViewModel>();
        services.AddTransient<RgpdView>();
        services.AddTransient<RgpdViewModel>();
        services.AddTransient<AdminPinPadViewModel>();

        // Views & ViewModels
        services.AddTransient<MainWindow>();
        services.AddTransient<HomeView>();
        services.AddTransient<HomeViewModel>();
        services.AddTransient<LiveView>();
        services.AddTransient<LiveViewModel>();
        services.AddTransient<QuestionnaireView>();
        services.AddTransient<QuestionnaireViewModel>();
        services.AddTransient<ResultView>();
        services.AddTransient<ResultViewModel>();
        services.AddTransient<GalleryView>();
        services.AddTransient<GalleryViewModel>();
        services.AddTransient<EffectSelectView>();
        services.AddTransient<EffectSelectViewModel>();
        services.AddTransient<EventLoadingView>();
        services.AddTransient<EventLoadingViewModel>();
    }
}
