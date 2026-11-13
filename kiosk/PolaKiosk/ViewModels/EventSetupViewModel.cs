using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

public partial class EventSetupViewModel : ObservableObject
{
    private readonly ISyncService _sync;
    private readonly IKioskStateService _state;
    private readonly INavigationService _navigation;
    private readonly IKioskLogService _log;

    // Code événement (lié au TextBox)
    [ObservableProperty, NotifyCanExecuteChangedFor(nameof(ConnectCommand))] private string _accessCode = "";
    [ObservableProperty, NotifyCanExecuteChangedFor(nameof(ConnectCommand))] private bool _isLoading = false;
    [ObservableProperty] private string _statusMessage = "";
    [ObservableProperty] private bool _hasStatusMessage = false;
    // Message d'erreur (affiché dans la couleur d'erreur) ou simple information
    [ObservableProperty] private bool _isStatusError = false;

    // Contact loueur (affiché sur l'écran pour les clients)
    public string ContactPhone   { get; }
    public string ContactCompany { get; }
    public bool   HasContactPhone { get; }

    /// <summary>Cadre du logo de la société en haut de l'écran (LAB-261).</summary>
    internal const double LogoMaxWidth = 400, LogoMaxHeight = 110;

    /// <summary>Logo gardé en cache par la dernière synchro (LAB-257), à la place du nom et de « Photobooth ».</summary>
    public BitmapImage? LogoImage { get; }
    public bool HasLogo { get; }

    // Pavé PIN de l'écran admin (PIN propre à la borne, défini dans le SaaS)
    public AdminPinPadViewModel PinPad { get; }

    public EventSetupViewModel(
        ISyncService sync, IKioskStateService state,
        INavigationService navigation, AppSettings settings, IKioskLogService log,
        AdminPinPadViewModel pinPad)
    {
        _sync = sync;
        _state = state;
        _navigation = navigation;
        _log = log;
        PinPad = pinPad;
        // Pas de connexion à un événement tant que le pavé PIN est ouvert
        PinPad.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(AdminPinPadViewModel.ShowPinEntry))
                ConnectCommand.NotifyCanExecuteChanged();
        };

        // Priorité : infos de l'org depuis Supabase (state) → fallback appsettings
        ContactCompany  = !string.IsNullOrEmpty(state.ContactCompany) ? state.ContactCompany : settings.Contact.CompanyName;
        ContactPhone    = !string.IsNullOrEmpty(state.ContactPhone)   ? state.ContactPhone   : settings.Contact.PhoneNumber;
        HasContactPhone = !string.IsNullOrWhiteSpace(ContactPhone);

        // Borne neuve ou logo illisible : le nom de la société et « Photobooth » restent affichés.
        LogoImage = LoadLogo(sync);
        HasLogo   = LogoImage != null;
    }

    private static BitmapImage? LoadLogo(ISyncService sync)
    {
        try
        {
            return sync.GetOrgLogoPath() is { } path
                ? ImageLoader.Load(path, (int)(LogoMaxWidth * 2), (int)(LogoMaxHeight * 2), fill: false)
                : null;
        }
        catch { return null; }
    }

    // ── Connexion event ───────────────────────────────────────────────────────

    internal const string UnknownCodeMessage = "Ce code ne correspond à aucun événement de votre compte.";

    [RelayCommand(CanExecute = nameof(CanConnect))]
    private async Task ConnectAsync()
    {
        IsLoading = true;
        SetStatus("Recherche de l'événement...", isError: false);
        var code = AccessCode.Trim();

        try
        {
            await _log.LogInfoAsync("event-setup", $"Connexion à l'événement (code '{code}')…");

            // Retry sur erreur réseau (wifi instable) — pas sur "code introuvable" ni sur licence refusée
            Models.LocalDb.EventEntity? ev = null;
            Exception? lastError = null;
            const int maxAttempts = 3;
            for (int attempt = 1; attempt <= maxAttempts; attempt++)
            {
                try { ev = await _sync.SyncByCodeAsync(code); lastError = null; break; }
                catch (KioskLicenseRefusedException)
                {
                    // Borne retirée du compte ou licence désactivée : pas de nouvel essai, association.
                    await _log.LogWarningAsync("event-setup", "Licence refusée par le serveur : retour à l'association.");
                    _navigation.NavigateTo<Views.PairingView>();
                    return;
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    // On trace chaque échec avec le vrai message (ex. "Erreur Supabase (500) : …")
                    await _log.LogWarningAsync("event-setup",
                        $"Tentative {attempt}/{maxAttempts} échouée (code '{code}') : {ex.Message}");
                    if (attempt < maxAttempts)
                    {
                        SetStatus($"Connexion instable, nouvel essai ({attempt}/{maxAttempts})…", isError: false);
                        await Task.Delay(1500);
                    }
                }
            }

            if (lastError != null)
            {
                await _log.LogErrorAsync("event-setup",
                    $"Connexion impossible après {maxAttempts} tentatives (code '{code}') : {lastError.Message}",
                    lastError.ToString());
                // Le serveur a répondu (4xx/5xx) : le réseau n'y est pour rien, on le dit.
                var status = (lastError.InnerException as System.Net.Http.HttpRequestException)?.StatusCode;
                SetStatus(status is { } s
                    ? $"Le serveur a renvoyé une erreur ({(int)s}). Réessayez dans quelques minutes ou contactez votre loueur."
                    : "Problème de connexion. Vérifiez le réseau et réessayez.", isError: true);
                return;
            }

            if (ev == null)
            {
                await _log.LogWarningAsync("event-setup", $"Code événement introuvable : '{code}'.");
                // kiosk_get_event ne renvoie que les événements du compte auquel la borne est associée.
                var hint = HasContactPhone
                    ? $"{UnknownCodeMessage} Vérifiez votre email ou contactez {ContactCompany} au {ContactPhone}."
                    : $"{UnknownCodeMessage} Vérifiez votre email ou contactez votre loueur de photobooth.";
                SetStatus(hint, isError: true);
                return;
            }

            await _log.LogInfoAsync("event-setup", $"Événement '{ev.Name}' connecté (code '{code}').");

            await _state.SetActiveEventAsync(ev.Id, ev.Name, code);
            _navigation.NavigateTo<Views.EventLoadingView>(new EventLoadingParameters(ev.Name));
        }
        catch (Exception ex)
        {
            await _log.LogErrorAsync("event-setup", $"Erreur inattendue à la connexion (code '{code}') : {ex.Message}", ex.ToString());
            SetStatus($"Erreur : {ex.Message}", isError: true);
        }
        finally { IsLoading = false; }
    }

    private bool CanConnect() => AccessCode.Trim().Length >= 4 && !IsLoading && !PinPad.ShowPinEntry;

    private void SetStatus(string message, bool isError)
    {
        StatusMessage    = message;
        IsStatusError    = isError;
        HasStatusMessage = !string.IsNullOrEmpty(message);
    }
}
