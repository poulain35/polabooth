using System.Collections.ObjectModel;
using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

public partial class LiveViewModel : ObservableObject, IReleasable
{
    private readonly ICameraService _camera;
    private readonly INavigationService _navigation;
    private readonly AppSettings _settings;
    private readonly ICompositeService _composite;
    private readonly ISyncService _sync;
    private readonly IKioskStateService _kioskState;
    private readonly IKioskLogService _kioskLog;
    private readonly SessionPathService _sessionPaths;
    private readonly ISessionService _sessions;
    private readonly IGuestJourneyService _journey;
    private readonly ICameraHealthService? _cameraHealth;
    private readonly CaptureFinisher _finisher;
    private readonly LiveViewBrightener _brightener = new();

    /// <summary>Horloge de la borne (tests : heure fixe).</summary>
    internal Func<DateTime> UtcNow { get; set; } = () => DateTime.UtcNow;

    /// <summary>Attentes de l'écran : compte à rebours, flash (tests : immédiates).</summary>
    internal Func<TimeSpan, CancellationToken, Task> Delay { get; set; } = Task.Delay;

    /// <summary>Vignette d'une photo prise, pour sa case (tests : image factice).</summary>
    internal Func<string, BitmapSource?> LoadSlotPhoto { get; set; } = path => ImageLoader.LoadThumbnail(path, SlotPhotoWidth);

    private static readonly TimeSpan MinFlashDuration = TimeSpan.FromMilliseconds(700);
    internal const string CompositingPhotoText     = "Assemblage de votre photo…";
    internal const string CompositingAnimationText = "Préparation de votre animation…";
    private const int SlotPhotoWidth = 240; // case de 112 px, écran à 200 %

    private string _activeTemplateFormat = "portrait";
    private CancellationTokenSource _cts = new();
    private TemplateEntity? _preloadedTemplate;
    private readonly IFrameSelection? _frameSelection;
    private readonly IKioskLogContext? _logContext;
    private IReadOnlyList<PhotoZone> _photoZones = Array.Empty<PhotoZone>();
    private double _currentZoneAR = 1.0;
    private readonly List<Task> _slotPhotoLoads = new();

    [ObservableProperty] private BitmapSource? _liveFrame;
    [ObservableProperty] private BitmapImage? _templateOverlay;
    [ObservableProperty] private bool         _hasTemplateOverlay;
    [ObservableProperty] private double       _templateCanvasWidth  = 400;
    [ObservableProperty] private double       _templateCanvasHeight = 600;
    // Dimensions réelles de la frame caméra — le canvas overlay est dimensionné identiquement
    // pour que les deux UniformToFill utilisent le même facteur d'échelle.
    [ObservableProperty] private double _liveFrameWidth        = 1920;
    [ObservableProperty] private double _liveFrameHeight       = 1080;
    // Positions des barres en espace frame (calculées via ComputeFrameOverlay)
    [ObservableProperty] private double _photoZoneLeft         = 0;
    [ObservableProperty] private double _photoZoneTop          = 0;
    [ObservableProperty] private double _photoZoneWidth        = 1920;
    [ObservableProperty] private double _photoZoneHeight       = 1080;
    [ObservableProperty] private double _photoZoneDarkRightX   = 1920;
    [ObservableProperty] private double _photoZoneDarkRightW   = 0;
    [ObservableProperty] private double _photoZoneDarkBottomY  = 1080;
    [ObservableProperty] private double _photoZoneDarkBottomH  = 0;
    [ObservableProperty] private int          _currentPhotoNumber   = 1;
    [ObservableProperty] private int          _totalPhotoCount      = 1;
    [ObservableProperty] private bool         _hasMultiplePhotos    = false;
    [ObservableProperty] private bool _isInitializing = true;
    /// <summary>Anneau et chiffre affichés (vrai jusqu'au flash, qui porte seul « Souriez ! », LAB-260).</summary>
    [ObservableProperty] private bool _isCountingDown = false;
    /// <summary>Durée du compte à rebours en cours, en secondes (anneau de la vue, LAB-248).</summary>
    public int CountdownTotalSeconds { get; private set; } = 5;
    /// <summary>Photos de la séance : pastilles en haut et cases à droite (LAB-248).</summary>
    public ObservableCollection<LivePhotoSlot> PhotoSlots { get; } = new();
    [ObservableProperty] private bool _isFlashing = false;
    [ObservableProperty] private bool _isCompositing = false;
    /// <summary>Texte de l'attente après la prise de vue : photo ou animation (LAB-237).</summary>
    [ObservableProperty] private string _compositingText = CompositingPhotoText;
    /// <summary>GIF (LAB-237) : « k/N » affiché entre deux prises, pendant gif.interval_ms.</summary>
    [ObservableProperty] private bool _isGifStep = false;
    [ObservableProperty] private string _gifStepText = "";
    [ObservableProperty] private int _countdownValue = 5;
    [ObservableProperty] private bool _hasError = false;
    [ObservableProperty] private string _errorMessage = "";

    public LiveViewModel(
        ICameraService camera,
        INavigationService navigation,
        AppSettings settings,
        ICompositeService composite,
        ISyncService sync,
        IKioskStateService kioskState,
        IKioskLogService kioskLog,
        SessionPathService sessionPaths,
        ISessionService sessions,
        INetworkMonitorService network,
        IGuestJourneyService journey,
        ICameraHealthService? cameraHealth = null,
        IFrameSelection? frameSelection = null,
        IKioskLogContext? logContext = null,
        IAnimationService? animation = null)
    {
        _cameraHealth   = cameraHealth;
        _frameSelection = frameSelection;
        _logContext     = logContext;
        _camera       = camera;
        _navigation   = navigation;
        _settings     = settings;
        _composite    = composite;
        _sync         = sync;
        _kioskState   = kioskState;
        _kioskLog     = kioskLog;
        _sessionPaths = sessionPaths;
        _sessions     = sessions;
        _journey      = journey;
        _finisher     = new CaptureFinisher(sync, composite, kioskLog, sessions, network, frameSelection, animation);
    }

    public async Task StartAsync()
    {
        _cts = new CancellationTokenSource();
        CountdownValue    = 5;
        IsInitializing    = true;
        IsCountingDown    = false;
        IsFlashing        = false;
        IsCompositing     = false;
        CompositingText   = CompositingPhotoText;
        IsGifStep         = false;
        GifStepText       = "";
        HasError          = false;
        ErrorMessage      = "";
        LiveFrame         = null;
        TemplateOverlay       = null;
        HasTemplateOverlay    = false;
        _preloadedTemplate    = null;
        TemplateCanvasWidth   = 400;
        TemplateCanvasHeight  = 600;
        LiveFrameWidth        = 1920;
        LiveFrameHeight       = 1080;
        _currentZoneAR        = 1.0;
        PhotoZoneLeft         = 0;
        PhotoZoneTop          = 0;
        PhotoZoneWidth        = 1920;
        PhotoZoneHeight       = 1080;
        PhotoZoneDarkRightX   = 1920;
        PhotoZoneDarkRightW   = 0;
        PhotoZoneDarkBottomY  = 1080;
        PhotoZoneDarkBottomH  = 0;
        _photoZones           = Array.Empty<PhotoZone>();
        SetPhotoCount(1);

        bool liveViewStarted = false;
        bool cameraOpened    = false;
        try
        {
            await InitializeCameraWithRetryAsync(3, _cts.Token);
            cameraOpened   = true;
            IsInitializing = false;
            await LoadTemplateOverlayAsync();
            await _camera.StartLiveViewAsync(OnFrameReceived);
            liveViewStarted = true;

            await Delay(TimeSpan.FromMilliseconds(800), _cts.Token);
            await RunCountdownAndCaptureAsync(_cts.Token);
        }
        catch (OperationCanceledException) { /* écran quitté : rien à signaler */ }
        catch (Exception ex)
        {
            IsInitializing = false;

            // Appareil photo débranché (LAB-263) : retour immédiat à l'accueil, qui affiche
            // « Problème technique ». La ligne d'erreur des journaux est écrite par l'état partagé
            // (une par passage à absent) ; le détail technique reste en avertissement.
            if (_cameraHealth != null && await IsCameraMissingAsync(ex, cameraOpened))
            {
                await _kioskLog.LogWarningAsync("camera", ex.Message);
                _navigation.NavigateTo<Views.HomeView>();
                return;
            }

            await _kioskLog.LogErrorAsync("camera", ex.Message, ex.StackTrace);

            // Pas de MessageBox bloquant, puis retour accueil.
            // Si le live view a démarré, l'appareil EST détecté : l'échec vient de la capture
            // ou du transfert de l'image → on affiche la cause réelle (code EDSDK) au lieu du
            // message trompeur « aucune caméra ».
            if (ex is TimeoutException)
                ErrorMessage = "La prise de photo a échoué : l'appareil n'a pas renvoyé l'image à temps. Vérifiez la carte SD et le mode de l'appareil, puis réessayez.";
            else if (liveViewStarted)
                ErrorMessage = $"La photo n'a pas pu être récupérée depuis l'appareil.\n\nDétail technique : {ex.Message}";
            else
                ErrorMessage = "Aucune caméra détectée. Vérifiez que l'appareil est branché en USB et allumé, puis réessayez.";

            HasError     = true;
            try { await Delay(TimeSpan.FromSeconds(6), _cts.Token); } catch (OperationCanceledException) { return; }
            _navigation.NavigateTo<Views.HomeView>();
        }
    }

    public async Task StopAsync()
    {
        _cts.Cancel();
        await _camera.StopLiveViewAsync();
    }

    public void Release()
    {
        _cts.Cancel();
        LiveFrame          = null;
        TemplateOverlay    = null;
        HasTemplateOverlay = false;
        _preloadedTemplate = null; // porte le canvas_json complet (plusieurs Mo)
        _photoZones        = Array.Empty<PhotoZone>();
        foreach (var slot in PhotoSlots) slot.Photo = null;
    }

    /// <summary>
    /// Après un échec : l'appareil est-il absent ? Ouverture impossible après 3 tentatives → absent
    /// (signalé à l'état partagé). Échec plus tard (hors délai de transfert, carte SD) → vérification
    /// de la présence ; si l'appareil est encore là, le message d'erreur habituel s'affiche.
    /// </summary>
    private async Task<bool> IsCameraMissingAsync(Exception ex, bool cameraOpened)
    {
        if (!cameraOpened)
        {
            _cameraHealth!.ReportAbsent();
            return true;
        }
        if (ex is TimeoutException) return false;
        try { return await _cameraHealth!.CheckNowAsync() == CameraHealth.Absent; }
        catch { return false; }
    }

    /// <summary>Vignettes des cases en cours de chargement (tests).</summary>
    internal Task WhenSlotPhotosLoaded() => Task.WhenAll(_slotPhotoLoads);

    // Réessaie l'initialisation caméra : tolère un à-coup USB transitoire avant d'abandonner.
    private async Task InitializeCameraWithRetryAsync(int maxAttempts, CancellationToken token)
    {
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                await _camera.InitializeAsync();
                return;
            }
            catch (Exception ex) when (attempt < maxAttempts && !token.IsCancellationRequested)
            {
                await _kioskLog.LogWarningAsync("camera",
                    $"Init caméra échouée (tentative {attempt}/{maxAttempts}) : {ex.Message}");
                // Repartir d'un état propre avant le prochain essai
                try { await _camera.ShutdownAsync(); } catch { /* l'essai suivant rouvre l'appareil */ }
                await Task.Delay(1000, token);
            }
        }
    }

    /// <summary>
    /// « Annuler » (LAB-248) : séance arrêtée (ni montage ni résultat), caméra arrêtée puis
    /// fermée, retour à l'accueil quel que soit l'écran d'avant (consentement compris).
    /// </summary>
    [RelayCommand]
    private async Task CancelAsync()
    {
        _cts.Cancel();
        try
        {
            await _camera.StopLiveViewAsync();
            await _camera.ShutdownAsync();
        }
        catch (Exception ex)
        {
            await _kioskLog.LogWarningAsync("camera", $"Arrêt de la caméra à l'annulation : {ex.Message}");
        }
        _navigation.NavigateTo<Views.HomeView>();
    }

    /// <summary>Nombre de photos de la séance : indicateur, pastilles et cases.</summary>
    private void SetPhotoCount(int count)
    {
        TotalPhotoCount    = Math.Max(1, count);
        HasMultiplePhotos  = TotalPhotoCount > 1;
        CurrentPhotoNumber = 1;
        PhotoSlots.Clear();
        for (int n = 1; n <= TotalPhotoCount; n++)
            PhotoSlots.Add(new LivePhotoSlot(n) { IsCurrent = n == 1 });
    }

    private void SetCurrentPhoto(int number)
    {
        CurrentPhotoNumber = number;
        foreach (var slot in PhotoSlots) slot.IsCurrent = slot.Number == number;
    }

    private void MarkPhotoTaken(int number, string path)
    {
        var slot = PhotoSlots.FirstOrDefault(s => s.Number == number);
        if (slot == null) return;
        slot.IsTaken = true;
        _slotPhotoLoads.Add(LoadSlotPhotoAsync(slot, path));
    }

    private async Task LoadSlotPhotoAsync(LivePhotoSlot slot, string path)
    {
        try
        {
            var photo = await Task.Run(() => LoadSlotPhoto(path));
            if (!_cts.IsCancellationRequested) slot.Photo = photo;
        }
        catch { } // case laissée vide : la photo elle-même n'est pas touchée
    }

    private async Task LoadTemplateOverlayAsync()
    {
        try
        {
            var eventId = _kioskState.ActiveEventId ?? Guid.Empty;
            var templates = await _sync.GetTemplatesAsync(eventId);
            _preloadedTemplate = FrameChoice.Pick(templates, _frameSelection?.SelectedTemplateId);
            if (_preloadedTemplate?.ThumbnailPath == null || !File.Exists(_preloadedTemplate.ThumbnailPath))
                return;

            var overlayPath = _preloadedTemplate.ThumbnailPath;
            var bmp = await Task.Run(() => ImageLoader.LoadForScreen(overlayPath, fill: true));
            if (bmp == null) return;
            TemplateOverlay       = bmp;
            HasTemplateOverlay    = true;
            _activeTemplateFormat = _preloadedTemplate.Format;

            var canvas = PrintFormats.FindOrDefault(_preloadedTemplate.Format);
            (TemplateCanvasWidth, TemplateCanvasHeight) = (canvas.CanvasWidth, canvas.CanvasHeight);

            // Toutes les zones photo du template
            _photoZones       = await _composite.GetPhotoZonesAsync(_preloadedTemplate.Id, _preloadedTemplate.CanvasJson);
            SetPhotoCount(_photoZones.Count);

            // Positionnement initial sur la première zone
            if (_photoZones.Count > 0)
                SetCameraToZone(_photoZones[0]);
            else
            {
                _currentZoneAR = TemplateCanvasWidth / TemplateCanvasHeight;
                ComputeFrameOverlay();
            }
        }
        catch (Exception ex)
        {
            // Prise de vue possible sans le cadre en surimpression.
            _ = _kioskLog.LogWarningAsync("camera", $"Cadre de la prise de vue non affiché : {ex.Message}");
        }
    }

    private void SetCameraToZone(PhotoZone zone)
    {
        _currentZoneAR = zone.Width / zone.Height;
        ComputeFrameOverlay();
    }

    // Calcule les barres de masquage en espace frame caméra (rognage : LiveFrameCrop).
    private void ComputeFrameOverlay()
    {
        double w = LiveFrameWidth;
        double h = LiveFrameHeight;
        var crop = LiveFrameCrop.CenterCrop(w, h, _currentZoneAR);

        PhotoZoneLeft        = crop.X;
        PhotoZoneTop         = crop.Y;
        PhotoZoneWidth       = crop.Width;
        PhotoZoneHeight      = crop.Height;
        PhotoZoneDarkRightX  = crop.X + crop.Width;
        PhotoZoneDarkRightW  = w - (crop.X + crop.Width);
        PhotoZoneDarkBottomY = crop.Y + crop.Height;
        PhotoZoneDarkBottomH = h - (crop.Y + crop.Height);
    }

    private void OnFrameReceived(byte[] jpegBytes)
    {
        if (_cts.IsCancellationRequested) return;

        // Traitement (décodage + auto-éclaircissement) sur le thread appelant (thread EDSDK),
        // pour ne pas charger le thread UI à ~30 fps. Le BitmapSource produit est figé (Freeze)
        // donc utilisable ensuite depuis l'UI.
        BitmapSource? frame;
        try { frame = _brightener.Brighten(jpegBytes); }
        catch { frame = null; }
        if (frame == null) return;

        Application.Current.Dispatcher.Invoke(() =>
        {
            LiveFrame = frame;

            // Recalculer l'overlay si les dimensions de la frame changent (première frame / résolution)
            if (frame.PixelWidth != (int)LiveFrameWidth || frame.PixelHeight != (int)LiveFrameHeight)
            {
                LiveFrameWidth  = frame.PixelWidth;
                LiveFrameHeight = frame.PixelHeight;
                if (HasTemplateOverlay)
                    ComputeFrameOverlay();
            }
        });
    }
}
