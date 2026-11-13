using System.Windows;

namespace PolaKiosk.Services;

/// <summary>
/// Redémarrage de l'application. Sert quand l'adresse Supabase change (open core K2) : les services qui
/// parlent au serveur la lisent une seule fois, à leur création.
/// </summary>
public interface IAppRestart
{
    /// <summary>Ferme l'application proprement (caméra, hôte), puis la relance aussitôt.</summary>
    void Restart();
}

internal sealed class AppRestart : IAppRestart
{
    public void Restart()
    {
        if (Application.Current is App app)
            app.Dispatcher.BeginInvoke(app.RestartApplication);
    }
}
