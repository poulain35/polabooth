using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk;

/// <summary>
/// Démarrage de la borne, hôte démarré (LAB-405, sorti de App.OnStartup) : base locale, journaux du
/// lancement précédent, fenêtre, réseau, synchro, mise à jour, événement envoyé, premier écran, puis
/// tâches de fond. Une exception remonte à App, qui quitte pour le watchdog.
/// </summary>
internal sealed class StartupSequence(IServiceProvider services, Dispatcher dispatcher, KioskBackgroundTasks tasks)
{
    private static readonly TimeSpan NetworkCheckTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan StartupSyncTimeout  = TimeSpan.FromSeconds(4);

    public async Task RunAsync()
    {
        // Base neuve : toutes les tables et colonnes du modèle. Une base d'une ancienne version n'est
        // pas complétée (aucune borne en service avant LAB-401) : la supprimer pour la recréer.
        var dbContext = services.GetRequiredService<AppDbContext>();
        await dbContext.Database.EnsureCreatedAsync();

        // Mode WAL : écritures atomiques, base bien plus résistante à une coupure de courant.
        // journal_mode est persisté dans le fichier (une fois suffit) ; busy_timeout évite
        // les erreurs "database is locked" entre l'UI et les tâches de sync en arrière-plan.
        await dbContext.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");
        await dbContext.Database.ExecuteSqlRawAsync("PRAGMA synchronous=NORMAL;");
        await dbContext.Database.ExecuteSqlRawAsync("PRAGMA busy_timeout=5000;");

        // Photos en attente du questionnaire obligatoire (LAB-222), AVANT tout envoi : termine les
        // validations interrompues par un crash, supprime les parcours jamais validés.
        await services.GetRequiredService<ISessionService>().CleanupPendingAsync();

        // Plantages du lancement précédent (LAB-332) : fatal.log → journaux kiosk, à leur heure d'origine,
        // avant tout changement d'événement (ils prennent l'événement actif au plantage).
        try
        {
            await new FatalLogForwarder(FatalLog.FilePath, FatalLog.OldFilePath, FatalLogForwarder.MarkPathFor(FatalLog.FilePath),
                services.GetRequiredService<IKioskLogService>(), services.GetRequiredService<IKioskCredentials>().MachineId)
                .ForwardAsync();
        }
        catch { /* le démarrage continue : fatal.log reste sur le PC */ }

        // Écran admin bloqué tant qu'aucun PIN n'a été envoyé depuis le SaaS (page Licences).
        // Rappel au plus une fois par jour : la borne redémarre souvent (LAB-326).
        if (!services.GetRequiredService<IAdminPinService>().IsConfigured)
            _ = services.GetRequiredService<IKioskLogService>().LogWarningOncePerDayAsync("security",
                "Aucun PIN admin reçu : définissez-le dans le SaaS (page Licences) puis envoyez-le à la borne.");

        var navigation  = (NavigationService)services.GetRequiredService<INavigationService>();
        var mainWindow  = services.GetRequiredService<MainWindow>();
        navigation.SetFrame(mainWindow.MainFrame);
        // État du parcours invité (LAB-222) et cadre choisi (LAB-315) : créés tôt pour être remis à zéro à chaque accueil.
        services.GetRequiredService<IGuestJourneyService>();
        services.GetRequiredService<IFrameSelection>();

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
        await dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle);

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
            using var cts = new CancellationTokenSource(KioskBackgroundTasks.UpdatePollTimeout);
            if (await tasks.RunUpdateAsync(poll: true, cts.Token)) return; // l'app se ferme, le watchdog relance la nouvelle version
        }

        // ④ bis Événement envoyé depuis le SaaS (LAB-245) : chargé dès le démarrage, sans saisie du code.
        //    La borne était éteinte ou hors ligne à l'envoi : il s'affiche à son prochain démarrage.
        var eventPushed = false;
        if (online)
        {
            using var cts = new CancellationTokenSource(KioskBackgroundTasks.UpdatePollTimeout);
            eventPushed = await tasks.RunEventPushAsync(poll: true, showLoadingScreen: false, cts.Token);
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

        // Ligne de démarrage (LAB-326), une par lancement, avec l'événement repris ou chargé ci-dessus.
        LogStartupReport(services, mainWindow);

        // Retour du réseau → envois en attente + resynchro. Le contrôle du ③ a déjà fixé l'état :
        // en ligne au démarrage, NetworkRestored ne sera pas levé, d'où le lancement ici.
        networkMonitor.NetworkRestored += (_, _) => _ = tasks.OnNetworkRestoredAsync(onlineSync);
        networkMonitor.Start();
        if (online)
            _ = resynced ? onlineSync.UploadPendingAsync() : onlineSync.RunAsync();

        // Demande ou événement reçu pendant une séance invité : appliqué dès le retour sur un écran sûr.
        tasks.WatchNavigation(navigation, networkMonitor, services.GetRequiredService<IEventPushService>());

        // Appareil photo vérifié dès le démarrage (LAB-263) : le premier battement de cœur le dit déjà.
        // L'accueil revérifie à chaque affichage puis toutes les 30 s.
        _ = services.GetRequiredService<ICameraHealthService>().CheckNowAsync();

        tasks.Start(networkMonitor, navigation);
    }

    /// <summary>Écran lu ici (fil d'affichage) ; disque, imprimante et registre lus en arrière-plan.</summary>
    private static void LogStartupReport(IServiceProvider services, Window mainWindow)
    {
        string? screen = null;
        try
        {
            var dpi = VisualTreeHelper.GetDpi(mainWindow);
            screen = StartupReport.DescribeScreen(SystemParameters.PrimaryScreenWidth, SystemParameters.PrimaryScreenHeight,
                dpi.DpiScaleX, dpi.DpiScaleY);
        }
        catch { /* écran inconnu */ }

        var settings = services.GetRequiredService<AppSettings>();
        var state    = services.GetRequiredService<IKioskStateService>();
        var log      = services.GetRequiredService<IKioskLogService>();
        _ = Task.Run(async () =>
        {
            try { await log.LogInfoAsync(StartupReport.LogContext, StartupReport.Format(StartupReport.Collect(settings, state, screen))); }
            catch { /* le démarrage continue sans sa ligne */ }
        });
    }

    /// <summary>
    /// Pré-charge l'image de fond de l'écran de saisie dans Application.Resources → zéro flash dans
    /// EventSetupView. Lue dans le cache de la synchro par ImageLoader (LAB-394), jamais sur le réseau.
    /// Les couleurs de la config ne sont plus lues : l'identité de la borne est fixe (LAB-249).
    /// </summary>
    private async Task PreloadSetupBgImageAsync()
    {
        string? path;
        using (var scope = services.CreateScope())
            path = scope.ServiceProvider.GetRequiredService<ISyncService>().GetSetupBackgroundPath();
        if (path == null) return;

        var bmp = await Task.Run(() => ImageLoader.LoadForScreen(path, fill: true));
        if (bmp != null) Application.Current.Resources["KioskSetupBgImage"] = bmp;
    }
}
