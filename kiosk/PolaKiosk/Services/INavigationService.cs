using System.Windows.Controls;

namespace PolaKiosk.Services;

public interface INavigationService
{
    void NavigateTo<TView>() where TView : UserControl;
    void NavigateTo<TView>(object parameter) where TView : UserControl;
    void GoBack();

    /// <summary>Type de la vue actuellement affichée, ou null si aucune.</summary>
    Type? CurrentViewType { get; }

    /// <summary>Levé après chaque changement d'écran (NavigateTo ou GoBack).</summary>
    event EventHandler? Navigated;
}
