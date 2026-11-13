using System.Windows.Controls;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class SaasAddressView : UserControl
{
    public SaasAddressView(SaasAddressViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;
        Loaded += (_, _) => AddressBox.Focus();
    }
}
