using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

/// <summary>
/// Réponses validées d'un invité, telles que saisies au questionnaire (valeurs déjà normalisées :
/// e-mail en minuscules, téléphone en E.164).
/// </summary>
public sealed record GuestSubmission(
    Guid EventId,
    Guid SessionId,
    DateTime AnsweredAt,
    IReadOnlyList<QuestionConfig> Questions,
    IReadOnlyDictionary<string, object?> Answers,
    bool MarketingConsent,
    string? MarketingConsentText,
    string Notice,
    string AccessCode);

/// <summary>Bilan d'un passage d'envoi : des nombres seulement.</summary>
public sealed record GuestResponseSendSummary(int Sent, int Rejected, int Unreadable, int Failed);

/// <summary>
/// Réponses au questionnaire (LAB-225) : table locale GuestResponses (contenu chiffré DPAPI), envoi
/// par la RPC kiosk_record_guest_response, purge locale à 30 jours. Aucune donnée personnelle dans les
/// journaux : nombres et codes d'erreur seulement.
/// </summary>
public interface IGuestResponseService
{
    /// <summary>
    /// Mode obligatoire : ajoute la réponse au contexte SANS l'enregistrer. Appelé par
    /// <see cref="ISessionService.CommitPendingSessionAsync"/> juste avant le SaveChanges de la
    /// séance : séance et réponse sont écrites dans la même transaction SQLite.
    /// </summary>
    void Stage(AppDbContext db, GuestSubmission submission);

    /// <summary>Mode facultatif : la séance est déjà enregistrée, la réponse s'écrit seule.</summary>
    Task SaveAsync(GuestSubmission submission);

    /// <summary>
    /// Purge à 30 jours, puis envoi des réponses en attente. Ligne supprimée après succès, refus
    /// définitif (<c>22023</c>) ou contenu illisible ; sinon gardée pour le cycle suivant. Un seul
    /// passage à la fois.
    /// </summary>
    Task<GuestResponseSendSummary> SendPendingAsync();

    /// <summary>Supprime les réponses saisies il y a plus de 30 jours (même hors ligne). Retourne leur nombre.</summary>
    Task<int> PurgeExpiredAsync();
}
