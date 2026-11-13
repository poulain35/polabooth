using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

/// <summary>
/// Événement envoyé sur la borne depuis le SaaS (LAB-245, RPC kiosk_get_event_request).
/// <paramref name="RequestedAt"/> est gardé tel quel pour être renvoyé à l'identique à la confirmation :
/// une confirmation tardive ne valide jamais un envoi plus récent.
/// </summary>
public record EventPushRequest(EventDto Event, string RequestedAt);

public enum EventPushOutcome
{
    /// <summary>Aucun envoi en attente.</summary>
    None,
    /// <summary>Pas le bon moment (séance invité en cours), réseau absent ou délai dépassé : l'envoi reste en attente.</summary>
    Skipped,
    /// <summary>Événement chargé et défini comme événement actif.</summary>
    Applied,
    /// <summary>Chargement impossible : raison signalée au SaaS, plus d'essai sans nouvel envoi.</summary>
    Failed,
}

/// <summary>
/// LAB-245 : l'admin choisit dans le SaaS l'événement de la borne. La borne lit l'envoi au démarrage puis
/// toutes les 20 s sur l'accueil ou la saisie du code (LAB-246), le charge au premier écran sans séance
/// invité, sans confirmation sur place, puis le confirme au SaaS. Le code d'accès et le .pola restent
/// possibles.
/// </summary>
public interface IEventPushService
{
    /// <summary>Un envoi lu et pas encore chargé.</summary>
    bool HasPending { get; }

    /// <summary>
    /// Relit l'envoi en attente (et renvoie d'abord une confirmation restée sans réponse). Une licence
    /// refusée vide l'envoi sans lever : le contrôle de licence de la boucle de fond s'en charge.
    /// </summary>
    Task PollAsync(CancellationToken ct = default);

    /// <summary>
    /// Charge l'envoi en attente si aucune séance invité n'est en cours. À appeler sur le fil d'affichage.
    /// <paramref name="showLoadingScreen"/> : sur l'accueil ou la saisie du code, l'écran « chargement de
    /// l'événement » s'affiche dès le début de la synchro, puis l'accueil une fois chargé ; en cas d'échec
    /// ou de report, retour à l'écran d'avant. False : le démarrage choisit lui-même son premier écran.
    /// </summary>
    Task<EventPushOutcome> TryApplyAsync(bool showLoadingScreen, CancellationToken ct = default);
}
