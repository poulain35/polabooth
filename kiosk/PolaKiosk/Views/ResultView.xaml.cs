using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class ResultView : UserControl
{
    private readonly ResultViewModel _viewModel;

    public ResultView(ResultViewModel viewModel)
    {
        InitializeComponent();
        DataContext = _viewModel = viewModel;

        // Tout appui sur l'écran repousse le retour automatique à l'accueil.
        PreviewMouseDown  += (_, _) => _viewModel.RegisterActivity();
        PreviewTouchDown  += (_, _) => _viewModel.RegisterActivity();
        PreviewStylusDown += (_, _) => _viewModel.RegisterActivity();
        PreviewKeyDown    += (_, _) => _viewModel.RegisterActivity();
    }

    // Raccourci de domaine : la commande remplace le texte du champ, puis on remet le curseur en fin
    // de saisie (sinon la touche suivante du clavier tactile s'écrirait au début).
    private void OnDomainClick(object sender, RoutedEventArgs e) =>
        Dispatcher.BeginInvoke(DispatcherPriority.Input, () =>
        {
            EmailBox.Focus();
            EmailBox.Select(EmailBox.Text.Length, 0);
        });
}
