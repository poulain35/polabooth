using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Écran « Adresse de votre SaaS » (open core K2), au premier démarrage d'une borne sans adresse Supabase
/// dans ses appsettings. La borne lit <c>https://&lt;saas&gt;/kiosk-config.json</c>, enregistre l'adresse
/// dans machine-settings.json puis redémarre : elle arrive alors sur l'association.
/// </summary>
public partial class SaasAddressViewModel : ObservableObject
{
    internal const string NotFoundMessage = "Adresse introuvable. Vérifiez l'adresse et la connexion.";

    private readonly IKioskConfigClient _client;
    private readonly IMachineSettingsService _machine;
    private readonly IAppRestart _restart;
    private readonly IKioskLogService? _log;

    [ObservableProperty, NotifyCanExecuteChangedFor(nameof(ConnectCommand))]
    private string _address = "";

    /// <summary>Message d'erreur affiché sous le champ, vide sinon.</summary>
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasError))]
    private string _error = "";

    [ObservableProperty, NotifyCanExecuteChangedFor(nameof(ConnectCommand))]
    private bool _isChecking;

    /// <summary>Adresse enregistrée : la borne redémarre.</summary>
    [ObservableProperty] private bool _isSaved;

    public bool HasError => Error.Length > 0;

    public SaasAddressViewModel(IKioskConfigClient client, IMachineSettingsService machine, IAppRestart restart,
        IKioskLogService? log = null)
    {
        _client  = client;
        _machine = machine;
        _restart = restart;
        _log     = log;
    }

    // L'erreur disparaît dès qu'on corrige l'adresse.
    partial void OnAddressChanged(string value) => Error = "";

    private bool CanConnect() => !IsChecking && !IsSaved && !string.IsNullOrWhiteSpace(Address);

    [RelayCommand(CanExecute = nameof(CanConnect))]
    private async Task ConnectAsync()
    {
        if (!SaasAddress.TryNormalize(Address, out var origin))
        {
            Error = NotFoundMessage;
            return;
        }

        Error = "";
        IsChecking = true;
        try
        {
            var config = await _client.FetchAsync(origin);
            if (config == null)
            {
                Error = NotFoundMessage;
                return;
            }

            _machine.SetSaasAddress(origin, config.SupabaseUrl, config.SupabaseAnonKey);
            IsSaved = true;
            _ = _log?.LogInfoAsync("saas-address", $"Adresse du SaaS enregistrée : {origin}");
            _restart.Restart();
        }
        catch (Exception)
        {
            Error = NotFoundMessage;
        }
        finally
        {
            IsChecking = false;
        }
    }
}
