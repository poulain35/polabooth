using System.Diagnostics;
using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PolaKiosk.Services;
using PolaKiosk.Views;

namespace PolaKiosk;

/// <summary>
/// Application WPF : instance unique, gestion globale des erreurs, fermeture et relance. L'hôte et ses
/// services (<see cref="KioskServices"/>), le démarrage (<see cref="StartupSequence"/>) et les tâches
/// de fond (<see cref="KioskBackgroundTasks"/>) sont dans leurs propres classes (LAB-405).
/// </summary>
public partial class App : Application
{
    // Reprises tolérées après une erreur d'affichage, par minute.
    // Au-delà, l'erreur d'affichage revient en boucle : on quitte et le watchdog relance.
    private const int MaxRecoveriesPerMinute = 5;
    private static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(5);

    private IHost? _host;
    private SingleInstance? _instance;
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

        // Relancée à la main après « Quitter vers Windows » : le watchdog reprend la surveillance.
        WatchdogStop.Clear(KioskPaths.LocalRoot);
        // Lancée à la main (pas de lancement au démarrage de Windows) : le watchdog n'est pas là pour
        // relancer l'app après un plantage ou une mise à jour, elle le lance elle-même.
        WatchdogLauncher.EnsureRunning();

        try { await StartAsync(); }
        catch (Exception ex)
        {
            // Démarrage impossible : mieux vaut quitter (le watchdog relance) que rester ouvert sans écran.
            ExitForWatchdog("startup", ex);
        }
    }

    private async Task StartAsync()
    {
        _host = KioskServices.CreateHost();
        await _host.StartAsync();
        var services = _host.Services;
        var tasks = new KioskBackgroundTasks(services, Dispatcher, Shutdown, LogError, () => _host != null);
        await new StartupSequence(services, Dispatcher, tasks).RunAsync();
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
        FatalLog.Write(context, $"{reason}{Environment.NewLine}{FatalLog.WatchdogExitNotice}");
        ShutdownCamera();
        Environment.Exit(1);
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
}
