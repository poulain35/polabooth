namespace PolaKiosk.Models.LocalDb;

/// <summary>
/// Réponse au questionnaire en attente d'envoi (LAB-225). Créée complète à la validation, supprimée
/// dès que le serveur l'a reçue. Les données personnelles ne sont que dans <see cref="PayloadProtected"/>.
/// </summary>
public class GuestResponseEntity
{
    /// <summary>UUID tiré par la borne, envoyé tel quel (p_response_id) : un renvoi ne crée pas de doublon.</summary>
    public Guid     Id               { get; set; }
    public Guid     EventId          { get; set; }

    /// <summary>JSON chiffré DPAPI (CurrentUser) : réponses, questions, texte du consentement, empreinte de la mention, code d'accès.</summary>
    public byte[]   PayloadProtected { get; set; } = [];

    public bool     MarketingConsent { get; set; }

    /// <summary>UTC. Sert aussi à la purge locale à 30 jours.</summary>
    public DateTime AnsweredAt       { get; set; }

    /// <summary>Tableau JSON d'UUID de séance.</summary>
    public string   SessionIds       { get; set; } = "[]";

    public int      Attempts         { get; set; }

    /// <summary>Code d'erreur seulement (code Postgres, statut HTTP ou type d'exception), jamais de donnée perso.</summary>
    public string?  LastError        { get; set; }
}
