namespace PolaKiosk.Services;

public interface IKioskStateService
{
    Guid?   ActiveEventId   { get; }
    string? ActiveEventName { get; }
    string? LastAccessCode  { get; }
    string? ContactCompany  { get; }
    string? ContactPhone    { get; }

    /// <summary>Email de contact de la société (contact_email), contact par défaut du questionnaire.</summary>
    string? ContactEmail    { get; }

    /// <summary>
    /// Compte (organisation) de la borne, appris au premier événement chargé en ligne : kiosk_get_event ne
    /// renvoie que des événements de ce compte. Null tant qu'aucun ne l'a été depuis l'association.
    /// Conservé quand l'événement actif est effacé.
    /// </summary>
    Guid?   AccountOrgId    { get; }

    /// <summary>Nom du compte reçu à l'association (pour « Cette borne a été retirée du compte … »).</summary>
    string? AccountName     { get; }

    Task SetActiveEventAsync(Guid eventId, string eventName, string accessCode);
    Task SetContactInfoAsync(string company, string? phone, string? email);
    Task ClearActiveEventAsync();

    /// <summary>Nouvelle association : nom et org_id du compte reçus (org_id inconnu → lu au prochain événement).</summary>
    Task SetPairedAccountAsync(string? accountName, Guid? orgId = null);

    Task SetAccountOrgIdAsync(Guid orgId);
}
