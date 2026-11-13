using System.Windows.Controls;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class RgpdView : UserControl
{
    public RgpdView(RgpdViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;
    }
}
