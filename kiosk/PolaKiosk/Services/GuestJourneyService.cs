namespace PolaKiosk.Services;

/// <summary>
/// État du parcours invité en cours, en mémoire seulement (spec LAB-208, « État du parcours ») :
/// remis à zéro à chaque arrivée sur l'accueil. Rien n'est écrit sur le disque.
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

    public GuestJourneyService(INavigationService navigation)
    {
        _navigation = navigation;
        _navigation.Navigated += (_, _) =>
        {
            if (_navigation.CurrentViewType == typeof(Views.HomeView)) Reset();
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
