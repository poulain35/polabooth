using System.IO;
using System.Windows;
using System.Windows.Interop;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk;

/// <summary>
/// Construction de l'hôte de la borne : réglages (appsettings, instance, réglages machine) et conteneur
/// de services. Sorti de App (LAB-405) ; les tests d'enregistrement passent par <see cref="Configure"/>.
/// </summary>
internal static class KioskServices
{
    /// <summary>Hôte prêt à démarrer, réglages lus à côté de l'exécutable.</summary>
    internal static IHost CreateHost()
    {
        // Réglages lus à côté de l'exécutable, quel que soit le dossier de lancement (raccourci,
        // démarrage auto, terminal) : sinon appsettings.json est introuvable et l'URL Supabase vide
        // (« Problème de connexion » au code événement). Tous les appsettings sont copiés dans bin.
        return Host.CreateDefaultBuilder()
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
            .ConfigureServices(Configure)
            .Build();
    }

    internal static void Configure(HostBuilderContext ctx, IServiceCollection services)
    {
        // Settings
        var settings = ctx.Configuration.Get<AppSettings>() ?? new AppSettings();

        // Réglages spécifiques à la machine (imprimante choisie dans l'admin) — persistés
        // dans le DataDirectory, prioritaires sur la config du build, conservés entre MAJ.
        var paths = KioskPaths.From(settings);
        var dataDir = paths.Root;
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

        var dbPath = paths.Database;
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
            sp.GetRequiredService<IKioskLogService>(),
            describeCamera: () => CameraPresence.Describe(sp.GetRequiredService<ICameraService>())));

        // Autres services
        services.AddSingleton<INavigationService, NavigationService>();
        services.AddSingleton<IIdleTimeoutService, IdleTimeoutService>();
        services.AddSingleton<IUpdateService, UpdateService>();
        services.AddSingleton<UpdateCoordinator>();
        services.AddSingleton<IEventPushService, EventPushService>();
        // Réglages de l'appareil photo demandés depuis le SaaS et rapport de l'appareil (LAB-428).
        services.AddSingleton<ICameraSettingsSync>(sp => new CameraSettingsSyncService(
            sp.GetRequiredService<ISupabaseService>(), () => sp.GetRequiredService<ICameraService>(),
            sp.GetRequiredService<IMachineSettingsService>(), sp.GetRequiredService<INavigationService>(),
            sp.GetRequiredService<IKioskLogService>()));
        services.AddSingleton<IDialogService, DialogService>();
        services.AddTransient<IPrintService, PrintService>();
        // Réglages du pilote (LAB-334) : la fenêtre des préférences s'ouvre au-dessus de la fenêtre de la borne.
        services.AddSingleton<IPrinterDriver>(_ => new WinSpoolPrinterDriver(
            () => Application.Current?.MainWindow is { } window ? new WindowInteropHelper(window).Handle : IntPtr.Zero));
        // Une seule instance : LicenseService prend la classe concrète.
        services.AddSingleton<SupabaseService>();
        services.AddSingleton<ISupabaseService>(sp => sp.GetRequiredService<SupabaseService>());
        services.AddSingleton<ICompositeService, CompositeService>();
        services.AddSingleton<SessionPathService>();
        services.AddSingleton<IEventCleanupService, EventCleanupService>();
        services.AddSingleton<IPolaHistory>(_ => new PolaHistory(dataDir));
        services.AddTransient<ISyncService, SyncService>();
        services.AddTransient<ISessionService, SessionService>();
        services.AddSingleton<IGuestJourneyService, GuestJourneyService>();
        services.AddSingleton<IFrameSelection, FrameSelectionService>();
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
            sp.GetRequiredService<IPendingUploadsCounter>(), dataDir, sp.GetRequiredService<ICameraHealthService>(),
            sp.GetRequiredService<ICameraSettingsSync>()));
        services.AddSingleton<IKioskLogService, KioskLogService>();
        // Événement et séance de chaque journal (LAB-326) : l'état est lu à l'écriture, pas injecté dans les journaux.
        services.AddSingleton<IKioskLogContext>(sp =>
        {
            var state = new Lazy<IKioskStateService>(sp.GetRequiredService<IKioskStateService>);
            return new KioskLogContext(() => state.Value.ActiveEventId);
        });
        services.AddTransient<IPairingService, PairingService>(); // une clé K par écran d'association
        services.AddTransient<PairingView>();
        services.AddTransient<PairingViewModel>();

        // Adresse du SaaS saisie sur la borne et « Changer de SaaS » (open core K2)
        services.AddSingleton<IKioskConfigClient, KioskConfigClient>();
        services.AddSingleton<IAppRestart, AppRestart>();
        services.AddSingleton<IWindowsStartup, WindowsStartup>();
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
        services.AddTransient<FrameSelectView>();
        services.AddTransient<FrameSelectViewModel>();
        services.AddTransient<RgpdView>();
        services.AddTransient<RgpdViewModel>();
        services.AddSingleton<IPinAttemptLimiter>(_ => new PinAttemptLimiter(paths.PinAttemptsFile));
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
