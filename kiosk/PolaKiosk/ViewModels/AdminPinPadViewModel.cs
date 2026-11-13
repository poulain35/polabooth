using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Pavé PIN de l'écran admin, partagé par l'accueil et la saisie du code événement.
/// Le PIN (4 à 8 chiffres) est propre à la borne : défini dans le SaaS, vérifié par <see cref="IAdminPinService"/>.
/// </summary>
public partial class AdminPinPadViewModel : ObservableObject
{
    internal const string NotConfiguredMessage =
        "Définissez le PIN de cette borne dans le SaaS (page Licences) puis envoyez-le";

    internal const int MinPinLength = 4;
    internal const int MaxPinLength = 8;

    // Anti-bruteforce PIN
    internal const int MaxPinAttempts    = 5;
    internal const int PinLockoutSeconds = 30;

    private readonly IAdminPinService _adminPin;
    private readonly INavigationService _navigation;
    private readonly Func<DateTime> _utcNow;

    // PIN saisi — géré manuellement pour éviter les callbacks en cascade
    private string _pin = "";
    private int _pinFailedAttempts;
    private DateTime _pinLockedUntil = DateTime.MinValue;
    private Task _refresh = Task.CompletedTask;

    [ObservableProperty] private string _pinDots = "";
    [ObservableProperty] private string _pinError = "";
    [ObservableProperty] private bool _hasPinError = false;
    [ObservableProperty] private bool _showPinEntry = false;
    [ObservableProperty] private bool _isChecking = false;

    public AdminPinPadViewModel(IAdminPinService adminPin, INavigationService navigation)
        : this(adminPin, navigation, () => DateTime.UtcNow) { }

    internal AdminPinPadViewModel(IAdminPinService adminPin, INavigationService navigation, Func<DateTime> utcNow)
    {
        _adminPin   = adminPin;
        _navigation = navigation;
        _utcNow     = utcNow;
    }

    [RelayCommand]
    private void OpenAdminPin()
    {
        ClearEntry();
        ShowPinEntry = true;

        // Un PIN vient peut-être d'être envoyé depuis le SaaS : on le récupère sans attendre
        // (hors ligne, le PIN local reste valable).
        _refresh = _adminPin.RefreshAsync();
        if (!_adminPin.IsConfigured) ShowError(NotConfiguredMessage);
    }

    [RelayCommand]
    private void CloseAdminPin()
    {
        ClearEntry();
        ShowPinEntry = false;
    }

    [RelayCommand]
    private void AppendDigit(string digit)
    {
        if (IsLockedOut() || _pin.Length >= MaxPinLength) return;
        ClearError();
        _pin   += digit;
        PinDots = new string('●', _pin.Length);
    }

    [RelayCommand]
    private void DeleteDigit()
    {
        if (_pin.Length == 0) return;
        ClearError();
        _pin    = _pin[..^1];
        PinDots = new string('●', _pin.Length);
    }

    [RelayCommand]
    private async Task ValidatePinAsync()
    {
        if (IsChecking || IsLockedOut()) return;

        if (_pin.Length < MinPinLength)
        {
            ShowError($"Le code contient {MinPinLength} à {MaxPinLength} chiffres.");
            return;
        }

        var pin = _pin;
        IsChecking = true;
        PinCheckResult result;
        try
        {
            // Laisse finir la récupération lancée à l'ouverture (bornée par RefreshAsync).
            await _refresh;
            // PBKDF2 (~0,2 s) : hors du fil d'affichage pour ne pas figer le pavé.
            result = await Task.Run(() => _adminPin.Verify(pin));
        }
        finally { IsChecking = false; }

        switch (result)
        {
            case PinCheckResult.Accepted:
                ClearEntry();
                ShowPinEntry = false;
                _pinFailedAttempts = 0;
                try { _navigation.NavigateTo<Views.AdminView>(); }
                catch (Exception ex) { ShowError($"Erreur : {ex.Message}"); }
                break;

            case PinCheckResult.NotConfigured:
                ClearEntry();
                ShowError(NotConfiguredMessage);
                break;

            default:
                _pinFailedAttempts++;
                _pin    = "";
                PinDots = "";
                if (_pinFailedAttempts >= MaxPinAttempts)
                {
                    _pinLockedUntil    = _utcNow().AddSeconds(PinLockoutSeconds);
                    _pinFailedAttempts = 0;
                    ShowError($"Trop de tentatives. Réessayez dans {PinLockoutSeconds}s.");
                }
                else
                {
                    var left = MaxPinAttempts - _pinFailedAttempts;
                    ShowError($"Code incorrect ({left} essai{(left > 1 ? "s" : "")} restant{(left > 1 ? "s" : "")}).");
                }
                break;
        }
    }

    // Verrouillage anti-bruteforce
    private bool IsLockedOut()
    {
        var now = _utcNow();
        if (now >= _pinLockedUntil) return false;
        var remaining = (int)Math.Ceiling((_pinLockedUntil - now).TotalSeconds);
        ShowError($"Trop de tentatives. Réessayez dans {remaining}s.");
        return true;
    }

    private void ClearEntry()
    {
        _pin    = "";
        PinDots = "";
        ClearError();
    }

    private void ShowError(string message)
    {
        PinError    = message;
        HasPinError = true;
    }

    private void ClearError()
    {
        PinError    = "";
        HasPinError = false;
    }
}
