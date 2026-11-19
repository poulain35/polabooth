using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Win32;
using PolaKiosk.Services;
using PolaKiosk.Views;

namespace PolaKiosk.ViewModels;

public partial class AdminViewModel : ObservableObject, IReleasable
{
    /// <summary>Entrée du menu déroulant = suivre l'imprimante par défaut de Windows (aucun nom figé).</summary>
    public const string SystemDefaultPrinter = "Imprimante par défaut du système";

    private const int PreviewDecodeWidth = 960;

    private readonly IKioskStateService _state;
    private readonly INavigationService _navigation;
    private readonly ISyncService _sync;
    private readonly IKioskService _kiosk;
    private readonly IPrintService _print;
    private readonly IMachineSettingsService _machine;
    private readonly ICameraDetectionService _cameraDetection;
    private readonly AppSettings _settings;
    private readonly ISaasSwitchService _saasSwitch;
    private readonly IAppRestart _restart;
    private readonly IPolaHistory _history;
    private readonly IPrinterDriver _printerDriver;
    private readonly TimeProvider _clock;
    private readonly ICameraService? _camera;
    private readonly IWindowsStartup? _startup;
    private bool _previewRunning;
    private bool _loadingStartup; // lecture initiale de la case : rien à écrire

    public string AppVersion => $"Version {Services.AppVersion.Current}";

    [ObservableProperty] private string _activeEventName = "";
    [ObservableProperty] private string _activeEventId   = "";
    [ObservableProperty] private string _polaStatusMsg   = "";
    [ObservableProperty] private bool   _isImporting     = false;

    /// <summary>.pola déjà importés, le plus récent d'abord : un appui recharge l'événement (LAB-321).</summary>
    public ObservableCollection<PolaHistoryItem> PolaHistory { get; } = new();
    [ObservableProperty] private bool _hasPolaHistory;

    public ObservableCollection<string> AvailablePrinters { get; } = new();
    [ObservableProperty] private string _selectedPrinter   = SystemDefaultPrinter;
    [ObservableProperty] private string _printerStatusMsg  = "";
    [ObservableProperty] private string _defaultPrinterHint = "";

    // ── Réglages du pilote (LAB-334) : « bandes coupées » et « normal », enregistrés depuis sa fenêtre ──
    [ObservableProperty] private string _stripCutSettingStatus = "";
    [ObservableProperty] private string _normalSettingStatus   = "";
    [ObservableProperty] private string _driverSettingMsg      = "";

    public ObservableCollection<CameraSourceOption> AvailableCameras { get; } = new();
    [ObservableProperty] private CameraSourceOption? _selectedCamera;
    [ObservableProperty] private string _cameraStatusMsg = "";

    // ── Tester la caméra (LAB-263) : aperçu, photo de test, définition obtenue ──
    [ObservableProperty] private BitmapSource? _testPreview;
    [ObservableProperty] private bool   _isTestingCamera;
    [ObservableProperty] private bool   _hasTestPreview;
    [ObservableProperty] private string _cameraTestMsg = "";
    [ObservableProperty] private string _lowDefinitionWarning = "";

    public IReadOnlyList<PhotoSizeOption> PhotoSizes { get; } =
    [
        new("Petite (2 976 × 1 984 px)", CanonPhotoSize.Small),
        new("Moyenne (3 984 × 2 656 px, recommandée)", CanonPhotoSize.Medium),
        new("Pleine taille (6 000 × 4 000 px)", CanonPhotoSize.Full),
    ];
    [ObservableProperty] private PhotoSizeOption? _selectedPhotoSize;
    [ObservableProperty] private string _photoSizeStatusMsg = "";

    public IReadOnlyList<RetentionOption> RetentionOptions { get; private set; } =
        EventCleanupService.RetentionChoices.Select(days => new RetentionOption($"{days} jours", days)).ToList();
    [ObservableProperty] private RetentionOption? _selectedRetention;
    [ObservableProperty] private string _retentionStatusMsg = "";

    // ── Changer de SaaS (open core K2) : seulement pour une adresse saisie sur la borne ──
    /// <summary>Adresse saisie sur la borne (machine-settings.json) : la carte « Adresse du SaaS » s'affiche.</summary>
    public bool CanChangeSaas => _settings.Supabase.Source == SaasEndpointSource.MachineSettings;
    public string SaasAddressText => string.IsNullOrWhiteSpace(_settings.Kiosk.SaasUrl)
        ? _settings.Supabase.Url
        : _settings.Kiosk.SaasUrl;
    /// <summary>Deuxième temps : « Confirmer » / « Annuler » affichés.</summary>
    [ObservableProperty] private bool   _isConfirmingSaasChange;
    [ObservableProperty] private string _saasStatusMsg = "";

    // ── Quitter vers Windows : le watchdog ne relance pas l'app jusqu'à la prochaine session ──
    /// <summary>Deuxième temps : « Oui, quitter » / « Annuler » affichés.</summary>
    [ObservableProperty] private bool   _isConfirmingQuit;
    [ObservableProperty] private string _quitStatusMsg = "";

    // ── Démarrage de Windows : raccourci du watchdog dans le dossier Démarrage (désactivé par défaut) ──
    /// <summary>App installée : la case peut être changée (grisée en développement).</summary>
    public bool CanChangeLaunchAtStartup => _startup?.IsAvailable == true;
    [ObservableProperty] private bool   _launchAtStartup;
    [ObservableProperty] private string _launchAtStartupStatusMsg = "";

    public AdminViewModel(IKioskStateService state, INavigationService navigation, ISyncService sync,
        IKioskService kiosk, IPrintService print, IMachineSettingsService machine,
        ICameraDetectionService cameraDetection, AppSettings settings, ISaasSwitchService saasSwitch,
        IAppRestart restart, IPolaHistory history, IPrinterDriver printerDriver, ICameraService? camera = null,
        TimeProvider? clock = null, IWindowsStartup? startup = null)
    {
        _startup         = startup;
        _printerDriver   = printerDriver;
        _clock           = clock ?? TimeProvider.System;
        _camera          = camera;
        _state           = state;
        _navigation      = navigation;
        _sync            = sync;
        _kiosk           = kiosk;
        _print           = print;
        _machine         = machine;
        _cameraDetection = cameraDetection;
        _settings        = settings;
        _saasSwitch      = saasSwitch;
        _restart         = restart;
        _history         = history;

        // Désactiver le mode kiosk pendant l'admin
        _kiosk.DisableKioskMode();

        ActiveEventName = state.ActiveEventName ?? "Aucun événement chargé";
        ActiveEventId   = state.ActiveEventId?.ToString() ?? "";

        LoadPrinters();
        RefreshDriverSettingStatus();
        LoadCameras();
        LoadStorageSettings();
        LoadLaunchAtStartup();
        LoadPolaHistory();
    }

    private void LoadLaunchAtStartup()
    {
        _loadingStartup = true;
        try { LaunchAtStartup = _startup?.IsEnabled == true; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { LaunchAtStartup = false; }
        finally { _loadingStartup = false; }
    }

    /// <summary>
    /// Case cochée ou décochée : raccourci posé ou retiré tout de suite (pris en compte à la prochaine
    /// ouverture de session). Échec : la case revient à l'état réel, avec le message.
    /// </summary>
    partial void OnLaunchAtStartupChanged(bool value)
    {
        if (_loadingStartup || _startup == null) return;
        try
        {
            _startup.SetEnabled(value);
            LaunchAtStartupStatusMsg = value
                ? "✓ La borne se lancera toute seule à chaque démarrage de Windows."
                : "✓ La borne ne se lancera plus au démarrage de Windows : ouvrez PolaKiosk à la main.";
        }
        catch (Exception ex)
        {
            LaunchAtStartupStatusMsg = $"✗ Réglage impossible à enregistrer : {ex.Message}";
            LoadLaunchAtStartup();
        }
    }

    private void LoadPolaHistory()
    {
        PolaHistory.Clear();
        try
        {
            foreach (var entry in _history.List()) PolaHistory.Add(PolaHistoryItem.From(entry));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Dossier illisible : liste vide, l'import d'un .pola reste possible.
        }
        HasPolaHistory = PolaHistory.Count > 0;
    }

    private void Forget(PolaHistoryEntry entry)
    {
        try { _history.Remove(entry); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Fichier verrouillé : l'entrée reste proposée, l'admin peut réessayer.
        }
    }

    private void LoadStorageSettings()
    {
        var size = CanonPhotoSize.Normalize(_machine.Current.CanonPhotoSize);
        SelectedPhotoSize = PhotoSizes.FirstOrDefault(o => o.Size == size) ?? PhotoSizes[1];

        var days = EventCleanupService.RetentionDays(_machine.Current);
        SelectedRetention = RetentionOptions.FirstOrDefault(o => o.Days == days);
        if (SelectedRetention == null)
        {
            // Valeur saisie à la main dans machine-settings.json : affichée telle quelle.
            var custom = new RetentionOption($"{days} jours", days);
            RetentionOptions = [.. RetentionOptions, custom];
            SelectedRetention = custom;
        }
    }

    [RelayCommand]
    private void SavePhotoSize()
    {
        var opt = SelectedPhotoSize;
        if (opt == null) return;
        _machine.SetCanonPhotoSize(opt.Size);
        PhotoSizeStatusMsg = $"✓ Photos du Canon : {opt.Label} — appliqué à la prochaine prise de vue.";
    }

    [RelayCommand]
    private void SaveRetention()
    {
        var opt = SelectedRetention;
        if (opt == null) return;
        _machine.SetEventRetentionDays(opt.Days);
        RetentionStatusMsg = $"✓ Les événements terminés sont supprimés du PC après {opt.Days} jours (photos toutes envoyées).";
    }

    [RelayCommand]
    private async Task ChangeEventAsync()
    {
        // Fin de l'événement : la borne repasse hors événement (au redémarrage, elle ne reprend plus
        // sur l'accueil). Le contact du loueur reste affiché sur l'écran de saisie.
        try
        {
            await StopPreviewAsync();
            var company = _state.ContactCompany;
            var phone   = _state.ContactPhone;
            var email   = _state.ContactEmail;
            await _state.ClearActiveEventAsync();
            if (!string.IsNullOrEmpty(company)) await _state.SetContactInfoAsync(company, phone, email);
        }
        finally
        {
            _kiosk.EnableKioskMode();
            _navigation.NavigateTo<EventSetupView>();
        }
    }

    [RelayCommand]
    private void AskSaasChange()
    {
        if (!CanChangeSaas) return;
        SaasStatusMsg = "";
        IsConfirmingSaasChange = true;
    }

    [RelayCommand]
    private void CancelSaasChange() => IsConfirmingSaasChange = false;

    /// <summary>
    /// Efface l'adresse saisie, l'association et l'événement, puis redémarre : la borne repart sur
    /// l'écran « Adresse de votre SaaS », puis l'association.
    /// </summary>
    [RelayCommand]
    private async Task ConfirmSaasChangeAsync()
    {
        if (!CanChangeSaas || !IsConfirmingSaasChange) return;
        IsConfirmingSaasChange = false;
        try
        {
            await StopPreviewAsync();
            await _saasSwitch.ClearAsync();
        }
        catch (Exception ex)
        {
            SaasStatusMsg = $"✗ Impossible d'effacer l'adresse : {ex.Message}";
            return;
        }
        SaasStatusMsg = "✓ Adresse effacée. La borne redémarre…";
        _restart.Restart();
    }

    [RelayCommand]
    private void AskQuit()
    {
        QuitStatusMsg = "";
        IsConfirmingQuit = true;
    }

    [RelayCommand]
    private void CancelQuit() => IsConfirmingQuit = false;

    /// <summary>
    /// Ferme l'application sans relance par le watchdog. Elle repart à la prochaine ouverture de session
    /// Windows, ou lancée à la main. Fichier d'arrêt impossible à écrire : message, l'app reste ouverte.
    /// </summary>
    [RelayCommand]
    private async Task ConfirmQuitAsync()
    {
        if (!IsConfirmingQuit) return;
        IsConfirmingQuit = false;
        await StopPreviewAsync();
        try { _restart.QuitToWindows(); }
        catch (Exception ex)
        {
            QuitStatusMsg = $"✗ Impossible de quitter sans relance : {ex.Message}";
            return;
        }
        QuitStatusMsg = "✓ La borne se ferme…";
    }

    [RelayCommand]
    private async Task ImportPolaFileAsync()
    {
        var dlg = new OpenFileDialog
        {
            Title  = "Importer un fichier .pola (mode hors ligne)",
            Filter = "Fichiers PolaKiosk|*.pola",
        };

        if (dlg.ShowDialog() != true) return;
        await ImportPolaFromPathAsync(dlg.FileName);
    }

    /// <summary>
    /// Import du fichier choisi : l'événement importé devient l'événement actif (comme un envoi depuis
    /// le SaaS) et la carte « Événement actif » l'affiche aussitôt (LAB-320).
    /// </summary>
    internal Task ImportPolaFromPathAsync(string path) => ImportAsync(path, archived: null);

    /// <summary>
    /// « Recharger » un .pola de l'historique : même chemin qu'un import, sans le fichier d'origine ni
    /// réseau (LAB-321). Fichier disparu ou illisible : message, et l'entrée quitte la liste.
    /// </summary>
    [RelayCommand]
    private async Task ReloadPolaAsync(PolaHistoryItem? item)
    {
        if (item == null || IsImporting) return;
        await ImportAsync(_history.PathOf(item.Entry), item.Entry);
    }

    private async Task ImportAsync(string path, PolaHistoryEntry? archived)
    {
        IsImporting  = true;
        PolaStatusMsg = archived == null ? "Import en cours..." : $"Chargement de « {archived.EventName} »...";
        try
        {
            var ev = await _sync.ImportPolaFileAsync(path);
            await _state.SetActiveEventAsync(ev.Id, ev.Name, ev.AccessCode);
            ActiveEventName = ev.Name;
            ActiveEventId   = ev.Id.ToString();
            PolaStatusMsg = archived == null
                ? "✓ Fichier importé — le client peut maintenant entrer son code événement."
                : $"✓ « {ev.Name} » rechargé : c'est l'événement actif.";
        }
        catch (Exception ex) when (archived != null && ex is FileNotFoundException or DirectoryNotFoundException)
        {
            Forget(archived);
            PolaStatusMsg = "Erreur : ce fichier .pola n'est plus sur la borne. Il a été retiré de la liste.";
        }
        catch (InvalidDataException ex) when (archived != null)
        {
            Forget(archived);
            PolaStatusMsg = $"Erreur : {ex.Message} Il a été retiré de la liste.";
        }
        catch (Exception ex)
        {
            PolaStatusMsg = $"Erreur : {ex.Message}";
        }
        finally
        {
            IsImporting = false;
            LoadPolaHistory();
        }
    }

    /// <summary>
    /// Retour (LAB-389) : sur l'accueil de l'événement s'il y en a un d'actif et présent sur la borne
    /// (même règle qu'au démarrage, <see cref="StartupFlow"/>), sinon sur la saisie du code.
    /// </summary>
    [RelayCommand]
    private async Task BackAsync()
    {
        _ = StopPreviewAsync();
        _kiosk.EnableKioskMode();

        var hasEvent = false;
        try
        {
            hasEvent = _state.ActiveEventId is { } id && id != Guid.Empty
                       && await _sync.GetCurrentEventAsync(id) != null;
        }
        catch (Exception) { /* base locale illisible : saisie du code, comme avant */ }

        if (hasEvent) _navigation.NavigateTo<HomeView>();
        else _navigation.NavigateTo<EventSetupView>(); // fresh instance, ShowPinEntry toujours false
    }
}
