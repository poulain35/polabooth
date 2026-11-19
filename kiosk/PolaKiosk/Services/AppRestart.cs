using System.Windows;

namespace PolaKiosk.Services;

/// <summary>
/// Redémarrage ou arrêt volontaire de l'application. Le redémarrage sert quand l'adresse Supabase change
/// (open core K2) : les services qui parlent au serveur la lisent une seule fois, à leur création.
/// </summary>
public interface IAppRestart
{
    /// <summary>Ferme l'application proprement (caméra, hôte), puis la relance aussitôt.</summary>
    void Restart();

    /// <summary>
    /// « Quitter vers Windows » : pose <see cref="WatchdogStop"/> (le watchdog ne relance plus l'app), puis
    /// ferme l'application proprement. Lève une exception si le fichier n'a pas pu être écrit (rien n'est fermé).
    /// </summary>
    void QuitToWindows();
}

internal sealed class AppRestart : IAppRestart
{
    public void Restart()
    {
        if (Application.Current is App app)
            app.Dispatcher.BeginInvoke(app.RestartApplication);
    }

    public void QuitToWindows()
    {
        WatchdogStop.Request(KioskPaths.LocalRoot);
        if (Application.Current is App app)
            app.Dispatcher.BeginInvoke(() => app.Shutdown());
    }
}
