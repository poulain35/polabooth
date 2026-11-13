using System.Windows.Controls;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class EventLoadingView : UserControl
{
    public EventLoadingView(EventLoadingViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;
    }
}
