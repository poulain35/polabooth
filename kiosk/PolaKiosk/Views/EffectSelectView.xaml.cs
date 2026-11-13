using System.Windows.Controls;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class EffectSelectView : UserControl
{
    public EffectSelectView(EffectSelectViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;
    }
}
