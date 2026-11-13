using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Écran de consentement photo. Accepter garde le consentement en mémoire pour le parcours : il
/// s'écrit avec chaque séance (file locale PhotoConsents, LAB-223), jamais sans photo. Refuser
/// n'écrit rien et revient à l'accueil.
/// </summary>
public partial class RgpdViewModel : ObservableObject, IParameterReceiver
{
    private readonly INavigationService _navigation;
    private readonly IGuestJourneyService _journey;

    [ObservableProperty] private string _consentMessage = "";
    [ObservableProperty] private string _homeNotice = "";
    [ObservableProperty] private bool _showHomeNotice = false;

    public RgpdViewModel(INavigationService navigation, IGuestJourneyService journey)
    {
        _navigation = navigation;
        _journey    = journey;
    }

    public void ReceiveParameter(object parameter)
    {
        if (parameter is not RgpdParameters p) return;
        ConsentMessage = p.Message;
        HomeNotice     = p.HomeNotice ?? "";
        ShowHomeNotice = !string.IsNullOrWhiteSpace(p.HomeNotice);
    }

    [RelayCommand]
    internal void Accept()
    {
        _journey.PhotoConsent = new PhotoConsent(ConsentMessage, DateTime.UtcNow);
        _navigation.NavigateTo<Views.LiveView>();
    }

    [RelayCommand]
    internal void Refuse()
    {
        _journey.PhotoConsent = null;
        _navigation.GoBack(); // retour HomeView
    }
}

/// <summary>
/// Paramètres de l'écran de consentement photo : message de l'événement et, en mode questionnaire
/// obligatoire, la mention d'accueil répétée sous le message (null sinon).
/// </summary>
public sealed record RgpdParameters(string Message, string? HomeNotice = null);
