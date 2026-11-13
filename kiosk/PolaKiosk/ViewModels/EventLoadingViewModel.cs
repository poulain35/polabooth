using CommunityToolkit.Mvvm.ComponentModel;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

public partial class EventLoadingViewModel : ObservableObject, IParameterReceiver
{
    private readonly INavigationService _navigation;
    private readonly IKioskStateService _state;

    [ObservableProperty] private string _eventName = "";
    [ObservableProperty] private string _companyName = "";

    public EventLoadingViewModel(INavigationService navigation, IKioskStateService state)
    {
        _navigation  = navigation;
        _state       = state;
        CompanyName  = state.ContactCompany ?? "";
    }

    public void ReceiveParameter(object parameter)
    {
        if (parameter is EventLoadingParameters p)
            _ = RunAsync(p);
    }

    private async Task RunAsync(EventLoadingParameters p)
    {
        EventName = p.EventName;
        if (!p.ContinueToHome) return;
        await Task.Delay(2000);
        _navigation.NavigateTo<Views.HomeView>();
    }
}
