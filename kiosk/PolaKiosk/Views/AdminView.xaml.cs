using System.Windows.Controls;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class AdminView : UserControl
{
    public AdminView(AdminViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;
    }
}
