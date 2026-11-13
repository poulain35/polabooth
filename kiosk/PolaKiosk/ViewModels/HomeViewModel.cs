using System.Windows;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Accueil de la borne (LAB-251) : écran 1a, 1b ou 1c selon <see cref="HomeScreen.ResolveLayout"/>,
/// avec à droite le tirage de l'événement garni de la dernière photo prise.
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
    private CancellationTokenSource? _cameraWatch;

    /// <summary>Intervalle des vérifications de l'appareil photo tant que l'accueil est affiché (LAB-263).</summary>
    internal static readonly TimeSpan CameraCheckInterval = TimeSpan.FromSeconds(30);

    /// <summary>Attente entre deux vérifications (remplaçable par les tests).</summary>
    internal Func<TimeSpan, CancellationToken, Task> Delay { get; set; } = Task.Delay;

    private KioskConfig? _kioskConfig;
    private Guid _eventId;
    private string _eventName = "";

    // ── Écran affiché (1a, 1b, 1c) ────────────────────────────────────────────
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsNeutral), nameof(IsPersonalized), nameof(IsFormatChoice), nameof(IsWholeScreenTappable), nameof(PrintFooterName))]
    private HomeLayout _layout = HomeLayout.Neutral;

    public bool IsNeutral      => Layout == HomeLayout.Neutral;
    public bool IsPersonalized => Layout == HomeLayout.Personalized;
    public bool IsFormatChoice => Layout == HomeLayout.FormatChoice;

    /// <summary>1a et 1b : tout l'écran démarre. 1c : seules les tuiles de format.</summary>
    public bool IsWholeScreenTappable => Layout != HomeLayout.FormatChoice;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintFooterName))]
    private string _displayName = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasDate))]
    private string? _dateText;

    public bool HasDate => !string.IsNullOrEmpty(DateText);

    /// <summary>Date du pied du tirage de repli (« 14 · 06 · 2026 »).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasShortDate))]
    private string? _shortDate;

    public bool HasShortDate => !string.IsNullOrEmpty(ShortDate);

    /// <summary>Pied du tirage de repli : la marque en 1a, le nom de l'événement en 1b et 1c.</summary>
    public string PrintFooterName => IsNeutral || string.IsNullOrEmpty(DisplayName) ? BrandName : DisplayName;

    [ObservableProperty] private IReadOnlyList<HomeFormatTile> _tiles = [];

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
    [ObservableProperty] private BitmapImage? _lastPhoto;
    [ObservableProperty] private bool _hasPhotos;

    /// <summary>Design approuvé (PNG troué), posé sur du sauge tant qu'aucune photo n'est prise.</summary>
    [ObservableProperty] private BitmapImage? _designImage;
    [ObservableProperty] private bool _hasDesign;
    [ObservableProperty] private double _printWidth = 360;
    [ObservableProperty] private double _printHeight = 530;
    [ObservableProperty] private Thickness _photoLabelMargin = new(14, 0, 0, 14);

    // Mention d'accueil du questionnaire obligatoire (LAB-222) : l'invité est prévenu avant de poser.
    [ObservableProperty] private string _homeNotice = "";
    [ObservableProperty] private bool _showHomeNotice;

    // ── Problème technique (LAB-263) : appareil photo débranché ───────────────
    /// <summary>Appareil photo absent : écran « Problème technique », séance impossible, admin accessible.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(StartCommand), nameof(StartFormatCommand))]
    private bool _isCameraMissing;

    /// <summary>Texte de l'écran « Problème technique », avec le contact de la société gardé en cache.</summary>
    [ObservableProperty] private string _technicalProblemText = TechnicalProblem.Text(null, null);

    // Pavé PIN de l'écran admin (PIN propre à la borne, défini dans le SaaS)
    public AdminPinPadViewModel PinPad { get; }

    public HomeViewModel(INavigationService navigation, IKioskStateService state,
        ISyncService sync, IIdleTimeoutService idle,
        SessionPathService sessionPaths, ICompositeService composite, AdminPinPadViewModel pinPad,
        AppSettings? settings = null, ICameraHealthService? cameraHealth = null)
    {
        _cameraHealth = cameraHealth;
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
        _kioskConfig = ReadKioskConfig(ev.FormConfigJson);
        var home = _kioskConfig?.Home;

        var formats = HomeScreen.EnabledFormats(home, HomeScreen.SupportedFormats);
        Layout      = HomeScreen.ResolveLayout(home?.Personalized == true, formats);
        Tiles       = HomeScreen.Tiles(formats, home);
        DisplayName = HomeScreen.DisplayName(home, ev.Name);
        DateText    = EventDateFormatter.Format(ev.StartDate, ev.EndDate);
        ShortDate   = EventDateFormatter.FormatShort(ev.StartDate);

        (ShowHomeNotice, HomeNotice) = ResolveHomeNotice(_kioskConfig?.Questionnaire);

        // Délai de retour auto à l'accueil (écran de partage) piloté par l'événement
        if (_kioskConfig != null)
            _idle.SetTimeout(_kioskConfig.Result.AutoReturnSeconds);

        await LoadPrintAsync();
        await LoadBackgroundAsync(home?.BackgroundUrl);
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
        LogoImage          = null;
        HasLogo            = false;
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

    // Config illisible : accueil neutre, sans consentement ni questionnaire (comme avant LAB-251).
    private static KioskConfig? ReadKioskConfig(string formConfigJson)
    {
        try { return JObject.Parse(formConfigJson)["kiosk"]?.ToObject<KioskConfig>(); }
        catch { return null; }
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

    /// <summary>Appui sur l'écran (1a, 1b) : démarre la séance photo.</summary>
    [RelayCommand(CanExecute = nameof(CanStartSession))]
    private void Start()
    {
        if (!IsWholeScreenTappable) return;
        Begin();
    }

    /// <summary>Appui sur une tuile de format (1c). Seule la photo existe pour l'instant.</summary>
    [RelayCommand(CanExecute = nameof(CanStartSession))]
    private void StartFormat(HomeFormatTile? tile) => Begin();

    private bool CanStartSession() => !IsCameraMissing;

    private void Begin()
    {
        // Ne pas démarrer la séquence si l'overlay PIN admin est ouvert, ni sans appareil photo
        if (PinPad.ShowPinEntry || IsCameraMissing) return;

        if (_kioskConfig?.Rgpd?.Enabled == true)
        {
            // Message RGPD (et mention du questionnaire obligatoire) passés via le paramètre de navigation
            _navigation.NavigateTo<Views.RgpdView>(
                new RgpdParameters(_kioskConfig.Rgpd.Message, ShowHomeNotice ? HomeNotice : null));
        }
        else
        {
            _navigation.NavigateTo<Views.LiveView>();
        }
    }

    /// <summary>Mention affichée seulement si le questionnaire est actif ET obligatoire pour la photo.</summary>
    internal static (bool Show, string Text) ResolveHomeNotice(QuestionnaireConfig? questionnaire)
        => questionnaire is { IsActive: true, RequiredForPhoto: true }
            ? (true, questionnaire.ResolvedHomeNotice())
            : (false, "");
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
