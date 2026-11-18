using System.IO;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Fin de la prise de vue, hors de l'écran Live (LAB-405) : montage, enregistrement de la séance,
/// envoi anticipé et paramètres de l'écran suivant. Le questionnaire s'en sert aussi
/// (consentement et envoi anticipé à la validation).
/// </summary>
internal sealed class CaptureFinisher(
    ISyncService sync,
    ICompositeService composite,
    IKioskLogService kioskLog,
    ISessionService sessions,
    INetworkMonitorService network,
    IFrameSelection? frameSelection)
{
    private readonly ISyncService _sync = sync;
    private readonly ICompositeService _composite = composite;
    private readonly IKioskLogService _kioskLog = kioskLog;
    private readonly ISessionService _sessions = sessions;
    private readonly INetworkMonitorService _network = network;
    private readonly IFrameSelection? _frameSelection = frameSelection;

    /// <summary>
    /// Montage, enregistrement de la séance et paramètres de l'écran suivant. Ne lève jamais :
    /// photo brute compressée si le montage échoue, identifiant déjà tiré si la séance ne
    /// s'enregistre pas. Indépendante de l'écran Live (ni jeton de l'écran, ni propriété affichée) :
    /// elle tourne pendant le questionnaire, et <paramref name="token"/> l'arrête sur abandon.
    /// Mode obligatoire (<see cref="CaptureContext.IsPending"/>) : montage dans le dossier
    /// d'attente, sans séance ni envoi (faits à la validation).
    /// </summary>
    public async Task<CaptureResult> FinishCaptureAsync(CaptureContext context, CancellationToken token)
    {
        var photo         = context.PhotoPaths[0];
        var compositePath = photo;
        var format        = context.TemplateFormat;
        Guid? templateId  = null; // cadre réellement appliqué, gardé avec la séance (papier en galerie)

        CaptureResult Done() => Result(context, context.SessionId, compositePath, format, templateId);

        // Parcours abandonné avant le montage : rien à préparer.
        if (token.IsCancellationRequested) return Done();

        try
        {
            var template = context.Template
                ?? FrameChoice.Pick(await _sync.GetTemplatesAsync(context.EventId), _frameSelection?.SelectedTemplateId);
            if (template?.ThumbnailPath != null && File.Exists(template.ThumbnailPath))
            {
                // Déjà analysées au chargement de l'écran : servies par le cache du service.
                var templateZones = await _composite.GetPhotoZonesAsync(template.Id, template.CanvasJson);
                compositePath = await _composite.CreateCompositeAsync(
                    context.PhotoPaths.ToList(), template.ThumbnailPath, templateZones,
                    template.Format, context.CompositesDirectory);
                format     = template.Format;
                templateId = template.Id;
            }
            else
            {
                // Pas de template pour cet événement → on finalise quand même la photo brute
                // (compressée) dans le dossier composites, pour la galerie / le partage / l'impression.
                compositePath = await _composite.CreateFromSinglePhotoAsync(photo, context.CompositesDirectory);
            }
        }
        catch (Exception ex)
        {
            await _kioskLog.LogErrorAsync("capture",
                $"Échec du compositing (event {context.EventId}) : {ex.Message}", ex.ToString());
            // Dernier recours : copie compressée de la photo brute dans composites.
            try { compositePath = await _composite.CreateFromSinglePhotoAsync(photo, context.CompositesDirectory); }
            catch { compositePath = photo; }
        }

        // Mode obligatoire : rien en base ni sur le réseau avant la validation du questionnaire.
        if (context.IsPending || token.IsCancellationRequested) return Done();

        try
        {
            await _sessions.RecordSessionAsync(context.SessionId, context.EventId, context.CapturedAtUtc,
                photo, compositePath, StagePhotoConsent(context.PhotoConsent, context.SessionId, context.EventId, context.AccessCode),
                templateId);
        }
        catch (Exception ex)
        {
            // L'écran résultat rattachera la séance au montage : la photo reste partageable.
            await _kioskLog.LogErrorAsync("session",
                $"Enregistrement de la séance impossible (event {context.EventId}) : {ex.Message}", ex.ToString());
            return Done();
        }

        // Mode facultatif sans choix d'effet : la photo part pendant le questionnaire, le QR est
        // prêt à l'arrivée sur le résultat. Pas de doublon : l'écran résultat attend le même verrou
        // d'envoi puis relit l'URL déjà obtenue.
        if (context.EarlyUpload && _network.IsOnline)
            _ = UploadEarlyAsync(_sessions, _kioskLog, context.SessionId);

        return Done();
    }

    /// <summary>
    /// Loueur de la borne nommé par le questionnaire (open core L7) : société et email synchronisés
    /// (fiche contact de l'organisation), à défaut la section Contact de la config de l'instance.
    /// </summary>
    internal static QuestionnaireProvider QuestionnaireProviderFor(IKioskStateService state, AppSettings settings)
        => new(
            Name:         !string.IsNullOrWhiteSpace(state.ContactCompany) ? state.ContactCompany : settings.Contact.CompanyName,
            ContactEmail: !string.IsNullOrWhiteSpace(state.ContactEmail) ? state.ContactEmail : settings.Contact.Email);

    /// <summary>Consentement du parcours à écrire avec la séance, ou rien sans consentement.</summary>
    internal static Action<AppDbContext>? StagePhotoConsent(
        PhotoConsent? consent, Guid sessionId, Guid eventId, string accessCode)
        => consent == null ? null : db => PhotoConsentService.Stage(db, consent, sessionId, eventId, accessCode);

    /// <summary>Envoi anticipé en arrière-plan. Un échec est sans effet : l'écran résultat réessaie.</summary>
    internal static async Task UploadEarlyAsync(ISessionService sessions, IKioskLogService log, Guid sessionId)
    {
        try { await sessions.UploadSessionAsync(sessionId); }
        catch (Exception ex)
        {
            try { await log.LogWarningAsync("photo_upload", $"Envoi anticipé non abouti : {ex.Message}"); }
            catch { /* journal indisponible : l'écran résultat réessaie l'envoi */ }
        }
    }

    private static CaptureResult Result(CaptureContext context, Guid sessionId, string compositePath, string format,
        Guid? templateId)
        => new(
            SessionId:      sessionId,
            CapturedAtUtc:  context.CapturedAtUtc,
            EventId:        context.EventId,
            EventName:      context.EventName,
            CompositePath:  compositePath,
            PhotoPaths:     context.PhotoPaths,
            TemplateFormat: format,
            IsPending:      context.IsPending,
            NextParameters: CaptureResult.BuildNextParameters(context, sessionId, compositePath, format),
            TemplateId:     templateId);
}
