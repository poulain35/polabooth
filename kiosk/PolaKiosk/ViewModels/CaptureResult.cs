using System.IO;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Tout ce que <see cref="CaptureFinisher.FinishCaptureAsync"/> doit savoir, figé à la fin de la
/// prise de vue : la tâche de montage ne dépend plus de la durée de vie de l'écran Live.
/// </summary>
/// <param name="CapturedAtUtc">Début de la séance (avant le premier compte à rebours), heure de la
/// borne en UTC : envoyée à kiosk_record_photo, même si la photo part des heures plus tard (LAB-231).</param>
/// <param name="IsPending">Mode obligatoire : poses et montage dans <c>pending\{SessionId}\</c>,
/// pas de séance ni d'envoi avant la validation.</param>
/// <param name="EarlyUpload">Envoi anticipé dès la séance enregistrée (mode facultatif, sans choix d'effet).</param>
/// <param name="PhotoConsent">Consentement du parcours, figé au début de la prise de vue (l'accueil
/// le remet à zéro, parfois avant la fin du montage).</param>
/// <param name="Format">Format choisi à l'accueil (LAB-237) : GIF = <see cref="PhotoPaths"/> sont les N
/// images de l'animation ; le montage imprimé reste celui de ces photos.</param>
public sealed record CaptureContext(
    Guid SessionId,
    DateTime CapturedAtUtc,
    Guid EventId,
    string EventName,
    KioskConfig? Config,
    TemplateEntity? Template,
    string TemplateFormat,
    IReadOnlyList<string> PhotoPaths,
    string CompositesDirectory,
    bool IsPending,
    bool EarlyUpload,
    string AccessCode,
    string PrinterName,
    PhotoConsent? PhotoConsent = null,
    CaptureFormat Format = CaptureFormat.Photo);

/// <summary>
/// Montage terminé (ou son repli) : séance, chemins et paramètres prêts pour l'écran suivant
/// (<see cref="EffectSelectParams"/> ou <see cref="ResultParameters"/>).
/// </summary>
/// <param name="Animation">Animation de la séance (GIF réussi, LAB-237), null sinon.</param>
/// <param name="AnimationUnavailable">GIF dont l'animation a échoué : la séance reste une photo
/// (« Animation indisponible » à l'écran).</param>
public sealed record CaptureResult(
    Guid SessionId,
    DateTime CapturedAtUtc,
    Guid EventId,
    string EventName,
    string CompositePath,
    IReadOnlyList<string> PhotoPaths,
    string TemplateFormat,
    bool IsPending,
    object NextParameters,
    Guid? TemplateId = null,
    AnimationClip? Animation = null,
    bool AnimationUnavailable = false)
{
    /// <summary>L'invité choisit un effet : pas d'envoi anticipé (le montage final vient après).</summary>
    public bool ChoosesEffect => NextParameters is EffectSelectParams;

    /// <summary>
    /// Même résultat avec le montage à un autre chemin (photo validée déplacée) ; l'animation l'a
    /// suivi dans <c>animations\{séance}\</c> à côté du nouveau dossier des montages.
    /// </summary>
    public CaptureResult WithCompositePath(string compositePath)
    {
        var animation = Animation;
        if (animation != null && Path.GetDirectoryName(compositePath) is { Length: > 0 } compositesDir)
        {
            var dir    = SessionAnimation.DirectoryFor(compositesDir, SessionId);
            var video  = Path.Combine(dir, Path.GetFileName(animation.VideoPath));
            var poster = Path.Combine(dir, Path.GetFileName(animation.PosterPath));
            if (File.Exists(video)) animation = animation with { VideoPath = video, PosterPath = poster };
        }

        return this with
        {
            CompositePath  = compositePath,
            IsPending      = false,
            Animation      = animation,
            NextParameters = NextParameters switch
            {
                EffectSelectParams e => e with { CompositePath = compositePath },
                ResultParameters r   => r with { CompositePath = compositePath, VideoPath = animation?.VideoPath },
                var other            => other,
            },
        };
    }

    /// <summary>Va à l'écran de la photo : choix d'effet ou résultat.</summary>
    public void NavigateNext(INavigationService navigation)
    {
        if (NextParameters is EffectSelectParams effect)
            navigation.NavigateTo<Views.EffectSelectView>(effect);
        else
            navigation.NavigateTo<Views.ResultView>(NextParameters);
    }

    /// <summary>Paramètres de l'écran suivant, comme avant le questionnaire.</summary>
    /// <param name="videoPath">Clip de l'animation (GIF), joué en boucle sur l'écran résultat.</param>
    /// <param name="animationUnavailable">GIF sans animation : « Animation indisponible ».</param>
    internal static object BuildNextParameters(CaptureContext context, Guid sessionId, string compositePath, string templateFormat,
        string? videoPath = null, bool animationUnavailable = false)
    {
        var cfg         = context.Config;
        var effects     = cfg?.Effects;
        var resultCfg   = cfg?.Result;
        var paperFormat = PrintService.PaperFormatFromTemplateFormat(templateFormat);

        if (UserChoosesEffect(cfg, context.Format))
        {
            return new EffectSelectParams(
                SessionId:         sessionId,
                EventId:           context.EventId,
                EventName:         context.EventName,
                CompositePath:     compositePath,
                EnabledEffects:    effects!.EnabledEffects,
                DefaultEffect:     effects.DefaultEffect,
                MaxPrintsPerEvent: resultCfg?.MaxPrintsPerEvent,
                MaxPrintsPerPhoto: resultCfg?.MaxPrintsPerPhoto,
                PrinterName:       context.PrinterName,
                PaperFormat:       paperFormat,
                EmailConfig:       cfg?.Email,
                AccessCode:        context.AccessCode,
                ResultCfg:         resultCfg,
                PhotoCount:        PhotoCountOf(context));
        }

        return new ResultParameters(
            SessionId:         sessionId,
            EventId:           context.EventId,
            EventName:         context.EventName,
            CompositePath:     compositePath,
            AccessCode:        context.AccessCode,
            MaxPrintsPerEvent: resultCfg?.MaxPrintsPerEvent,
            MaxPrintsPerPhoto: resultCfg?.MaxPrintsPerPhoto,
            PrinterName:       context.PrinterName,
            PaperFormat:       paperFormat,
            EmailConfig:       cfg?.Email,
            ResultCfg:            resultCfg,
            PhotoCount:           PhotoCountOf(context),
            VideoPath:            videoPath,
            AnimationUnavailable: animationUnavailable);
    }

    private static int PhotoCountOf(CaptureContext context) => Math.Max(1, context.PhotoPaths.Count);

    /// <summary>
    /// L'invité choisit un effet après la prise de vue. Jamais pour un GIF (LAB-237) : l'effet ne
    /// toucherait que le montage imprimé, pas l'animation affichée et partagée.
    /// </summary>
    internal static bool UserChoosesEffect(KioskConfig? cfg, CaptureFormat format = CaptureFormat.Photo)
    {
        var effects = cfg?.Effects;
        return format != CaptureFormat.Gif && effects != null && effects.UserCanChoose
            && effects.EnabledEffects?.Any(e => e != "none") == true;
    }
}
