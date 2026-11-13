using System.Windows.Controls;
using System.Windows.Input;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class QuestionnaireView : UserControl
{
    public QuestionnaireView(QuestionnaireViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;

        // Tout appui (souris, doigt, clavier physique) relance la minuterie d'inactivité de l'écran.
        PreviewMouseDown += (_, _) => viewModel.RegisterActivity();
        PreviewTouchDown += (_, _) => viewModel.RegisterActivity();
        PreviewKeyDown   += (_, _) => viewModel.RegisterActivity();
    }
}
