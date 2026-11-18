using System.ComponentModel;
using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Controls;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Écran résultat : aperçu du tirage, impression (nombre d'exemplaires dans la limite des quotas),
/// QR code vers la galerie, envoi par e-mail. Sert aussi à la photo rouverte depuis la galerie de
/// l'accueil (<see cref="ResultParameters.FromGallery"/> : pas de « Refaire les photos »).
/// Si l'admin a composé l'écran de partage de l'organisation (LAB-297), il remplace l'écran de
/// partage standard ; QR code, e-mail et e-mail envoyé restent les écrans standard.
/// </summary>
public partial class ResultViewModel : ObservableObject, IParameterReceiver, IReleasable
{
    private readonly IPrintService _print;
    private readonly ISupabaseService _supabase;
    private readonly INavigationService _navigation;
    private readonly INetworkMonitorService _network;
    private readonly AppSettings _settings;
    private readonly IKioskLogService _kioskLog;
    private readonly ISessionService _sessions;
    private readonly IGuestJourneyService _journey;
    private readonly Func<IIdleTimer> _timerFactory;
    private readonly ISyncService? _sync;

    private ResultParameters? _params;
    private string? _photoPublicUrl;
    private bool _printEnabled;
    private bool _hasPrinted;
    private bool _showRemainingPrints = true;

    // Retour automatique à l'accueil (result.auto_return_seconds ; 0 = désactivé).
    private int _autoHomeSeconds = 30;
    private IIdleTimer? _timer;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsShareScreen), nameof(IsQrScreen), nameof(IsEmailScreen), nameof(IsEmailSentScreen),
        nameof(ShowDesignedShare), nameof(ShowStandardShare), nameof(HasSharePrintBanner))]
    private ResultScreen _screen = ResultScreen.Share;

    public bool IsShareScreen => Screen == ResultScreen.Share;
    public bool IsQrScreen => Screen == ResultScreen.Qr;
    public bool IsEmailScreen => Screen == ResultScreen.Email;
    public bool IsEmailSentScreen => Screen == ResultScreen.EmailSent;

    [ObservableProperty] private BitmapImage? _compositeImage;
    [ObservableProperty] private BitmapSource? _qrCodeImage;
    [ObservableProperty] private string _eventName = "";
    [ObservableProperty] private string _paperFormat = "4x6";

    /// <summary>Lien à taper sans lecteur QR : la galerie de l'événement, sans « https:// ».</summary>
    [ObservableProperty] private string _galleryLink = "";

    [ObservableProperty] private int _autoHomeSecondsLeft;
    [ObservableProperty] private bool _showCountdown;

    // Boutons activables depuis le SaaS (form_config.kiosk.result.buttons.*)
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowBottomRow))]
    private bool _showRetake;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowBottomRow))]
    private bool _showFinish;

    /// <summary>« Refaire la photo » pour une séance d'une seule photo, sinon « Refaire les photos ».</summary>
    [ObservableProperty] private string _retakeText = "Refaire les photos";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowShareTiles), nameof(ShowShareStatus), nameof(Subtitle))]
    private bool _showQrTile;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowShareTiles), nameof(ShowShareStatus), nameof(Subtitle))]
    private bool _showEmailTile;

    public bool ShowShareTiles => ShowQrTile || ShowEmailTile;
    public bool ShowBottomRow => ShowRetake || ShowFinish;

    // Photo en ligne : le QR code et l'e-mail en ont besoin.
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowShareStatus))]
    [NotifyCanExecuteChangedFor(nameof(OpenQrCommand), nameof(OpenEmailCommand), nameof(SendEmailCommand))]
    private bool _isShareReady;

    [ObservableProperty] private string _shareStatus = "";

    public bool ShowShareStatus => ShowShareTiles && !IsShareReady && ShareStatus.Length > 0;

    partial void OnShareStatusChanged(string value) => OnPropertyChanged(nameof(ShowShareStatus));

    public ResultViewModel(
        IPrintService print,
        ISupabaseService supabase,
        INavigationService navigation,
        INetworkMonitorService network,
        AppSettings settings,
        IKioskLogService kioskLog,
        ISessionService sessions,
        IGuestJourneyService journey,
        ISyncService sync)
        : this(print, supabase, navigation, network, settings, kioskLog, sessions, journey, () => new DispatcherIdleTimer(), sync) { }

    internal ResultViewModel(
        IPrintService print,
        ISupabaseService supabase,
        INavigationService navigation,
        INetworkMonitorService network,
        AppSettings settings,
        IKioskLogService kioskLog,
        ISessionService sessions,
        IGuestJourneyService journey,
        Func<IIdleTimer> timerFactory,
        ISyncService? sync = null)
    {
        _print        = print;
        _supabase     = supabase;
        _navigation   = navigation;
        _network      = network;
        _settings     = settings;
        _kioskLog     = kioskLog;
        _sessions     = sessions;
        _journey      = journey;
        _timerFactory = timerFactory;
        _sync         = sync;
        DomainSuggestions = EmailDomainSuggestions.Suggest("", DomainSuggestionCount);
    }

    public void ReceiveParameter(object parameter)
    {
        if (parameter is ResultParameters p)
            _ = InitializeAsync(p);
    }

    internal async Task InitializeAsync(ResultParameters p)
    {
        _params     = p;
        EventName   = p.EventName;
        PaperFormat = p.PaperFormat;
        Screen      = ResultScreen.Share;
        ApplyConfig(p);
        GalleryLink = ShareLinks.BuildGalleryLink(_settings.Kiosk.SaasUrl, p.AccessCode);

        CompositeImage = await Task.Run(() => ImageLoader.LoadForScreen(p.CompositePath, fill: false));
        DesignedShare  = await DesignedShareLoader.LoadAsync(_sync, _kioskLog);

        try { await RefreshPrintStatusAsync(); }
        catch (Exception ex) { await _kioskLog.LogErrorAsync("print", ex.Message, ex.StackTrace); }

        StartCountdown();

        try { await _sessions.AttachCompositeAsync(p.SessionId, p.EventId, p.CompositePath); }
        catch (Exception ex)
        {
            await _kioskLog.LogErrorAsync("session",
                $"Séance {p.SessionId} non rattachée au montage : {ex.Message}", ex.ToString());
        }

        // Photo déjà partagée (rouverte depuis la galerie de l'accueil) : on réutilise l'URL et le
        // QR déjà générés, sans renvoyer la photo (pas de doublon dans la galerie du client).
        var shared = ShareInfoFile.Read(p.CompositePath);
        if (shared is { IsShared: true })
            ShowShareReady(shared.Url!, shared.PhotoId);
        else if (_network.IsOnline)
            await UploadAsync();
        else
            ShareStatus = "Photo gardée sur la borne : le QR code et l'email seront disponibles au retour du réseau.";
    }

    private void ApplyConfig(ResultParameters p)
    {
        var buttons = p.ResultCfg?.Buttons ?? new Models.Supabase.ResultButtonsConfig();

        ShowRetake    = buttons.Retake.Enabled && !p.FromGallery;
        RetakeText    = p.PhotoCount > 1 ? "Refaire les photos" : "Refaire la photo";
        ShowFinish    = buttons.Home.Enabled;
        ShowQrTile    = buttons.Qr.Enabled;
        // L'e-mail demande aussi l'activation de l'envoi dans la config e-mail de l'événement.
        ShowEmailTile = buttons.Email.Enabled && p.EmailConfig?.Enabled == true;
        _printEnabled = buttons.Print.Enabled;
        _showRemainingPrints = p.ResultCfg?.ShowRemainingPrints ?? true;
        _autoHomeSeconds = p.ResultCfg?.AutoReturnSeconds ?? 30;
        NotifyPrintBlockChanged();
    }

    private void NotifyPrintBlockChanged()
    {
        OnPropertyChanged(nameof(ShowPrintBlock));
        OnPropertyChanged(nameof(Subtitle));
        OnPropertyChanged(nameof(PrintSubtitle));
    }

    // ── Retour automatique à l'accueil ────────────────────────────────────
    // Compte à rebours affiché en secondes ; toute action de l'invité le remet à zéro.

    private void StartCountdown()
    {
        StopCountdown();
        ShowCountdown = _autoHomeSeconds > 0;
        AutoHomeSecondsLeft = Math.Max(0, _autoHomeSeconds);
        if (_autoHomeSeconds <= 0) return;

        _timer = _timerFactory();
        _timer.Interval = TimeSpan.FromSeconds(1);
        _timer.Tick += OnCountdownTick;
        _timer.Start();
    }

    private void StopCountdown()
    {
        if (_timer == null) return;
        _timer.Tick -= OnCountdownTick;
        _timer.Stop();
        _timer = null;
    }

    private void OnCountdownTick(object? sender, EventArgs e)
    {
        // Déjà parti de l'écran résultat (ex. délai d'inactivité global) : on arrête ce compte à rebours.
        if (_navigation.CurrentViewType != typeof(Views.ResultView))
        {
            StopCountdown();
            return;
        }

        // Pas de départ pendant une impression ou un envoi en cours.
        if (IsPrinting || IsEmailSending) return;

        AutoHomeSecondsLeft = Math.Max(0, AutoHomeSecondsLeft - 1);
        if (AutoHomeSecondsLeft == 0) GoHome();
    }

    /// <summary>L'invité touche l'écran ou agit : le compte à rebours repart du début.</summary>
    public void RegisterActivity()
    {
        if (_autoHomeSeconds > 0) AutoHomeSecondsLeft = _autoHomeSeconds;
    }

    // ── Sous-écrans ───────────────────────────────────────────────────────

    [RelayCommand(CanExecute = nameof(IsShareReady))]
    private void OpenQr()
    {
        RegisterActivity();
        Screen = ResultScreen.Qr;
    }

    [RelayCommand(CanExecute = nameof(IsShareReady))]
    private void OpenEmail()
    {
        RegisterActivity();
        // E-mail saisi au questionnaire de ce parcours (vidé à l'arrivée sur l'accueil).
        EmailInputText = _journey.PrefillEmail ?? "";
        EmailConsent   = false;
        EmailError     = "";
        Screen         = ResultScreen.Email;
    }

    [RelayCommand]
    private void BackToShare()
    {
        RegisterActivity();
        if (Screen == ResultScreen.Email)
        {
            EmailInputText = "";
            EmailConsent   = false;
            EmailError     = "";
        }
        Screen = ResultScreen.Share;
    }

    // ── Navigation ────────────────────────────────────────────────────────

    // Navigation explicite : l'écran précédent peut être le choix d'effet ou la galerie.
    [RelayCommand]
    private void Retake()
    {
        StopCountdown();
        _navigation.NavigateTo<Views.LiveView>();
    }

    [RelayCommand]
    private void GoHome()
    {
        StopCountdown();
        _navigation.NavigateTo<Views.HomeView>();
    }

    public void Release()
    {
        StopCountdown();
        CompositeImage = null;
        QrCodeImage    = null;
        DesignedShare  = null;
    }

    // ── Envoi de la photo et QR code ──────────────────────────────────────

    private async Task UploadAsync()
    {
        if (_params == null) return;
        ShareStatus = "Préparation de votre photo…";

        try
        {
            var (publicUrl, photoId) = await _sessions.UploadSessionAsync(_params.SessionId);
            ShowShareReady(publicUrl, photoId);
        }
        catch (Exception ex)
        {
            ShareStatus = "Envoi impossible pour le moment : la photo est gardée sur la borne et sera renvoyée automatiquement.";
            await _kioskLog.LogErrorAsync("photo_upload", ex.Message, ex.StackTrace);
        }
    }

    private void ShowShareReady(string publicUrl, Guid photoId)
    {
        _photoPublicUrl = publicUrl;
        var qrUrl       = ShareLinks.BuildQrUrl(_settings.Kiosk.SaasUrl, _params?.AccessCode, photoId, publicUrl);
        QrCodeImage     = QrCodeRenderer.Render(qrUrl, QrCodeRenderer.SharePixelsPerModule);
        ShareStatus     = "";
        IsShareReady    = true;
    }
}
