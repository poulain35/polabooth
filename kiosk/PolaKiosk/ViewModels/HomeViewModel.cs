using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Accueil de la borne (LAB-251) : écran 1a, 1b ou 1c selon <see cref="HomeScreen.ResolveLayout"/>,
/// avec à droite le tirage de l'événement garni de la dernière photo prise. Si le client a créé son
/// écran d'accueil et qu'il est validé (LAB-291), cet écran remplace tout l'accueil. Sinon, si l'admin
/// a composé l'accueil des bornes de l'organisation (LAB-297), c'est lui qui s'affiche.
/// </summary>
public partial class HomeViewModel : ObservableObject, IReleasable
{
    /// <summary>Cadre du tirage de l'événement à droite de l'écran (pixels de la maquette 1280×800).</summary>
    internal const double PrintMaxWidth = 440, PrintMaxHeight = 530;

    // Largeur de décodage du tirage et de la dernière photo : nette à l'échelle d'un écran 1080p.
    private const int PrintDecodeWidth = 900;

    /// <summary>Cadre du logo de la société en haut à gauche (pixels de la maquette, LAB-257).</summary>
    internal const double LogoMaxWidth = 280, LogoMaxHeight = 48;

    private readonly INavigationService _navigation;
    private readonly IKioskStateService _state;
    private readonly string? _instanceName;
    private readonly ISyncService _sync;
    private readonly IIdleTimeoutService _idle;
    private readonly SessionPathService _sessionPaths;
    private readonly ICompositeService _composite;
    private readonly ICameraHealthService? _cameraHealth;
    private readonly IKioskLogService? _log;
    private readonly IFrameSelection? _frameSelection;
    private CancellationTokenSource? _cameraWatch;

    // Cartes du choix du cadre (LAB-315), préparées dès l'affichage de l'accueil ; null si le choix est coupé.
    private Task<IReadOnlyList<FrameTile>>? _framesTask;

    /// <summary>Préparation des cartes du choix du cadre en cours ou finie (tests).</summary>
    internal Task? FramesLoading => _framesTask;

    // Dernier avertissement « écran du client non affiché » : l'accueil revient après chaque séance,
    // le journal n'en garde qu'un tant que la cause ne change pas.
    private static string? _lastCustomDesignWarning;
    private static string? _lastOrgDesignWarning;
    private static string? _lastFramesWarning;

    /// <summary>Intervalle des vérifications de l'appareil photo tant que l'accueil est affiché (LAB-263).</summary>
    internal static readonly TimeSpan CameraCheckInterval = TimeSpan.FromSeconds(30);

    /// <summary>Attente entre deux vérifications (remplaçable par les tests).</summary>
    internal Func<TimeSpan, CancellationToken, Task> Delay { get; set; } = Task.Delay;

    private KioskConfig? _kioskConfig;
    private Guid _eventId;
    private string _eventName = "";

    // ── Écran affiché (1a, 1b, 1c) ────────────────────────────────────────────
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsNeutral), nameof(IsPersonalized), nameof(IsFormatChoice), nameof(IsCustomDesign),
        nameof(IsWholeScreenTappable), nameof(ShowCustomStartPill), nameof(ShowCustomTiles), nameof(ShowPhotosButton),
        nameof(PrintFooterName), nameof(IsOrgDesign), nameof(ShowStandardHome))]
    private HomeLayout _layout = HomeLayout.Neutral;

    public bool IsNeutral      => Layout == HomeLayout.Neutral;
    public bool IsPersonalized => Layout == HomeLayout.Personalized;
    public bool IsFormatChoice => Layout == HomeLayout.FormatChoice;
    public bool IsCustomDesign => Layout == HomeLayout.CustomDesign;
    public bool IsOrgDesign    => Layout == HomeLayout.OrgDesign;

    /// <summary>1a, 1b ou 1c : marque, textes, tirage et décor de la maquette.</summary>
    public bool ShowStandardHome => !IsCustomDesign && !IsOrgDesign;

    /// <summary>
    /// 1a, 1b et écran du client avec un seul format : tout l'écran démarre. 1c et écran du client avec
    /// plusieurs formats : seules les tuiles de format.
    /// </summary>
    public bool IsWholeScreenTappable => HomeScreen.IsWholeScreenTappable(Layout, Tiles.Count);

    // ── Écran d'accueil du client (LAB-291) ───────────────────────────────────
    /// <summary>PNG 1920×1080 validé, décodé à la taille de l'écran ; null hors <see cref="HomeLayout.CustomDesign"/>.</summary>
    [ObservableProperty] private BitmapImage? _customDesignImage;

    /// <summary>Écran du client, un seul format : pastille « Touchez l'écran pour commencer » en bas.</summary>
    public bool ShowCustomStartPill => IsCustomDesign && IsWholeScreenTappable;

    /// <summary>Écran du client, plusieurs formats : tuiles en bas, seules elles démarrent.</summary>
    public bool ShowCustomTiles => IsCustomDesign && !IsWholeScreenTappable;

    /// <summary>Écran du client : petit bouton « Photos » en bas à droite, seulement s'il y a des photos (spec D2).</summary>
    public bool ShowPhotosButton => IsCustomDesign && HasPhotos;

    // ── Écran composé par l'admin (LAB-297) ───────────────────────────────────
    /// <summary>Accueil de l'organisation en cache, images décodées ; null hors <see cref="HomeLayout.OrgDesign"/>.</summary>
    [ObservableProperty] private ScreenContent? _designedHome;

    /// <summary>Accueil personnalisé (home.personalized) : sinon fond neutre et textes « personnalisé seulement » masqués (D7).</summary>
    [ObservableProperty] private bool _homePersonalized;

    /// <summary><c>start</c> toujours actif ; <c>gallery</c> masqué tant que l'événement n'a pas de photo.</summary>
    public IReadOnlyDictionary<string, ScreenActionState> HomeActionStates => new Dictionary<string, ScreenActionState>
    {
        ["start"]   = ScreenActionState.Active,
        ["gallery"] = HasPhotos ? ScreenActionState.Active : ScreenActionState.Hidden,
    };

    /// <summary><c>event_name</c> : home.display_name, sinon le nom de l'événement ; <c>event_date</c> : comme 1b.</summary>
    public IReadOnlyDictionary<string, string> HomeTexts => new Dictionary<string, string>
    {
        ["event_name"] = DisplayName,
        ["event_date"] = DateText ?? "",
    };

    /// <summary><c>last_photo</c> : la dernière photo, sinon le design de l'événement, sinon rien.</summary>
    public IReadOnlyDictionary<string, ImageSource?> HomeSlots => new Dictionary<string, ImageSource?>
    {
        ["last_photo"] = (ImageSource?)LastPhoto ?? DesignImage,
    };

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintFooterName), nameof(HomeTexts))]
    private string _displayName = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasDate), nameof(HomeTexts))]
    private string? _dateText;

    public bool HasDate => !string.IsNullOrEmpty(DateText);

    /// <summary>Date du pied du tirage de repli (« 14 · 06 · 2026 »).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasShortDate))]
    private string? _shortDate;

    public bool HasShortDate => !string.IsNullOrEmpty(ShortDate);

    /// <summary>Pied du tirage de repli : la marque en 1a, le nom de l'événement en 1b et 1c.</summary>
    public string PrintFooterName => IsNeutral || string.IsNullOrEmpty(DisplayName) ? BrandName : DisplayName;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsWholeScreenTappable), nameof(ShowCustomStartPill), nameof(ShowCustomTiles))]
    private IReadOnlyList<HomeFormatTile> _tiles = [];

    // ── Marque en haut à gauche (LAB-257) : logo de la société, sinon icône et nom ──
    [ObservableProperty] private BitmapImage? _logoImage;
    [ObservableProperty] private bool _hasLogo;
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintFooterName))]
    private string _brandName = HomeScreen.DefaultBrandName;

    // ── Fond ──────────────────────────────────────────────────────────────────
    [ObservableProperty] private BitmapImage? _backgroundImage;
    [ObservableProperty] private bool _hasBackgroundImage;

    // ── Tirage de l'événement ─────────────────────────────────────────────────
    /// <summary>Dernier montage de l'événement (design + photo), null avant la première séance.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HomeSlots))]
    private BitmapImage? _lastPhoto;
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowPhotosButton), nameof(HomeActionStates))]
    [NotifyCanExecuteChangedFor(nameof(ScreenActionCommand))]
    private bool _hasPhotos;

    /// <summary>Design approuvé (PNG troué), posé sur du sauge tant qu'aucune photo n'est prise.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HomeSlots))]
    private BitmapImage? _designImage;
    [ObservableProperty] private bool _hasDesign;
    [ObservableProperty] private double _printWidth = 360;
    [ObservableProperty] private double _printHeight = 530;
    [ObservableProperty] private Thickness _photoLabelMargin = new(14, 0, 0, 14);

    // ── Problème technique (LAB-263) : appareil photo débranché ───────────────
    /// <summary>Appareil photo absent : écran « Problème technique », séance impossible, admin accessible.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(StartCommand), nameof(StartFormatCommand), nameof(ScreenActionCommand))]
    private bool _isCameraMissing;

    /// <summary>Texte de l'écran « Problème technique », avec le contact de la société gardé en cache.</summary>
    [ObservableProperty] private string _technicalProblemText = TechnicalProblem.Text(null, null);

    // Pavé PIN de l'écran admin (PIN propre à la borne, défini dans le SaaS)
    public AdminPinPadViewModel PinPad { get; }

    public HomeViewModel(INavigationService navigation, IKioskStateService state,
        ISyncService sync, IIdleTimeoutService idle,
        SessionPathService sessionPaths, ICompositeService composite, AdminPinPadViewModel pinPad,
        AppSettings? settings = null, ICameraHealthService? cameraHealth = null, IKioskLogService? log = null,
        IFrameSelection? frameSelection = null)
    {
        _cameraHealth   = cameraHealth;
        _log            = log;
        _frameSelection = frameSelection;
        _instanceName = settings?.Contact.CompanyName;
        _navigation   = navigation;
        _state        = state;
        _sync         = sync;
        _idle         = idle;
        _sessionPaths = sessionPaths;
        _composite    = composite;
        PinPad        = pinPad;
    }

    public async Task InitializeAsync()
    {
        StartCameraWatch();
        await LoadBrandAsync();

        if (_state.ActiveEventId == null) return;

        _eventId = _state.ActiveEventId.Value;

        var ev = await _sync.GetCurrentEventAsync(_eventId);
        if (ev == null) return;

        _eventName = ev.Name;
        _kioskConfig = KioskConfig.FromFormConfig(ev.FormConfigJson);
        var home = _kioskConfig?.Home;

        var formats = HomeScreen.EnabledFormats(home, HomeScreen.SupportedFormats);
        Tiles       = HomeScreen.Tiles(formats, home);

        // Écran du client (LAB-291) : seulement si l'accueil est personnalisé et l'option active,
        // et si le PNG validé est en cache et lisible. Sinon 1b / 1c (spec D7).
        bool wantsCustomDesign = home is { Personalized: true, ClientDesign: true };
        CustomDesignImage = wantsCustomDesign ? await LoadCustomDesignAsync() : null;
        // Écran de l'organisation (LAB-297) : seulement si l'écran du client ne s'affiche pas.
        HomePersonalized = home?.Personalized == true;
        DesignedHome = CustomDesignImage == null ? await LoadOrgDesignAsync() : null;
        Layout      = HomeScreen.ResolveLayout(home?.Personalized == true, formats,
            home?.ClientDesign == true, CustomDesignImage != null, DesignedHome != null);
        DisplayName = HomeScreen.DisplayName(home, ev.Name);
        DateText    = EventDateFormatter.Format(ev.StartDate, ev.EndDate);
        ShortDate   = EventDateFormatter.FormatShort(ev.StartDate);

        _framesTask = _kioskConfig?.FrameChoice?.Enabled == true ? LoadFramesAsync(_eventId) : null;

        // Délai de retour auto à l'accueil (écran de partage) piloté par l'événement
        if (_kioskConfig != null)
            _idle.SetTimeout(_kioskConfig.Result.AutoReturnSeconds);

        await LoadPrintAsync();
        // L'écran du client remplace aussi le fond de l'événement. Celui de l'organisation ne le montre
        // que dessous, là où son fond est transparent (spec D8).
        if (IsOrgDesign)
        {
            if (DesignedHome?.Layout.TransparentBackground == true) await LoadBackgroundAsync(home?.BackgroundUrl);
            HasBackgroundImage = false; // le fond et son voile de 1a / 1b / 1c restent cachés
        }
        else if (!IsCustomDesign) await LoadBackgroundAsync(home?.BackgroundUrl);
    }

    // Plan et images gardés par la synchro (ou l'import .pola), décodés hors du fil d'affichage.
    // Rien de publié : écran standard, sans message. Cache illisible, ou police remplacée par DM Sans :
    // avertissement (catégorie « screens »).
    private async Task<ScreenContent?> LoadOrgDesignAsync()
    {
        CachedScreen? cached;
        try { cached = _sync.GetScreen(ScreenLayout.KindHome); }
        catch { cached = null; }
        if (cached == null) return null;

        var (content, error) = await Task.Run(() => (ScreenContent.LoadCached(cached, out var e), e));
        var warning = content == null
            ? $"Accueil de l'organisation v{cached.Layout.Version} illisible ({error}) : accueil standard affiché."
            : content.FontWarnings.Count > 0
                ? $"Accueil de l'organisation v{cached.Layout.Version} : {string.Join(", ", content.FontWarnings)} ; textes écrits en DM Sans."
                : null;
        if (warning == null)
        {
            _lastOrgDesignWarning = null;
            return content;
        }

        if (_log != null && Interlocked.Exchange(ref _lastOrgDesignWarning, warning) != warning)
        {
            try { await _log.LogWarningAsync("screens", warning); }
            catch { /* journal indisponible : l'accueil s'affiche quand même */ }
        }
        return content;
    }

    // PNG gardé par la synchro (ou l'import .pola), décodé hors du fil d'affichage à la taille de l'écran.
    // Absent ou illisible : avertissement dans le journal (catégorie « home ») et accueil habituel.
    private async Task<BitmapImage?> LoadCustomDesignAsync()
    {
        var path  = _sync.GetHomeDesignPath();
        var image = path == null ? null : await Task.Run(() => ImageLoader.LoadForScreen(path, fill: true));
        if (image != null)
        {
            _lastCustomDesignWarning = null;
            return image;
        }

        var warning = path == null
            ? $"Écran d'accueil du client absent du cache (event {_eventId}) : accueil habituel affiché."
            : $"Écran d'accueil du client illisible ({System.IO.Path.GetFileName(path)}, event {_eventId}) : accueil habituel affiché.";
        if (_log != null && Interlocked.Exchange(ref _lastCustomDesignWarning, warning) != warning)
        {
            try { await _log.LogWarningAsync("home", warning); }
            catch { /* journal indisponible : l'accueil s'affiche quand même */ }
        }
        return null;
    }

    /// <summary>Oublie le dernier avertissement de l'écran du client (tests).</summary>
    internal static void ResetCustomDesignWarning()
    {
        _lastCustomDesignWarning = null;
        _lastOrgDesignWarning = null;
        _lastFramesWarning = null;
    }

    // Miniatures décodées à la taille des cartes, hors du fil d'affichage. Un cadre sans PNG lisible
    // est retiré de la liste (avertissement « frames », une fois tant que la cause ne change pas).
    private async Task<IReadOnlyList<FrameTile>> LoadFramesAsync(Guid eventId)
    {
        try
        {
            var templates = FrameChoice.Ordered(await _sync.GetTemplatesAsync(eventId));
            if (templates.Count < 2) return [];

            var candidates = new List<FrameCandidate>();
            var unreadable = new List<string>();
            foreach (var template in templates)
            {
                int zoneCount = 0;
                ImageSource? image = null;
                try
                {
                    zoneCount = (await _composite.GetPhotoZonesAsync(template.Id, template.CanvasJson)).Count;
                    if (template.ThumbnailPath is { } path)
                        image = await Task.Run(() => ImageLoader.Load(path,
                            (int)(FrameChoice.ThumbnailMaxWidth * 2), (int)(FrameChoice.ThumbnailMaxHeight * 2), fill: false));
                }
                catch { image = null; }
                if (image == null) unreadable.Add(template.Id.ToString());
                candidates.Add(new FrameCandidate(template, zoneCount, image));
            }

            var warning = unreadable.Count == 0 ? null
                : $"PNG illisible ou absent pour {unreadable.Count} cadre(s) ({string.Join(", ", unreadable)}, event {eventId}) : cadre(s) retiré(s) du choix.";
            if (Interlocked.Exchange(ref _lastFramesWarning, warning) != warning && warning != null && _log != null)
            {
                try { await _log.LogWarningAsync("frames", warning); }
                catch { /* journal indisponible : le choix s'affiche quand même */ }
            }
            return FrameChoice.Tiles(candidates);
        }
        catch { return []; }
    }

    public void Release()
    {
        _cameraWatch?.Cancel();
        _cameraWatch?.Dispose();
        _cameraWatch = null;
        BackgroundImage    = null;
        HasBackgroundImage = false;
        LastPhoto          = null;
        DesignImage        = null;
        CustomDesignImage  = null;
        DesignedHome       = null;
        LogoImage          = null;
        HasLogo            = false;
        _framesTask        = null;
    }

    // ── Appareil photo : état connu tout de suite, vérifié à l'affichage puis toutes les 30 s ──
    private void StartCameraWatch()
    {
        TechnicalProblemText = TechnicalProblem.Text(_state.ContactCompany, _state.ContactPhone);
        if (_cameraHealth == null) return;

        _cameraWatch?.Cancel();
        _cameraWatch?.Dispose();
        var cts = new CancellationTokenSource();
        _cameraWatch = cts;

        ApplyCameraStatus(_cameraHealth.Status);
        _ = WatchCameraAsync(_cameraHealth, cts.Token);
    }

    // Les reprises se font sur le fil d'affichage (contexte de l'appelant) : les propriétés y sont modifiées.
    private async Task WatchCameraAsync(ICameraHealthService health, CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                var status = await health.CheckNowAsync(token);
                if (token.IsCancellationRequested) return;
                ApplyCameraStatus(status);
                await Delay(CameraCheckInterval, token);
            }
        }
        catch (OperationCanceledException) { /* accueil quitté */ }
        catch { /* vérification en erreur : l'état affiché reste le dernier connu */ }
    }

    // Inconnu (vérification pas encore aboutie) : accueil normal, on ne bloque pas les invités sans preuve.
    private void ApplyCameraStatus(CameraHealth status) => IsCameraMissing = status == CameraHealth.Absent;

    // Logo gardé en cache par la synchro (ou l'import .pola), décodé hors du fil d'affichage.
    // Absent ou illisible : l'icône et le nom de la société (sinon celui de l'instance).
    private async Task LoadBrandAsync()
    {
        BrandName = HomeScreen.BrandName(_state.ContactCompany, _instanceName);
        var path  = _sync.GetOrgLogoPath();
        LogoImage = path == null ? null
            : await Task.Run(() => ImageLoader.Load(path, (int)(LogoMaxWidth * 2), (int)(LogoMaxHeight * 2), fill: false));
        HasLogo   = LogoImage != null;
    }

    // ── Tirage : design de l'événement et dernière photo ──────────────────────
    private async Task LoadPrintAsync()
    {
        try
        {
            var files = _sessionPaths.GetCompositeFiles(_eventName, _eventId);
            LastPhoto = files.Count > 0
                ? await Task.Run(() => ImageLoader.LoadThumbnail(files[0], PrintDecodeWidth))
                : null;
            HasPhotos = LastPhoto != null;
        }
        catch { HasPhotos = false; }

        // L'écran du client n'a pas de tirage : seule la présence de photos compte (bouton « Photos »).
        if (IsCustomDesign) return;

        try
        {
            var design = (await _sync.GetTemplatesAsync(_eventId)).FirstOrDefault();
            if (design?.ThumbnailPath is not { } pngPath) return;

            var zones  = await _composite.GetPhotoZonesAsync(design.Id, design.CanvasJson);
            var layout = HomeScreen.PrintLayout(design.Format, zones, PrintMaxWidth, PrintMaxHeight);
            if (layout == null) return;

            // Sans photo, le design troué est montré sur du sauge ; avec, le montage le contient déjà.
            DesignImage = HasPhotos ? null : await Task.Run(() => ImageLoader.LoadThumbnail(pngPath, PrintDecodeWidth));
            if (!HasPhotos && DesignImage == null) return;

            PrintWidth       = layout.Width;
            PrintHeight      = layout.Height;
            PhotoLabelMargin = new Thickness(layout.LabelLeft, 0, 0, layout.LabelBottom);
            HasDesign        = true;
        }
        catch { HasDesign = false; }
    }

    // ── Fond : celui de l'événement, sinon le crème de la maquette.
    private async Task LoadBackgroundAsync(string? eventBackgroundUrl)
    {
        if (!string.IsNullOrEmpty(eventBackgroundUrl))
            await TryLoadBackgroundAsync(_sync.GetHomeBackgroundPath(_eventId, eventBackgroundUrl));
    }

    // Fichier local décodé hors du fil d'affichage, à la taille de l'écran. False si absent ou illisible.
    private async Task<bool> TryLoadBackgroundAsync(string localPath)
    {
        var bmp = await Task.Run(() => ImageLoader.LoadForScreen(localPath, fill: true));
        if (bmp == null) return false;
        BackgroundImage    = bmp;
        HasBackgroundImage = true;
        return true;
    }

    // ── Commandes ─────────────────────────────────────────────────────────────
    [RelayCommand]
    private void OpenGallery()
    {
        if (!HasPhotos || PinPad.ShowPinEntry) return;
        _navigation.NavigateTo<Views.GalleryView>();
    }

    /// <summary>Appui sur l'écran (1a, 1b, écran du client avec un seul format) : démarre la séance photo.</summary>
    [RelayCommand(CanExecute = nameof(CanStartSession))]
    private void Start()
    {
        if (!IsWholeScreenTappable) return;
        Begin();
    }

    /// <summary>Appui sur une tuile de format (1c, écran du client). Seule la photo existe pour l'instant.</summary>
    [RelayCommand(CanExecute = nameof(CanStartSession))]
    private void StartFormat(HomeFormatTile? tile) => Begin();

    private bool CanStartSession() => !IsCameraMissing;

    /// <summary>
    /// Bouton ou emplacement de l'accueil de l'organisation (LAB-297) : <c>start</c> démarre la séance,
    /// <c>gallery</c> et l'emplacement <c>last_photo</c> ouvrent la galerie s'il y a des photos (sinon
    /// l'appui sur l'emplacement démarre la séance, comme le reste de l'écran).
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanRunScreenAction))]
    private void ScreenAction(string? action)
    {
        switch (action)
        {
            case "start": Start(); break;
            case "gallery" or "last_photo": OpenGallery(); break;
        }
    }

    private bool CanRunScreenAction(string? action) => action switch
    {
        "start" => CanStartSession(),
        "gallery" or "last_photo" => HasPhotos,
        _ => false,
    };

    private void Begin()
    {
        // Ne pas démarrer la séquence si l'overlay PIN admin est ouvert, ni sans appareil photo
        if (PinPad.ShowPinEntry || IsCameraMissing || _waitingForFrames) return;

        // Message RGPD passé via le paramètre de navigation
        var rgpd = _kioskConfig?.Rgpd?.Enabled == true
            ? new RgpdParameters(_kioskConfig.Rgpd.Message)
            : null;

        var frames = _framesTask;
        if (frames == null) FrameSelectViewModel.ContinueToCapture(_navigation, rgpd);
        else if (frames.IsCompleted) ContinueWithFrames(frames.Result, rgpd);
        else _ = BeginWhenFramesReadyAsync(frames, rgpd);
    }

    private bool _waitingForFrames;

    // Toucher avant la fin du décodage des miniatures : on attend (quelques centaines de ms au plus),
    // sauf si l'accueil a été quitté ou le pavé PIN ouvert entre-temps.
    private async Task BeginWhenFramesReadyAsync(Task<IReadOnlyList<FrameTile>> frames, RgpdParameters? rgpd)
    {
        _waitingForFrames = true;
        IReadOnlyList<FrameTile> tiles;
        try { tiles = await frames; }
        finally { _waitingForFrames = false; }
        if (_framesTask != frames || PinPad.ShowPinEntry || IsCameraMissing) return;
        ContinueWithFrames(tiles, rgpd);
    }

    // Un seul cadre lisible : il est pris sans écran de choix (spec, cas limites).
    private void ContinueWithFrames(IReadOnlyList<FrameTile> tiles, RgpdParameters? rgpd)
    {
        if (FrameChoice.ShouldAsk(_kioskConfig?.FrameChoice, tiles.Count))
        {
            _navigation.NavigateTo<Views.FrameSelectView>(new FrameSelectParameters(tiles, rgpd));
            return;
        }
        if (tiles.Count == 1 && _frameSelection != null) _frameSelection.SelectedTemplateId = tiles[0].TemplateId;
        FrameSelectViewModel.ContinueToCapture(_navigation, rgpd);
    }
}

/// <summary>Textes de l'écran « Problème technique » (LAB-263).</summary>
public static class TechnicalProblem
{
    public const string Title = "Problème technique";

    /// <summary>
    /// « … Contactez &lt;société&gt; au &lt;téléphone&gt;. » Sans téléphone : « Contactez votre loueur. »
    /// Sans nom de société mais avec un téléphone : « Contactez votre loueur au &lt;téléphone&gt;. »
    /// </summary>
    public static string Text(string? company, string? phone)
    {
        const string intro = "L'appareil photo n'est pas branché. La borne ne peut pas prendre de photo pour le moment.";
        var name = string.IsNullOrWhiteSpace(company) ? "votre loueur" : company.Trim();
        var contact = string.IsNullOrWhiteSpace(phone)
            ? "Contactez votre loueur."
            : $"Contactez {name} au {phone.Trim()}.";
        return $"{intro} {contact}";
    }
}
