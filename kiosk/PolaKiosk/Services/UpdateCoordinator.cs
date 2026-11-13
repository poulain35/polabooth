using PolaKiosk.Views;

namespace PolaKiosk.Services;

public enum UpdateOutcome
{
    /// <summary>Pas le bon moment (séance invité ou écran Admin en cours) : rien n'a changé, la demande reste en attente.</summary>
    Skipped,
    /// <summary>Installation lancée : l'app doit se fermer, le watchdog relancera la nouvelle version.</summary>
    Installing,
    /// <summary>Téléchargement, empreinte ou lancement en échec : échec signalé au SaaS, retour à l'écran précédent, plus d'essai sans nouvelle demande.</summary>
    Failed,
}

/// <summary>
/// Moment et déroulé d'une mise à jour demandée depuis le SaaS (LAB-200). Elle s'applique au premier
/// écran sans séance invité en cours (démarrage, saisie du code ou accueil) et ne laisse jamais la borne
/// sur l'écran « Mise à jour » : en cas d'échec, retour à l'écran précédent et échec signalé au SaaS.
/// Appelé sur le fil d'affichage (lecture de l'écran courant, navigation).
/// </summary>
public class UpdateCoordinator
{
    // Téléchargement compris : au-delà, la borne ne peut pas rester indisponible.
    internal static readonly TimeSpan MaxApplyDuration = TimeSpan.FromMinutes(15);

    private readonly IUpdateService _updates;
    private readonly INavigationService _navigation;
    private readonly IKioskLogService _log;

    public UpdateCoordinator(IUpdateService updates, INavigationService navigation, IKioskLogService log)
    {
        _updates    = updates;
        _navigation = navigation;
        _log        = log;
    }

    /// <summary>
    /// Aucune séance invité en cours : écran de démarrage, de saisie du code ou d'accueil. Une séance
    /// commence en quittant l'accueil (RGPD, effets, prise de vue, résultat) ; l'Admin est aussi exclu.
    /// </summary>
    public static bool CanApplyNow(Type? currentView)
        => currentView == typeof(SplashView)
           || currentView == typeof(EventSetupView)
           || currentView == typeof(HomeView);

    public bool CanApplyNow() => CanApplyNow(_navigation.CurrentViewType);

    public async Task<UpdateOutcome> TryApplyAsync(UpdateRequest request)
    {
        if (!CanApplyNow()) return UpdateOutcome.Skipped;

        var previous = _navigation.CurrentViewType;
        _navigation.NavigateTo<UpdateView>();

        string error;
        try
        {
            using var cts = new CancellationTokenSource(MaxApplyDuration);
            if (await _updates.ApplyAsync(request, cts.Token)) return UpdateOutcome.Installing;
            error = "Installeur refusé : son empreinte SHA-256 ne correspond pas à celle publiée.";
        }
        catch (Exception ex)
        {
            error = ex is OperationCanceledException
                ? $"Téléchargement trop long (plus de {MaxApplyDuration.TotalMinutes:0} min)."
                : ex.Message;
            try
            {
                await _log.LogErrorAsync("update",
                    $"Mise à jour {request.Version} échouée ({ex.GetType().Name}: {ex.Message}).", ex.ToString());
            }
            catch { /* journal indisponible : le retour à l'écran précédent prime */ }
        }

        if (previous == typeof(SplashView))    _navigation.NavigateTo<SplashView>();
        else if (previous == typeof(HomeView)) _navigation.NavigateTo<HomeView>();
        else                                   _navigation.NavigateTo<EventSetupView>();

        await _updates.ReportFailureAsync(request, error);
        return UpdateOutcome.Failed;
    }
}
