namespace PolaKiosk.Services;

/// <summary>
/// État du parcours invité en cours, en mémoire seulement (spec LAB-208, « État du parcours ») :
/// remis à zéro à chaque arrivée sur l'accueil. Rien n'est écrit sur le disque. Ferme aussi la séance
/// des journaux (LAB-326) à l'accueil et à la saisie du code.
/// </summary>
public interface IGuestJourneyService
{
    /// <summary>Le questionnaire a déjà été proposé dans ce parcours (répondu, passé ou annulé).</summary>
    bool QuestionnaireHandled { get; set; }

    /// <summary>E-mail saisi au questionnaire, pour pré-remplir l'envoi par e-mail (LAB-225).</summary>
    string? PrefillEmail { get; set; }

    /// <summary>
    /// Consentement photo accepté au début du parcours (LAB-223), null sinon. Écrit avec chaque
    /// séance du parcours (« Reprendre » compris), jamais seul.
    /// </summary>
    PhotoConsent? PhotoConsent { get; set; }

    void Reset();
}

public sealed class GuestJourneyService : IGuestJourneyService
{
    private readonly INavigationService _navigation;

    public GuestJourneyService(INavigationService navigation, IKioskLogContext? logContext = null)
    {
        _navigation = navigation;
        _navigation.Navigated += (_, _) =>
        {
            var view = _navigation.CurrentViewType;
            if (view == typeof(Views.HomeView)) Reset();
            if (view == typeof(Views.HomeView) || view == typeof(Views.EventSetupView)) logContext?.EndSession();
        };
    }

    public bool QuestionnaireHandled { get; set; }
    public string? PrefillEmail { get; set; }
    public PhotoConsent? PhotoConsent { get; set; }

    public void Reset()
    {
        QuestionnaireHandled = false;
        PrefillEmail = null;
        PhotoConsent = null;
    }
}
