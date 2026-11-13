namespace PolaKiosk.Services;

/// <summary>Code d'association affiché sur la borne (RPC kiosk_pairing_start), valable 10 minutes.</summary>
public sealed record PairingCode(Guid PairingId, string Code, DateTimeOffset ExpiresAt);

/// <summary>Statuts renvoyés par la RPC kiosk_pairing_poll.</summary>
public enum PairingStatus
{
    /// <summary>En attente de validation dans le SaaS.</summary>
    Pending,
    /// <summary>Code expiré sans validation.</summary>
    Expired,
    /// <summary>Validé : le secret est remis, une seule fois.</summary>
    Approved,
    /// <summary>Secret déjà remis : la réponse précédente s'est perdue, la borne ne l'a pas reçu.</summary>
    Delivered,
    /// <summary>Annulé (nouveau code demandé pour ce PC, trop d'interrogations ou de mauvaises clés).</summary>
    Cancelled,
    NotFound,
    InvalidKey,
    /// <summary>Statut inattendu : la borne continue d'interroger tant que le code est valable.</summary>
    Unknown,
}

/// <summary>Réponse de kiosk_pairing_poll. <see cref="Secret"/> n'est jamais affiché ni journalisé.</summary>
public sealed record PairingPollResult(
    PairingStatus Status,
    string? Secret = null,
    Guid? LicenseId = null,
    string? Label = null,
    string? OrgName = null,
    Guid? OrgId = null)
{
    // Pas de secret dans ToString (journaux, messages d'erreur des tests).
    public override string ToString() => $"PairingPollResult {{ Status = {Status}, LicenseId = {LicenseId} }}";
}

/// <summary>Trop de demandes de code depuis cette adresse (erreur PT429 de kiosk_pairing_start).</summary>
public sealed class PairingRateLimitedException : Exception
{
    public PairingRateLimitedException() : base("Trop de demandes d'association depuis cette adresse.") { }
}

/// <summary>
/// Association de la borne à un compte (LAB-244). La clé K, tirée à chaque code, ne quitte jamais la
/// mémoire : le serveur n'en reçoit que l'empreinte SHA-256 à la demande du code, puis K elle-même
/// pour retirer le secret. Ni K ni le secret ne sont écrits ou journalisés.
/// </summary>
public interface IPairingService
{
    /// <summary>Tire une nouvelle clé K (la précédente est effacée) et demande un code.</summary>
    Task<PairingCode> StartAsync(CancellationToken ct = default);

    /// <summary>Interroge le serveur pour le code en cours. Lève une exception sur erreur réseau ou serveur.</summary>
    Task<PairingPollResult> PollAsync(CancellationToken ct = default);

    /// <summary>Efface la clé K et oublie le code en cours.</summary>
    void Forget();
}
