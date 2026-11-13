namespace PolaKiosk.Services;

public enum PinCheckResult { Accepted, Rejected, NotConfigured }

/// <summary>Hash PBKDF2 du PIN admin envoyé par le SaaS (RPC kiosk_get_admin_pin), et sa vérification.</summary>
public record AdminPinHash(string Hash, DateTime? SetAt);

/// <summary>
/// PIN admin propre à chaque borne, défini dans le SaaS (page Licences). Le hash reçu est conservé
/// localement (DPAPI) : le PIN fonctionne hors ligne.
/// </summary>
public interface IAdminPinService
{
    /// <summary>Faux tant qu'aucun PIN n'a été reçu (écran admin bloqué en production).</summary>
    bool IsConfigured { get; }

    /// <summary>Vérification en temps constant. Coûteuse (PBKDF2) : à appeler hors du fil d'affichage.</summary>
    PinCheckResult Verify(string pin);

    /// <summary>Récupère le dernier PIN envoyé à la borne. Ne lève jamais d'exception (hors ligne = PIN local conservé).</summary>
    Task RefreshAsync(CancellationToken ct = default);
}
