using System.IO;
using System.Text.RegularExpressions;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Controls;
using PolaKiosk.Services;
using QRCoder;

namespace PolaKiosk.ViewModels;

/// <summary>Écrans de l'écran résultat (LAB-252) : partage (3), QR code (3a), e-mail (3b), e-mail envoyé.</summary>
public enum ResultScreen { Share, Qr, Email, EmailSent }

/// <summary>
/// Écran résultat : aperçu du tirage, impression (nombre d'exemplaires dans la limite des quotas),
/// QR code vers la galerie, envoi par e-mail. Sert aussi à la photo rouverte depuis la galerie de
/// l'accueil (<see cref="ResultParameters.FromGallery"/> : pas de « Refaire les photos »).
/// </summary>
public partial class ResultViewModel : ObservableObject, IParameterReceiver, IReleasable
{
    // Lot d'impression quand aucun plafond n'est fixé, et plafond d'un lot sinon.
    internal const int UnlimitedMaxCopies = 10;
    internal const int LimitedMaxCopies = 20;

    private static readonly Regex EmailPattern = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.CultureInvariant);

    private readonly IPrintService _print;
    private readonly ISupabaseService _supabase;
    private readonly INavigationService _navigation;
    private readonly INetworkMonitorService _network;
    private readonly AppSettings _settings;
    private readonly IKioskLogService _kioskLog;
    private readonly ISessionService _sessions;
    private readonly IGuestJourneyService _journey;
    private readonly Func<IIdleTimer> _timerFactory;

    private ResultParameters? _params;
    private string? _photoPublicUrl;
    private bool _printEnabled;
    private bool _hasPrinted;
    private bool _showRemainingPrints = true;

    // Retour automatique à l'accueil (result.auto_return_seconds ; 0 = désactivé).
    private int _autoHomeSeconds = 30;
    private IIdleTimer? _timer;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsShareScreen), nameof(IsQrScreen), nameof(IsEmailScreen), nameof(IsEmailSentScreen))]
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

    // ── Impression ────────────────────────────────────────────────────────
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowPrintBlock), nameof(PrintButtonText), nameof(PrintSubtitle), nameof(Subtitle))]
    [NotifyCanExecuteChangedFor(nameof(PrintCommand), nameof(IncrementCopiesCommand), nameof(DecrementCopiesCommand))]
    private bool _canPrint;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintButtonText))]
    [NotifyCanExecuteChangedFor(nameof(PrintCommand), nameof(IncrementCopiesCommand), nameof(DecrementCopiesCommand))]
    private bool _isPrinting;

    /// <summary>Tirages encore autorisés pour cette photo ; null = aucun plafond.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintSubtitle))]
    private int? _remainingPrints;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintButtonText))]
    [NotifyCanExecuteChangedFor(nameof(IncrementCopiesCommand), nameof(DecrementCopiesCommand))]
    private int _printCopies = 1;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(IncrementCopiesCommand))]
    private int _maxCopies = UnlimitedMaxCopies;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintSubtitle), nameof(HasPrintError))]
    private string _printError = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintSubtitle))]
    private string _printNotice = "";

    public bool HasPrintError => PrintError.Length > 0;

    /// <summary>
    /// Bloc d'impression : activé dans le SaaS et tirage autorisé à l'arrivée. Une fois la limite
    /// atteinte ici, il reste affiché (bouton grisé) pour ne pas déplacer les autres boutons.
    /// </summary>
    public bool ShowPrintBlock => _printEnabled && (CanPrint || _hasPrinted);

    /// <summary>« 10×15 » ou « 5×15 » (bandelette).</summary>
    public string PaperLabel => PaperFormat == "2x6" ? "bandelette 5×15" : "10×15";

    public string PrintButtonText =>
        IsPrinting ? "Impression…"
        : !CanPrint ? "Plus de tirage disponible"
        : PrintCopies > 1 ? $"Imprimer {PrintCopies} exemplaires" : "Imprimer 1 exemplaire";

    public string PrintSubtitle
    {
        get
        {
            if (PrintError.Length > 0) return PrintError;
            if (PrintNotice.Length > 0) return PrintNotice;
            var tirage = $"Tirage {PaperLabel}";
            if (!CanPrint) return $"{tirage} : limite atteinte pour cette photo";
            if (_showRemainingPrints && RemainingPrints is { } left)
                return left > 1 ? $"{tirage}, encore {left} tirages possibles" : $"{tirage}, encore 1 tirage possible";
            return $"{tirage}, prêt en quelques secondes";
        }
    }

    partial void OnPaperFormatChanged(string value)
    {
        OnPropertyChanged(nameof(PaperLabel));
        OnPropertyChanged(nameof(PrintSubtitle));
    }

    /// <summary>Sous-titre selon ce que la borne propose (impression, partage numérique, les deux).</summary>
    public string Subtitle => (ShowPrintBlock, ShowShareTiles) switch
    {
        (true, true)  => "Imprimez, envoyez ou récupérez vos photos.",
        (true, false) => "Imprimez votre photo en quelques secondes.",
        (false, true) => "Envoyez ou récupérez vos photos.",
        _             => "Votre photo est bien enregistrée.",
    };

    // ── E-mail ────────────────────────────────────────────────────────────
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendEmailCommand))]
    private string _emailInputText = "";

    /// <summary>Accord de l'invité : toujours décoché à l'ouverture, même avec une adresse pré-remplie.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendEmailCommand))]
    private bool _emailConsent;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SendButtonText))]
    [NotifyCanExecuteChangedFor(nameof(SendEmailCommand))]
    private bool _isEmailSending;

    [ObservableProperty] private string _emailError = "";
    [ObservableProperty] private string _sentToAddress = "";
    [ObservableProperty] private IReadOnlyList<string> _domainSuggestions = [];

    public string SendButtonText => IsEmailSending ? "Envoi…" : "Envoyer";

    public ResultViewModel(
        IPrintService print,
        ISupabaseService supabase,
        INavigationService navigation,
        INetworkMonitorService network,
        AppSettings settings,
        IKioskLogService kioskLog,
        ISessionService sessions,
        IGuestJourneyService journey)
        : this(print, supabase, navigation, network, settings, kioskLog, sessions, journey, () => new DispatcherIdleTimer()) { }

    internal ResultViewModel(
        IPrintService print,
        ISupabaseService supabase,
        INavigationService navigation,
        INetworkMonitorService network,
        AppSettings settings,
        IKioskLogService kioskLog,
        ISessionService sessions,
        IGuestJourneyService journey,
        Func<IIdleTimer> timerFactory)
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
        DomainSuggestions = EmailDomainSuggestions.Suggest("", DomainSuggestionCount);
    }

    internal const int DomainSuggestionCount = 4;

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
        GalleryLink = BuildGalleryLink(_settings.Kiosk.SaasUrl, p.AccessCode);

        CompositeImage = await Task.Run(() => ImageLoader.LoadForScreen(p.CompositePath, fill: false));

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

    // ── Impression ────────────────────────────────────────────────────────

    private async Task RefreshPrintStatusAsync()
    {
        if (_params == null) return;

        var remaining = await _print.GetRemainingPrintsAsync(
            _params.EventId, _params.MaxPrintsPerEvent,
            _params.SessionId, _params.MaxPrintsPerPhoto);

        RemainingPrints = remaining;
        CanPrint        = remaining is null or > 0;
        MaxCopies       = remaining is { } left ? Math.Clamp(left, 1, LimitedMaxCopies) : UnlimitedMaxCopies;
        PrintCopies     = Math.Clamp(PrintCopies, 1, MaxCopies);
        NotifyPrintBlockChanged();
    }

    private bool CanChangeCopies() => CanPrint && !IsPrinting;

    [RelayCommand(CanExecute = nameof(CanIncrementCopies))]
    private void IncrementCopies()
    {
        RegisterActivity();
        if (PrintCopies < MaxCopies) PrintCopies++;
    }

    private bool CanIncrementCopies() => CanChangeCopies() && PrintCopies < MaxCopies;

    [RelayCommand(CanExecute = nameof(CanDecrementCopies))]
    private void DecrementCopies()
    {
        RegisterActivity();
        if (PrintCopies > 1) PrintCopies--;
    }

    private bool CanDecrementCopies() => CanChangeCopies() && PrintCopies > 1;

    [RelayCommand(CanExecute = nameof(CanChangeCopies))]
    private async Task PrintAsync()
    {
        if (_params == null || IsPrinting || !CanPrint) return;
        RegisterActivity();

        var copies = Math.Clamp(PrintCopies, 1, MaxCopies);
        IsPrinting  = true;
        PrintError  = "";
        PrintNotice = "";
        try
        {
            await _print.PrintAsync(
                _params.CompositePath,
                _params.PrinterName,
                _params.PaperFormat,
                _params.SessionId,
                _params.EventId,
                copies,
                _photoPublicUrl);
            PrintNotice = copies > 1 ? "C'est parti ! Vos tirages arrivent." : "C'est parti ! Votre tirage arrive.";
            _ = ClearPrintMessagesAsync();
        }
        catch (Exception ex)
        {
            await _kioskLog.LogErrorAsync("print", ex.Message, ex.StackTrace);
            // Message dans le bloc d'impression : l'invité peut réessayer ou choisir le QR code.
            PrintError = ex switch
            {
                PrintBusyException => "Une impression est encore en cours. Patientez quelques instants.",
                TimeoutException   => "L'imprimante ne répond pas. Vérifiez le papier avant de réessayer.",
                _                  => "Impression indisponible. Réessayez ou utilisez le QR code.",
            };
            _ = ClearPrintMessagesAsync();
        }
        finally
        {
            _hasPrinted = true;
            // Aussi après un délai dépassé : l'impression envoyée est déjà comptée.
            try { await RefreshPrintStatusAsync(); }
            catch (Exception ex) { await _kioskLog.LogErrorAsync("print", ex.Message, ex.StackTrace); }
            IsPrinting = false;
            RegisterActivity();
        }
    }

    private async Task ClearPrintMessagesAsync()
    {
        await Task.Delay(6000);
        PrintError  = "";
        PrintNotice = "";
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

    // ── E-mail ────────────────────────────────────────────────────────────

    // Saisie de l'adresse (clavier tactile ou physique) : l'invité est actif.
    partial void OnEmailInputTextChanged(string value)
    {
        RegisterActivity();
        EmailError = "";
        DomainSuggestions = EmailDomainSuggestions.Suggest(value ?? "", DomainSuggestionCount);
    }

    partial void OnEmailConsentChanged(bool value) => RegisterActivity();

    /// <summary>Raccourci de domaine : remplace tout ce qui suit « @ » (ou l'ajoute).</summary>
    [RelayCommand]
    private void ApplyEmailDomain(string? domain)
    {
        if (string.IsNullOrWhiteSpace(domain)) return;
        RegisterActivity();
        var text = EmailInputText ?? "";
        var at = text.IndexOf('@');
        var local = at < 0 ? text : text[..at];
        var updated = local + "@" + domain.TrimStart('@');
        if (updated.Length <= EmailMaxLength) EmailInputText = updated;
    }

    internal const int EmailMaxLength = 254;

    internal static bool IsPlausibleEmail(string? email) =>
        !string.IsNullOrWhiteSpace(email) && EmailPattern.IsMatch(email.Trim());

    private bool CanSendEmail() =>
        EmailConsent && IsShareReady && !IsEmailSending && IsPlausibleEmail(EmailInputText);

    [RelayCommand(CanExecute = nameof(CanSendEmail))]
    private async Task SendEmailAsync()
    {
        if (_params == null || _photoPublicUrl == null || !CanSendEmail()) return;

        RegisterActivity();
        var address = EmailInputText.Trim();
        IsEmailSending = true;
        EmailError = "";
        try
        {
            await _supabase.SendKioskPhotoEmailAsync(_params.EventId, address, _photoPublicUrl);
            SentToAddress  = address;
            EmailInputText = "";
            EmailConsent   = false;
            Screen         = ResultScreen.EmailSent;
        }
        catch (Exception ex)
        {
            await _kioskLog.LogErrorAsync("email", ex.Message, ex.StackTrace);
            EmailError = "L'envoi n'a pas abouti. Vérifiez l'adresse et réessayez.";
        }
        finally
        {
            IsEmailSending = false;
            RegisterActivity();
        }
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
        QrCodeImage     = RenderQr(BuildQrUrl(_settings.Kiosk.SaasUrl, _params?.AccessCode, photoId, publicUrl));
        ShareStatus     = "";
        IsShareReady    = true;
    }

    private static BitmapImage RenderQr(string url)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(url, QRCodeGenerator.ECCLevel.M);
        using var code = new PngByteQRCode(data);
        var png = code.GetGraphic(10);

        var bmp = new BitmapImage();
        bmp.BeginInit();
        bmp.StreamSource = new MemoryStream(png);
        bmp.CacheOption  = BitmapCacheOption.OnLoad;
        bmp.EndInit();
        bmp.Freeze();
        return bmp;
    }

    /// <summary>
    /// Lien du QR code : la photo dans la galerie (code d'accès + id de la photo), à défaut la galerie
    /// de l'événement, à défaut l'URL publique du fichier. <c>via=qr</c> fait compter l'ouverture par
    /// QR code côté serveur (get-photos, LAB-209) ; l'URL publique R2 n'est pas une page, rien à compter.
    /// </summary>
    internal static string BuildQrUrl(string saasUrl, string? accessCode, Guid photoId, string publicUrl)
    {
        if (string.IsNullOrEmpty(accessCode) || string.IsNullOrWhiteSpace(saasUrl)) return publicUrl;
        var gallery = $"{saasUrl.TrimEnd('/')}/photos/{accessCode}";
        return photoId != Guid.Empty ? $"{gallery}?photo={photoId}&via=qr" : $"{gallery}?via=qr";
    }

    /// <summary>
    /// Lien de la galerie à taper à la main (sans lecteur QR) : sans « https:// » ni paramètres.
    /// Vide sans code d'accès ni adresse du SaaS (le QR mène alors au fichier seul, trop long à recopier).
    /// </summary>
    internal static string BuildGalleryLink(string saasUrl, string? accessCode)
    {
        if (string.IsNullOrEmpty(accessCode) || string.IsNullOrWhiteSpace(saasUrl)) return "";
        var host = saasUrl.TrimEnd('/');
        var scheme = host.IndexOf("://", StringComparison.Ordinal);
        if (scheme >= 0) host = host[(scheme + 3)..];
        return $"{host}/photos/{accessCode}";
    }
}
