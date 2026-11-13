using System.Collections.ObjectModel;
using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;
using SkiaSharp;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Newtonsoft.Json.Linq;
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
    private readonly INetworkMonitorService _network;
    private readonly IGuestJourneyService _journey;
    private readonly ICameraHealthService? _cameraHealth;

    /// <summary>Horloge de la borne (tests : heure fixe).</summary>
    internal Func<DateTime> UtcNow { get; set; } = () => DateTime.UtcNow;

    /// <summary>Attentes de l'écran : compte à rebours, flash (tests : immédiates).</summary>
    internal Func<TimeSpan, CancellationToken, Task> Delay { get; set; } = Task.Delay;

    /// <summary>Vignette d'une photo prise, pour sa case (tests : image factice).</summary>
    internal Func<string, BitmapSource?> LoadSlotPhoto { get; set; } = path => ImageLoader.LoadThumbnail(path, SlotPhotoWidth);

    private static readonly TimeSpan MinFlashDuration = TimeSpan.FromMilliseconds(700);
    private const int SlotPhotoWidth = 240; // case de 112 px, écran à 200 %

    private string _activeTemplateFormat = "portrait";
    private CancellationTokenSource _cts = new();
    private TemplateEntity? _preloadedTemplate;
    private IReadOnlyList<PhotoZone> _photoZones = Array.Empty<PhotoZone>();
    private double _currentZoneAR = 1.0;
    private double _evfGain = 1.0; // gain d'éclaircissement live view, lissé dans le temps
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
        ICameraHealthService? cameraHealth = null)
    {
        _cameraHealth = cameraHealth;
        _camera       = camera;
        _navigation   = navigation;
        _settings     = settings;
        _composite    = composite;
        _sync         = sync;
        _kioskState   = kioskState;
        _kioskLog     = kioskLog;
        _sessionPaths = sessionPaths;
        _sessions     = sessions;
        _network      = network;
        _journey      = journey;
    }

    public async Task StartAsync()
    {
        _cts = new CancellationTokenSource();
        CountdownValue    = 5;
        IsInitializing    = true;
        IsCountingDown    = false;
        IsFlashing        = false;
        IsCompositing     = false;
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
        catch (OperationCanceledException) { }
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
                try { await _camera.ShutdownAsync(); } catch { }
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

    private async Task RunCountdownAndCaptureAsync(CancellationToken token)
    {
        var eventId  = _kioskState.ActiveEventId ?? Guid.Empty;

        // Chargement config kiosk avant le loop (pour le countdown en secondes)
        var ev = await _sync.GetCurrentEventAsync(eventId);
        KioskConfig? kioskCfg = null;
        var eventName = ev?.Name ?? "Événement";
        if (ev != null)
        {
            try { kioskCfg = JObject.Parse(ev.FormConfigJson)["kiosk"]?.ToObject<KioskConfig>(); }
            catch { }
        }
        int countdownSecs = kioskCfg?.Capture?.CountdownSeconds ?? 5;

        // Questionnaire après la prise de vue (LAB-222) : une seule fois par parcours (« Reprendre »
        // ne le repose pas). Mode obligatoire : la photo reste en attente jusqu'à la validation.
        var questionnaire = kioskCfg?.Questionnaire;
        bool askQuestionnaire = questionnaire?.IsActive == true && !_journey.QuestionnaireHandled;
        bool isPending = askQuestionnaire && questionnaire!.RequiredForPhoto;

        // Identifiant tiré dès le début : il nomme le dossier d'attente et devient celui de la séance.
        var sessionId  = Guid.NewGuid();
        var capturedAt = UtcNow();

        // Photos rangées dans un dossier propre à l'événement (originals + composites),
        // ou dans pending\{sessionId}\ tant que l'invité n'a pas validé le questionnaire.
        _sessionPaths.EnsureDirectoriesExist(eventName, eventId);
        string photoDir, compositeDir;
        if (isPending)
        {
            _sessionPaths.EnsurePendingDirectoriesExist(sessionId);
            photoDir     = _sessionPaths.GetPendingOriginalsDirectory(sessionId);
            compositeDir = _sessionPaths.GetPendingCompositesDirectory(sessionId);
        }
        else
        {
            photoDir     = _sessionPaths.GetOriginalsDirectory(eventName, eventId);
            compositeDir = _sessionPaths.GetCompositesDirectory(eventName, eventId);
        }

        List<string> capturedPaths;
        try
        {
            capturedPaths = await CaptureAllZonesAsync(countdownSecs, photoDir, token);

            // Écran quitté pendant la prise de vue (retour, erreur) : ni montage, ni navigation.
            token.ThrowIfCancellationRequested();
        }
        catch when (isPending)
        {
            // Prise de vue ratée ou interrompue : les poses déjà prises ne quittent pas l'attente.
            _sessions.DiscardPendingSession(sessionId);
            throw;
        }

        var context = new CaptureContext(
            SessionId:           sessionId,
            CapturedAtUtc:       capturedAt,
            EventId:             eventId,
            EventName:           eventName,
            Config:              kioskCfg,
            Template:            _preloadedTemplate,
            TemplateFormat:      _activeTemplateFormat,
            PhotoPaths:          capturedPaths,
            CompositesDirectory: compositeDir,
            IsPending:           isPending,
            EarlyUpload:         askQuestionnaire && !isPending && !CaptureResult.UserChoosesEffect(kioskCfg),
            AccessCode:          _kioskState.LastAccessCode ?? "",
            PrinterName:         _settings.Kiosk.PrinterName,
            PhotoConsent:        _journey.PhotoConsent);

        if (askQuestionnaire)
        {
            // Montage en arrière-plan, navigation immédiate : l'invité répond pendant qu'il se prépare.
            _journey.QuestionnaireHandled = true;
            var captureCts = new CancellationTokenSource();
            var capture = FinishCaptureAsync(context, captureCts.Token);
            _navigation.NavigateTo<Views.QuestionnaireView>(new QuestionnaireParameters(
                Capture:             capture,
                CaptureCancellation: captureCts,
                Config:              questionnaire!,
                SessionId:           sessionId,
                EventId:             eventId,
                AccessCode:          context.AccessCode,
                PhotoConsent:        context.PhotoConsent,
                Provider:            QuestionnaireProviderFor(_kioskState, _settings)));
            return;
        }

        // ── Sans questionnaire : montage puis navigation, comme avant ────
        IsCompositing = true;
        CaptureResult result;
        try { result = await FinishCaptureAsync(context, CancellationToken.None); }
        finally { IsCompositing = false; }

        // L'accueil a pu être affiché pendant le montage : ne pas y superposer le résultat.
        token.ThrowIfCancellationRequested();
        result.NavigateNext(_navigation);
    }

    // ── Boucle de capture — une photo par zone ────────────────────────
    private async Task<List<string>> CaptureAllZonesAsync(int countdownSecs, string photoDir, CancellationToken token)
    {
        // Zones à photographier (au moins 1 zone couvrant tout le canvas si aucune parsée)
        var zones = _photoZones.Count > 0
            ? _photoZones
            : new[] { new PhotoZone(0, 0, (float)TemplateCanvasWidth, (float)TemplateCanvasHeight) };

        var capturedPaths = new List<string>();

        for (int i = 0; i < zones.Count; i++)
        {
            token.ThrowIfCancellationRequested();

            SetCurrentPhoto(i + 1);

            // Photos 2, 3… : redémarrer le live view, repositionner, laisser 1,5s au sujet
            if (i > 0)
            {
                await _camera.StartLiveViewAsync(OnFrameReceived);
                SetCameraToZone(zones[i]);
                await Delay(TimeSpan.FromMilliseconds(1500), token);
            }
            else
            {
                SetCameraToZone(zones[0]);
            }

            // Compte à rebours : chiffres dans l'anneau (LAB-248), puis directement le flash et son
            // « Souriez ! » (LAB-260). Durée et premier chiffre AVANT IsCountingDown : la vue lance
            // alors l'anneau qui se vide sur toute la durée.
            if (countdownSecs > 0)
            {
                CountdownTotalSeconds = countdownSecs;
                CountdownValue = countdownSecs;
                IsCountingDown = true;
                for (int s = countdownSecs; s >= 1; s--)
                {
                    token.ThrowIfCancellationRequested();
                    CountdownValue = s;
                    await Delay(TimeSpan.FromSeconds(1), token);
                }
            }

            token.ThrowIfCancellationRequested();

            // Écran blanc : affiché AVANT le déclenchement et maintenu pendant toute la
            // capture. L'APN (Canon R100) met un moment à répondre à TakePicture ; si on
            // masquait l'écran trop tôt, l'obturateur se déclenchait après la disparition du
            // blanc. On garde donc le blanc pendant l'arrêt du live view + la capture, avec
            // une durée minimale pour l'effet flash, puis on l'éteint une fois la photo prise.
            // Le blanc passe devant l'anneau avant que celui-ci ne disparaisse.
            IsFlashing = true;
            IsCountingDown = false;
            var flashStart = DateTime.UtcNow;
            try
            {
                await _camera.StopLiveViewAsync();
                var path = await _camera.CaptureAsync(photoDir);
                capturedPaths.Add(path);
                MarkPhotoTaken(i + 1, path);
            }
            finally
            {
                var elapsed = DateTime.UtcNow - flashStart;
                if (elapsed < MinFlashDuration)
                {
                    try { await Delay(MinFlashDuration - elapsed, token); }
                    catch (OperationCanceledException) { }
                }
                IsFlashing = false;
            }
        }
        return capturedPaths;
    }

    /// <summary>
    /// Montage, enregistrement de la séance et paramètres de l'écran suivant. Ne lève jamais :
    /// photo brute compressée si le montage échoue, identifiant déjà tiré si la séance ne
    /// s'enregistre pas. Indépendante de l'écran Live (ni <c>_cts</c>, ni propriété affichée) :
    /// elle tourne pendant le questionnaire, et <paramref name="token"/> l'arrête sur abandon.
    /// Mode obligatoire (<see cref="CaptureContext.IsPending"/>) : montage dans le dossier
    /// d'attente, sans séance ni envoi (faits à la validation).
    /// </summary>
    internal async Task<CaptureResult> FinishCaptureAsync(CaptureContext context, CancellationToken token)
    {
        var photo         = context.PhotoPaths[0];
        var compositePath = photo;
        var format        = context.TemplateFormat;

        CaptureResult Done() => Result(context, context.SessionId, compositePath, format);

        // Parcours abandonné avant le montage : rien à préparer.
        if (token.IsCancellationRequested) return Done();

        try
        {
            var template = context.Template
                ?? (await _sync.GetTemplatesAsync(context.EventId)).FirstOrDefault();
            if (template?.ThumbnailPath != null && File.Exists(template.ThumbnailPath))
            {
                // Déjà analysées au chargement de l'écran : servies par le cache du service.
                var templateZones = await _composite.GetPhotoZonesAsync(template.Id, template.CanvasJson);
                compositePath = await _composite.CreateCompositeAsync(
                    context.PhotoPaths.ToList(), template.ThumbnailPath, templateZones,
                    template.Format, context.CompositesDirectory);
                format = template.Format;
            }
            else
            {
                // Pas de template pour cet événement → on finalise quand même la photo brute
                // (compressée) dans le dossier composites, pour la galerie / le partage / l'impression.
                compositePath = await _composite.CreateFromSinglePhotoAsync(photo, context.CompositesDirectory);
            }
        }
        catch (Exception ex)
        {
            await _kioskLog.LogErrorAsync("capture",
                $"Échec du compositing (event {context.EventId}) : {ex.Message}", ex.ToString());
            // Dernier recours : copie compressée de la photo brute dans composites.
            try { compositePath = await _composite.CreateFromSinglePhotoAsync(photo, context.CompositesDirectory); }
            catch { compositePath = photo; }
        }

        // Mode obligatoire : rien en base ni sur le réseau avant la validation du questionnaire.
        if (context.IsPending || token.IsCancellationRequested) return Done();

        try
        {
            await _sessions.RecordSessionAsync(context.SessionId, context.EventId, context.CapturedAtUtc,
                photo, compositePath, StagePhotoConsent(context.PhotoConsent, context.SessionId, context.EventId, context.AccessCode));
        }
        catch (Exception ex)
        {
            // L'écran résultat rattachera la séance au montage : la photo reste partageable.
            await _kioskLog.LogErrorAsync("session",
                $"Enregistrement de la séance impossible (event {context.EventId}) : {ex.Message}", ex.ToString());
            return Done();
        }

        // Mode facultatif sans choix d'effet : la photo part pendant le questionnaire, le QR est
        // prêt à l'arrivée sur le résultat. Pas de doublon : l'écran résultat attend le même verrou
        // d'envoi puis relit l'URL déjà obtenue.
        if (context.EarlyUpload && _network.IsOnline)
            _ = UploadEarlyAsync(_sessions, _kioskLog, context.SessionId);

        return Done();
    }

    /// <summary>
    /// Loueur de la borne nommé par le questionnaire (open core L7) : société et email synchronisés
    /// (fiche contact de l'organisation), à défaut la section Contact de la config de l'instance.
    /// </summary>
    internal static QuestionnaireProvider QuestionnaireProviderFor(IKioskStateService state, AppSettings settings)
        => new(
            Name:         !string.IsNullOrWhiteSpace(state.ContactCompany) ? state.ContactCompany : settings.Contact.CompanyName,
            ContactEmail: !string.IsNullOrWhiteSpace(state.ContactEmail) ? state.ContactEmail : settings.Contact.Email);

    /// <summary>Consentement du parcours à écrire avec la séance, ou rien sans consentement.</summary>
    internal static Action<AppDbContext>? StagePhotoConsent(
        PhotoConsent? consent, Guid sessionId, Guid eventId, string accessCode)
        => consent == null ? null : db => PhotoConsentService.Stage(db, consent, sessionId, eventId, accessCode);

    /// <summary>Envoi anticipé en arrière-plan. Un échec est sans effet : l'écran résultat réessaie.</summary>
    internal static async Task UploadEarlyAsync(ISessionService sessions, IKioskLogService log, Guid sessionId)
    {
        try { await sessions.UploadSessionAsync(sessionId); }
        catch (Exception ex)
        {
            try { await log.LogWarningAsync("photo_upload", $"Envoi anticipé non abouti : {ex.Message}"); }
            catch { }
        }
    }

    private static CaptureResult Result(CaptureContext context, Guid sessionId, string compositePath, string format)
        => new(
            SessionId:      sessionId,
            CapturedAtUtc:  context.CapturedAtUtc,
            EventId:        context.EventId,
            EventName:      context.EventName,
            CompositePath:  compositePath,
            PhotoPaths:     context.PhotoPaths,
            TemplateFormat: format,
            IsPending:      context.IsPending,
            NextParameters: CaptureResult.BuildNextParameters(context, sessionId, compositePath, format));

    private async Task LoadTemplateOverlayAsync()
    {
        try
        {
            var eventId = _kioskState.ActiveEventId ?? Guid.Empty;
            var templates = await _sync.GetTemplatesAsync(eventId);
            _preloadedTemplate = templates.FirstOrDefault();
            if (_preloadedTemplate?.ThumbnailPath == null || !File.Exists(_preloadedTemplate.ThumbnailPath))
                return;

            var overlayPath = _preloadedTemplate.ThumbnailPath;
            var bmp = await Task.Run(() => ImageLoader.LoadForScreen(overlayPath, fill: true));
            if (bmp == null) return;
            TemplateOverlay       = bmp;
            HasTemplateOverlay    = true;
            _activeTemplateFormat = _preloadedTemplate.Format;

            (TemplateCanvasWidth, TemplateCanvasHeight) = _preloadedTemplate.Format switch
            {
                "landscape" => (600.0, 400.0),
                "stripV"    => (200.0, 600.0),
                "stripH"    => (600.0, 200.0),
                _           => (400.0, 600.0),
            };

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
        catch { }
    }

    private void SetCameraToZone(PhotoZone zone)
    {
        _currentZoneAR = zone.Width / zone.Height;
        ComputeFrameOverlay();
    }

    // Calcule les barres de masquage en espace frame caméra.
    // Le CompositeService fait un cover-fit centré de la photo dans chaque zone :
    // le center-crop au ratio de la zone est exactement ce que l'utilisateur verra ici.
    private void ComputeFrameOverlay()
    {
        double w     = LiveFrameWidth;
        double h     = LiveFrameHeight;
        double camAR = w / h;
        double zAR   = _currentZoneAR;

        double cropX, cropY, cropW, cropH;
        if (camAR > zAR)
        {
            // Caméra plus large que la zone → rogner gauche/droite
            cropH = h;
            cropW = h * zAR;
            cropX = (w - cropW) / 2.0;
            cropY = 0;
        }
        else
        {
            // Caméra plus haute que la zone → rogner haut/bas
            cropW = w;
            cropH = w / zAR;
            cropX = 0;
            cropY = (h - cropH) / 2.0;
        }

        PhotoZoneLeft        = cropX;
        PhotoZoneTop         = cropY;
        PhotoZoneWidth       = cropW;
        PhotoZoneHeight      = cropH;
        PhotoZoneDarkRightX  = cropX + cropW;
        PhotoZoneDarkRightW  = w - (cropX + cropW);
        PhotoZoneDarkBottomY = cropY + cropH;
        PhotoZoneDarkBottomH = h - (cropY + cropH);
    }

    private void OnFrameReceived(byte[] jpegBytes)
    {
        if (_cts.IsCancellationRequested) return;

        // Traitement (décodage + auto-éclaircissement) sur le thread appelant (thread EDSDK),
        // pour ne pas charger le thread UI à ~30 fps. Le BitmapSource produit est figé (Freeze)
        // donc utilisable ensuite depuis l'UI.
        BitmapSource? frame;
        try { frame = BuildBrightenedFrame(jpegBytes); }
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

    // Équivalent logiciel de « Canon Auto Exposure » : mesure la luminosité de la frame et
    // applique un gain adaptatif (lissé, borné) pour un aperçu clair même si l'appareil est
    // réglé pour le flash. N'affecte QUE le live view — la photo capturée n'est jamais modifiée.
    private BitmapSource? BuildBrightenedFrame(byte[] jpegBytes)
    {
        using var bitmap = SKBitmap.Decode(jpegBytes);
        if (bitmap == null) return null;

        // 1. Luminance moyenne (échantillonnée pour la vitesse, ~80×80 points max)
        double sum = 0; int n = 0;
        int stepX = Math.Max(1, bitmap.Width / 80);
        int stepY = Math.Max(1, bitmap.Height / 80);
        for (int y = 0; y < bitmap.Height; y += stepY)
            for (int x = 0; x < bitmap.Width; x += stepX)
            {
                var c = bitmap.GetPixel(x, y);
                sum += 0.299 * c.Red + 0.587 * c.Green + 0.114 * c.Blue;
                n++;
            }
        double avg = n > 0 ? sum / n : 128.0;

        // 2. Gain pour viser une luminosité cible, borné puis lissé dans le temps pour éviter
        //    le scintillement. Le plafond est volontairement élevé : quand la scène est quasi
        //    noire (appareil réglé pour le flash, ambiance très sombre), on « surexpose » le
        //    live view pour que le sujet reste visible et puisse se cadrer. Une scène déjà
        //    correctement exposée garde un gain proche de 1 (pas de sur-éclaircissement).
        const double targetLuma = 150.0, maxGain = 12.0;
        double targetGain = Math.Clamp(targetLuma / Math.Max(avg, 1.0), 1.0, maxGain);
        _evfGain += (targetGain - _evfGain) * 0.15;
        float g = (float)_evfGain;

        // 3. Application du gain (multiplication RGB) via matrice de couleur
        var matrix = new float[]
        {
            g, 0, 0, 0, 0,
            0, g, 0, 0, 0,
            0, 0, g, 0, 0,
            0, 0, 0, 1, 0,
        };
        var info = new SKImageInfo(bitmap.Width, bitmap.Height, SKColorType.Bgra8888, SKAlphaType.Opaque);
        using var output = new SKBitmap(info);
        using (var canvas = new SKCanvas(output))
        using (var paint = new SKPaint { ColorFilter = SKColorFilter.CreateColorMatrix(matrix) })
        {
            canvas.DrawBitmap(bitmap, 0, 0, paint);
        }

        // 4. Vers un BitmapSource WPF figé (thread-safe)
        var bmp = BitmapSource.Create(
            info.Width, info.Height, 96, 96,
            System.Windows.Media.PixelFormats.Bgra32, null,
            output.GetPixels(), output.RowBytes * info.Height, output.RowBytes);
        bmp.Freeze();
        return bmp;
    }
}
