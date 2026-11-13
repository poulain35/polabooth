namespace PolaKiosk.Services;

public enum StartScreen { Pairing, EventSetup, Home, EventLoading }

/// <summary>Décisions du démarrage, sorties d'App.xaml.cs pour être testées.</summary>
public static class StartupFlow
{
    /// <summary>
    /// Écran après le démarrage. Licence refusée, ou impossible à vérifier sans cache valide : écran
    /// d'association (il revérifie la licence dès que le réseau revient, avant de proposer un code).
    /// Un événement actif encore en base locale (relance après un plantage, une mise à jour ou une
    /// coupure de courant) reprend directement sur l'accueil. Un événement envoyé depuis le SaaS et
    /// chargé pendant le démarrage (LAB-245, <paramref name="eventPushed"/>) passe par l'écran de
    /// chargement de l'événement, sans saisie du code.
    /// </summary>
    public static async Task<StartScreen> ChooseStartScreenAsync(
        ILicenseService license, IKioskStateService state, ISyncService sync, bool eventPushed = false)
    {
        if (await license.CheckAsync() != LicenseStatus.Valid) return StartScreen.Pairing;

        if (eventPushed && state.ActiveEventId is { } pushedId && pushedId != Guid.Empty)
            return StartScreen.EventLoading;

        if (state.ActiveEventId is { } eventId && eventId != Guid.Empty
            && await sync.GetCurrentEventAsync(eventId) != null)
            return StartScreen.Home;

        return StartScreen.EventSetup;
    }
}
