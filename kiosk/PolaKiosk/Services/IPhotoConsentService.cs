using PolaKiosk.Models.LocalDb;

namespace PolaKiosk.Services;

/// <summary>Consentement accepté sur l'écran RgpdView, gardé en mémoire le temps du parcours.</summary>
public sealed record PhotoConsent(string Text, DateTime ConsentedAtUtc);

/// <summary>Bilan d'un passage d'envoi : des nombres seulement.</summary>
public sealed record PhotoConsentSendSummary(int Sent, int Rejected, int Failed);

/// <summary>
/// Consentements photo (LAB-223) : table locale PhotoConsents, une ligne par séance, écrite dans la
/// même transaction que la séance (<see cref="Stage"/>), envoyée par la RPC
/// kiosk_record_photo_consent. Aucune donnée personnelle : journaux en nombres et codes seulement.
/// </summary>
public interface IPhotoConsentService
{
    /// <summary>
    /// Purge locale, puis envoi des consentements en attente. Ligne supprimée après succès ou refus
    /// définitif (<c>22023</c>) ; sinon gardée pour le cycle suivant. Un seul passage à la fois.
    /// </summary>
    Task<PhotoConsentSendSummary> SendPendingAsync();

    /// <summary>Supprime les consentements jamais envoyés au-delà de la conservation locale. Retourne leur nombre.</summary>
    Task<int> PurgeExpiredAsync();
}
