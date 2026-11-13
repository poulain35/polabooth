using System.Windows.Controls;
using System.Windows.Input;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class EventSetupView : UserControl
{
    private readonly EventSetupViewModel _viewModel;

    public EventSetupView(EventSetupViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = viewModel;
        Loaded += (_, _) =>
        {
            _viewModel.PinPad.CloseAdminPinCommand.Execute(null);
            CodeInput.Focus();
        };
    }

    private void OnCodeKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && _viewModel.ConnectCommand.CanExecute(null))
            _viewModel.ConnectCommand.Execute(null);
    }
}
