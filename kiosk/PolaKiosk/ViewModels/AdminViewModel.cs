using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Win32;
using PolaKiosk.Services;
using PolaKiosk.Views;
using SkiaSharp;

namespace PolaKiosk.ViewModels;

/// <summary>Option de la liste déroulante caméra. Mode null = détection automatique.</summary>
public record CameraOption(string Label, string? Mode, int WebcamIndex);

/// <summary>Taille des photos du Canon (valeur <see cref="CanonPhotoSize"/>).</summary>
public record PhotoSizeOption(string Label, string Size);

/// <summary>Délai de conservation d'un événement terminé sur le PC.</summary>
public record RetentionOption(string Label, int Days);

public partial class AdminViewModel : ObservableObject, IReleasable
{
    /// <summary>Entrée du menu déroulant = suivre l'imprimante par défaut de Windows (aucun nom figé).</summary>
    public const string SystemDefaultPrinter = "Imprimante par défaut du système";

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
    private readonly ICameraService? _camera;
    private bool _previewRunning;

    public string AppVersion => $"Version {Services.AppVersion.Current}";

    [ObservableProperty] private string _activeEventName = "";
    [ObservableProperty] private string _activeEventId   = "";
    [ObservableProperty] private string _polaStatusMsg   = "";
    [ObservableProperty] private bool   _isImporting     = false;

    public ObservableCollection<string> AvailablePrinters { get; } = new();
    [ObservableProperty] private string _selectedPrinter   = SystemDefaultPrinter;
    [ObservableProperty] private string _printerStatusMsg  = "";
    [ObservableProperty] private string _defaultPrinterHint = "";

    public ObservableCollection<CameraOption> AvailableCameras { get; } = new();
    [ObservableProperty] private CameraOption? _selectedCamera;
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

    public AdminViewModel(IKioskStateService state, INavigationService navigation, ISyncService sync,
        IKioskService kiosk, IPrintService print, IMachineSettingsService machine,
        ICameraDetectionService cameraDetection, AppSettings settings, ISaasSwitchService saasSwitch,
        IAppRestart restart, ICameraService? camera = null)
    {
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

        // Désactiver le mode kiosk pendant l'admin
        _kiosk.DisableKioskMode();

        ActiveEventName = state.ActiveEventName ?? "Aucun événement chargé";
        ActiveEventId   = state.ActiveEventId?.ToString() ?? "";

        LoadPrinters();
        LoadCameras();
        LoadStorageSettings();
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

    private void LoadCameras()
    {
        AvailableCameras.Clear();
        AvailableCameras.Add(new CameraOption("Détection automatique", null, 0));

        foreach (var c in _cameraDetection.DetectAvailableCameras())
        {
            if (c.Source == CameraSource.Canon)
                AvailableCameras.Add(new CameraOption("Canon (EOS R100)", "canon", 0));
            else if (c.Source == CameraSource.Webcam)
                AvailableCameras.Add(new CameraOption($"Webcam {c.DeviceIndex}", "webcam", c.DeviceIndex));
        }

        AvailableCameras.Add(new CameraOption("Simulation (test)", "mock", 0));

        // Sélection courante d'après la config appliquée
        var forced = _settings.Camera.ForcedSource;
        SelectedCamera = forced switch
        {
            CameraSource.Canon  => AvailableCameras.FirstOrDefault(o => o.Mode == "canon"),
            CameraSource.Webcam => AvailableCameras.FirstOrDefault(o => o.Mode == "webcam" && o.WebcamIndex == _settings.Camera.WebcamIndex)
                                   ?? AvailableCameras.FirstOrDefault(o => o.Mode == "webcam"),
            CameraSource.Mock   => AvailableCameras.FirstOrDefault(o => o.Mode == "mock"),
            _                   => AvailableCameras[0],
        } ?? AvailableCameras[0];
    }

    [RelayCommand]
    private void SaveCamera()
    {
        var opt = SelectedCamera;
        if (opt == null) return;

        _machine.SetCamera(opt.Mode, opt.Mode == "webcam" ? opt.WebcamIndex : (int?)null);

        // Reflet dans la config en mémoire (effectif si le service caméra n'a pas encore été créé)
        _settings.Camera.ForcedSource = opt.Mode switch
        {
            "canon"  => CameraSource.Canon,
            "webcam" => CameraSource.Webcam,
            "mock"   => CameraSource.Mock,
            _        => (CameraSource?)null,
        };
        if (opt.Mode == "webcam") _settings.Camera.WebcamIndex = opt.WebcamIndex;

        CameraStatusMsg = $"✓ Caméra : {opt.Label} — redémarrez le kiosk pour l'appliquer.";
    }

    private void LoadPrinters()
    {
        AvailablePrinters.Clear();
        AvailablePrinters.Add(SystemDefaultPrinter);
        foreach (var p in _print.GetAvailablePrinters())
            AvailablePrinters.Add(p);

        var configured = _settings.Kiosk.PrinterName;
        SelectedPrinter = !string.IsNullOrWhiteSpace(configured) && AvailablePrinters.Contains(configured)
            ? configured
            : SystemDefaultPrinter;

        var def = _print.GetDefaultPrinterName();
        DefaultPrinterHint = string.IsNullOrWhiteSpace(def)
            ? "Aucune imprimante par défaut détectée dans Windows."
            : $"Imprimante par défaut de Windows : {def}";
    }

    [RelayCommand]
    private void SavePrinter()
    {
        var chosen = SelectedPrinter == SystemDefaultPrinter ? null : SelectedPrinter;
        _machine.SetPrinterName(chosen);
        _settings.Kiosk.PrinterName = chosen ?? "";  // prise en compte immédiate, sans redémarrer
        PrinterStatusMsg = chosen == null
            ? "✓ Imprimante par défaut du système"
            : $"✓ Imprimante enregistrée : {chosen}";
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
    private async Task ImportPolaFileAsync()
    {
        var dlg = new OpenFileDialog
        {
            Title  = "Importer un fichier .pola (mode hors ligne)",
            Filter = "Fichiers PolaKiosk|*.pola",
        };

        if (dlg.ShowDialog() != true) return;

        IsImporting  = true;
        PolaStatusMsg = "Import en cours...";
        try
        {
            await _sync.ImportPolaFileAsync(dlg.FileName);
            PolaStatusMsg = $"✓ Fichier importé — le client peut maintenant entrer son code événement.";
        }
        catch (Exception ex)
        {
            PolaStatusMsg = $"Erreur : {ex.Message}";
        }
        finally { IsImporting = false; }
    }

    /// <summary>« Tester la caméra » : ouvre l'appareil choisi au démarrage et affiche l'aperçu.</summary>
    [RelayCommand]
    private async Task TestCameraAsync()
    {
        if (_camera == null || IsTestingCamera) return;
        IsTestingCamera      = true;
        LowDefinitionWarning = "";
        CameraTestMsg        = "Ouverture de l'appareil…";
        try
        {
            await _camera.InitializeAsync();
            await _camera.StartLiveViewAsync(OnTestFrame);
            _previewRunning = true;
            if (_camera is WebcamCameraService { ActualResolution: { } res } && res.Width > 0)
            {
                CameraTestMsg        = $"Aperçu en cours. Webcam : {res.Width} × {res.Height}.";
                LowDefinitionWarning = CameraTest.LowDefinitionWarning(res.Width, res.Height, isWebcam: true);
            }
            else
            {
                CameraTestMsg = "Aperçu en cours. Prenez une photo de test pour vérifier la définition.";
            }
        }
        catch (Exception ex)
        {
            CameraTestMsg = $"Appareil photo introuvable : {ex.Message}";
            await StopPreviewAsync();
        }
        finally { IsTestingCamera = false; }
    }

    /// <summary>Une photo de test : définition lue dans le fichier obtenu, puis fichier supprimé.</summary>
    [RelayCommand]
    private async Task CaptureTestPhotoAsync()
    {
        if (_camera == null || IsTestingCamera) return;
        IsTestingCamera = true;
        CameraTestMsg   = "Photo de test en cours…";
        var dir = Path.Combine(Path.GetTempPath(), "PolaKiosk", "camera-test");
        try
        {
            await _camera.InitializeAsync();
            Directory.CreateDirectory(dir);
            var path = await _camera.CaptureAsync(dir);
            var (w, h) = CameraTest.ReadSize(path);
            try { File.Delete(path); } catch { }

            var isWebcam = _camera is WebcamCameraService;
            CameraTestMsg        = $"✓ Photo de test réussie : {w} × {h} px.";
            LowDefinitionWarning = CameraTest.LowDefinitionWarning(w, h, isWebcam);
        }
        catch (Exception ex)
        {
            CameraTestMsg = $"La photo de test a échoué : {ex.Message}";
        }
        finally
        {
            // La prise de vue arrête l'aperçu (Canon) : on le coupe proprement dans tous les cas.
            await StopPreviewAsync();
            IsTestingCamera = false;
        }
    }

    [RelayCommand]
    private Task StopCameraTestAsync() => StopPreviewAsync();

    private void OnTestFrame(byte[] jpegBytes)
    {
        if (!_previewRunning) return;
        BitmapSource? frame;
        try { frame = CameraTest.DecodeFrame(jpegBytes); }
        catch { return; }
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher == null) return;
        dispatcher.BeginInvoke(() =>
        {
            if (!_previewRunning) return;
            TestPreview    = frame;
            HasTestPreview = true;
        });
    }

    private async Task StopPreviewAsync()
    {
        var wasRunning = _previewRunning;
        _previewRunning = false;
        TestPreview     = null;
        HasTestPreview  = false;
        if (wasRunning && _camera != null)
        {
            try { await _camera.StopLiveViewAsync(); } catch { }
        }
    }

    /// <summary>Sortie de l'écran admin (navigation) : l'aperçu ne doit pas continuer en arrière-plan.</summary>
    public void Release() => _ = StopPreviewAsync();

    [RelayCommand]
    private void Back()
    {
        _ = StopPreviewAsync();
        _kiosk.EnableKioskMode();
        _navigation.NavigateTo<EventSetupView>(); // fresh instance, ShowPinEntry toujours false
    }
}

/// <summary>Outils purs du test caméra de l'admin (LAB-263).</summary>
public static class CameraTest
{
    /// <summary>« Webcam en basse définition : WxH » sous 1280×720 (webcam seulement), sinon vide.</summary>
    public static string LowDefinitionWarning(int width, int height, bool isWebcam)
        => isWebcam && WebcamCameraService.IsLowDefinition(width, height)
            ? $"Webcam en basse définition : {width}x{height}"
            : "";

    /// <summary>Largeur et hauteur d'une image, lues dans son en-tête.</summary>
    public static (int Width, int Height) ReadSize(string path)
    {
        using var codec = SKCodec.Create(path)
            ?? throw new InvalidDataException("Image de test illisible.");
        return (codec.Info.Width, codec.Info.Height);
    }

    /// <summary>Image d'aperçu (JPEG) décodée et figée, utilisable depuis le fil d'affichage.</summary>
    public static BitmapSource DecodeFrame(byte[] jpegBytes)
    {
        var image = new BitmapImage();
        using (var stream = new MemoryStream(jpegBytes))
        {
            image.BeginInit();
            image.CacheOption       = BitmapCacheOption.OnLoad;
            image.DecodePixelWidth  = 960;
            image.StreamSource      = stream;
            image.EndInit();
        }
        image.Freeze();
        return image;
    }
}
