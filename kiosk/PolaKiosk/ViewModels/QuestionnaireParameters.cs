using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Paramètres de <see cref="QuestionnaireViewModel"/> : le montage en cours (lancé par Live juste
/// avant la navigation), son jeton d'arrêt (abandon du parcours) et la config du questionnaire.
/// <see cref="PhotoConsent"/> : consentement du parcours, écrit avec la séance à la validation
/// (mode obligatoire) ; jamais écrit sur un abandon.
/// <see cref="Provider"/> : loueur de la borne, nommé dans la notice (open core L7).
/// </summary>
public sealed record QuestionnaireParameters(
    Task<CaptureResult> Capture,
    CancellationTokenSource CaptureCancellation,
    QuestionnaireConfig Config,
    Guid SessionId,
    Guid EventId,
    string AccessCode,
    PhotoConsent? PhotoConsent = null,
    QuestionnaireProvider? Provider = null)
{
    /// <summary>Mode obligatoire : sans réponse, pas de photo (« Annuler » au lieu de « Passer »).</summary>
    public bool RequiredForPhoto => Config.RequiredForPhoto;
}
