namespace PolaKiosk.ViewModels;

/// <summary>
/// <paramref name="ContinueToHome"/> : l'écran passe seul à l'accueil après 2 s. False pour un événement
/// envoyé depuis le SaaS (LAB-246) : l'écran s'affiche pendant la synchro, le service d'envoi choisit
/// l'écran suivant (accueil une fois chargé, écran précédent en cas d'échec).
/// </summary>
public record EventLoadingParameters(string EventName, bool ContinueToHome = true);
