namespace PolaKiosk.Services;

/// <summary>
/// Cadre choisi par l'invité sur l'écran de choix (LAB-315), en mémoire seulement. Gardé pour
/// « Refaire les photos », effacé à chaque arrivée sur l'accueil (retour, inactivité, fin de séance).
/// </summary>
public interface IFrameSelection
{
    /// <summary>Id du modèle (Templates) choisi ; null = premier cadre de l'événement.</summary>
    Guid? SelectedTemplateId { get; set; }

    void Clear();
}

public sealed class FrameSelectionService : IFrameSelection
{
    private readonly INavigationService _navigation;

    public FrameSelectionService(INavigationService navigation)
    {
        _navigation = navigation;
        _navigation.Navigated += (_, _) =>
        {
            if (_navigation.CurrentViewType == typeof(Views.HomeView)) Clear();
        };
    }

    public Guid? SelectedTemplateId { get; set; }

    public void Clear() => SelectedTemplateId = null;
}
