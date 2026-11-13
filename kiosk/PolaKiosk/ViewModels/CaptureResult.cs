using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Tout ce que <see cref="LiveViewModel.FinishCaptureAsync"/> doit savoir, figé à la fin de la
/// prise de vue : la tâche de montage ne dépend plus de la durée de vie de l'écran Live.
/// </summary>
/// <param name="CapturedAtUtc">Début de la séance (avant le premier compte à rebours), heure de la
/// borne en UTC : envoyée à kiosk_record_photo, même si la photo part des heures plus tard (LAB-231).</param>
/// <param name="IsPending">Mode obligatoire : poses et montage dans <c>pending\{SessionId}\</c>,
/// pas de séance ni d'envoi avant la validation.</param>
/// <param name="EarlyUpload">Envoi anticipé dès la séance enregistrée (mode facultatif, sans choix d'effet).</param>
/// <param name="PhotoConsent">Consentement du parcours, figé au début de la prise de vue (l'accueil
/// le remet à zéro, parfois avant la fin du montage).</param>
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
    PhotoConsent? PhotoConsent = null);

/// <summary>
/// Montage terminé (ou son repli) : séance, chemins et paramètres prêts pour l'écran suivant
/// (<see cref="EffectSelectParams"/> ou <see cref="ResultParameters"/>).
/// </summary>
public sealed record CaptureResult(
    Guid SessionId,
    DateTime CapturedAtUtc,
    Guid EventId,
    string EventName,
    string CompositePath,
    IReadOnlyList<string> PhotoPaths,
    string TemplateFormat,
    bool IsPending,
    object NextParameters)
{
    /// <summary>L'invité choisit un effet : pas d'envoi anticipé (le montage final vient après).</summary>
    public bool ChoosesEffect => NextParameters is EffectSelectParams;

    /// <summary>Même résultat avec le montage à un autre chemin (photo validée déplacée).</summary>
    public CaptureResult WithCompositePath(string compositePath) => this with
    {
        CompositePath  = compositePath,
        IsPending      = false,
        NextParameters = NextParameters switch
        {
            EffectSelectParams e => e with { CompositePath = compositePath },
            ResultParameters r   => r with { CompositePath = compositePath },
            var other            => other,
        },
    };

    /// <summary>Va à l'écran de la photo : choix d'effet ou résultat.</summary>
    public void NavigateNext(INavigationService navigation)
    {
        if (NextParameters is EffectSelectParams effect)
            navigation.NavigateTo<Views.EffectSelectView>(effect);
        else
            navigation.NavigateTo<Views.ResultView>(NextParameters);
    }

    /// <summary>Paramètres de l'écran suivant, comme avant le questionnaire.</summary>
    internal static object BuildNextParameters(CaptureContext context, Guid sessionId, string compositePath, string templateFormat)
    {
        var cfg         = context.Config;
        var effects     = cfg?.Effects;
        var resultCfg   = cfg?.Result;
        var paperFormat = PrintService.PaperFormatFromTemplateFormat(templateFormat);

        if (UserChoosesEffect(cfg))
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
            ResultCfg:         resultCfg,
            PhotoCount:        PhotoCountOf(context));
    }

    private static int PhotoCountOf(CaptureContext context) => Math.Max(1, context.PhotoPaths.Count);

    internal static bool UserChoosesEffect(KioskConfig? cfg)
    {
        var effects = cfg?.Effects;
        return effects != null && effects.UserCanChoose
            && effects.EnabledEffects?.Any(e => e != "none") == true;
    }
}
