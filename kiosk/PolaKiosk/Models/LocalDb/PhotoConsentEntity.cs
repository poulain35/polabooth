namespace PolaKiosk.Models.LocalDb;

/// <summary>
/// Consentement photo en attente d'envoi (LAB-223) : une ligne par séance, écrite avec la séance,
/// supprimée dès que le serveur l'a reçue. Aucune donnée personnelle : rien à chiffrer.
/// </summary>
public class PhotoConsentEntity
{
    /// <summary>UUID tiré par la borne, envoyé tel quel (p_consent_id) : un renvoi ne crée pas de doublon.</summary>
    public Guid     Id          { get; set; }
    public Guid     EventId     { get; set; }
    public Guid     SessionId   { get; set; }

    /// <summary>Code d'accès de l'événement, exigé par la RPC (comme pour la table Events).</summary>
    public string   AccessCode  { get; set; } = "";

    /// <summary>Message affiché sur l'écran de consentement, tel que l'invité l'a accepté.</summary>
    public string   ConsentText { get; set; } = "";

    /// <summary>UTC. Sert aussi à la purge locale.</summary>
    public DateTime ConsentedAt { get; set; }

    public int      Attempts    { get; set; }

    /// <summary>Code d'erreur seulement (code Postgres, statut HTTP ou type d'exception).</summary>
    public string?  LastError   { get; set; }
}
