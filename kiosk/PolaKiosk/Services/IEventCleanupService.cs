namespace PolaKiosk.Services;

/// <summary>Nettoyage automatique des dossiers d'événements terminés sur le PC.</summary>
public interface IEventCleanupService
{
    /// <summary>
    /// Supprime les événements terminés depuis plus du délai de l'Admin (30 jours par défaut),
    /// au plus une fois par jour (le premier appel, au démarrage, passe toujours). Ne lève jamais.
    /// </summary>
    Task RunIfDueAsync();
}
