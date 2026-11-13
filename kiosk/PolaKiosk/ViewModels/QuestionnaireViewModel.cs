using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

public enum QuestionnaireStep { Title, Question, Final }

/// <summary>
/// Questionnaire de la borne, après la prise de vue (spec LAB-208, KIOSK-2). Le montage se
/// prépare en arrière-plan (<see cref="QuestionnaireParameters.Capture"/>) pendant que l'invité
/// répond. Deux modes :
/// <list type="bullet">
/// <item>obligatoire : « Annuler » (avec confirmation) supprime la photo en attente et ramène à
/// l'accueil ; « Valider » enregistre la séance et range la photo ;</item>
/// <item>facultatif : « Passer » et l'inactivité mènent à la photo, jamais à l'accueil.</item>
/// </list>
/// Réponses validées : enregistrées (chiffrées) par <see cref="IGuestResponseService"/>, abandonnées sinon.
/// Minuterie propre à l'écran (90 s + avertissement de 15 s) : l'écran n'est pas dans
/// <c>IdleTimeoutService.SessionScreens</c>.
/// </summary>
public partial class QuestionnaireViewModel : ObservableObject, IParameterReceiver, IReleasable
{
    internal const int IdleSeconds         = 90;
    internal const int WarningSeconds      = 15;
    internal const int ConfirmIdleSeconds  = 15;

    public const string CancelConfirmText  = "Sans réponse, votre photo ne sera ni imprimée ni partagée. Annuler quand même ?";
    public const string IdleRequiredText   = "Sans réponse, votre photo sera supprimée.";
    public const string MarketingHint      = "Facultatif : vous recevez votre photo dans tous les cas.";
    internal const string CancelLogMessage = "parcours annulé sans réponse";

    private readonly INavigationService _navigation;
    private readonly ISessionService _sessions;
    private readonly IKioskLogService _log;
    private readonly IGuestJourneyService _journey;
    private readonly IGuestResponseService _responses;
    private readonly INetworkMonitorService _network;
    private readonly Func<IIdleTimer> _timerFactory;

    private QuestionnaireParameters? _params;
    private IIdleTimer? _timer;
    private int _idleSeconds;
    private int _confirmSeconds;
    private bool _finished; // validé, passé ou abandonné : plus rien à faire sur cet écran

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsTitleStep), nameof(IsQuestionStep), nameof(IsFinalStep), nameof(ProgressText))]
    private QuestionnaireStep _step = QuestionnaireStep.Title;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ProgressText))]
    [NotifyCanExecuteChangedFor(nameof(NextCommand))]
    private QuestionItemViewModel? _currentQuestion;

    [ObservableProperty] private string _title = "";
    [ObservableProperty] private string _intro = "";
    [ObservableProperty] private string _exitLabel = "Annuler";
    [ObservableProperty] private bool _isRequiredMode = true;
    [ObservableProperty] private string _notice = "";
    [ObservableProperty] private string _fullNotice = "";
    [ObservableProperty] private bool _showMarketingConsent;
    [ObservableProperty] private string _marketingLabel = "";
    [ObservableProperty] private bool _marketingConsent; // toujours décochée au départ

    [ObservableProperty] private bool _showCancelConfirm;
    [ObservableProperty] private bool _showIdleWarning;
    [ObservableProperty] private int _idleCountdown = WarningSeconds;
    [ObservableProperty] private bool _showFullNotice;
    [ObservableProperty] private bool _isWaitingForPhoto;

    public ObservableCollection<QuestionItemViewModel> Questions { get; } = new();

    public bool IsTitleStep    => Step == QuestionnaireStep.Title;
    public bool IsQuestionStep => Step == QuestionnaireStep.Question;
    public bool IsFinalStep    => Step == QuestionnaireStep.Final;

    public string ProgressText => Step == QuestionnaireStep.Question && CurrentQuestion != null
        ? $"{Questions.IndexOf(CurrentQuestion) + 1} sur {Questions.Count}"
        : "";

    public QuestionnaireViewModel(INavigationService navigation, ISessionService sessions, IKioskLogService log,
        IGuestJourneyService journey, IGuestResponseService responses, INetworkMonitorService network)
        : this(navigation, sessions, log, journey, responses, network, () => new DispatcherIdleTimer()) { }

    internal QuestionnaireViewModel(INavigationService navigation, ISessionService sessions, IKioskLogService log,
        IGuestJourneyService journey, IGuestResponseService responses, INetworkMonitorService network,
        Func<IIdleTimer> timerFactory)
    {
        _navigation   = navigation;
        _sessions     = sessions;
        _log          = log;
        _journey      = journey;
        _responses    = responses;
        _network      = network;
        _timerFactory = timerFactory;
    }

    public void ReceiveParameter(object parameter)
    {
        if (parameter is not QuestionnaireParameters p) return;
        _params = p;

        var cfg = p.Config;
        string Resolve(string? text) => cfg.ResolvePlaceholders(text, p.Provider);
        IsRequiredMode = cfg.RequiredForPhoto;
        Title     = NonEmpty(Resolve(cfg.Title), "Restons en contact");
        Intro     = Resolve(cfg.Intro);
        ExitLabel = IsRequiredMode ? NonEmpty(cfg.CancelLabel, "Annuler") : NonEmpty(cfg.SkipLabel, "Passer");
        Notice    = NonEmpty(Resolve(cfg.Notice), Resolve(QuestionnaireConfig.DefaultNotice));
        FullNotice = Resolve(QuestionnaireTexts.FullNoticeTemplate);
        ShowMarketingConsent = cfg.MarketingConsent?.Enabled == true;
        MarketingLabel = NonEmpty(Resolve(cfg.MarketingConsent?.Label),
                                  Resolve(QuestionnaireConfig.DefaultMarketingLabel));
        MarketingConsent = false;

        Questions.Clear();
        foreach (var question in cfg.UsableQuestions())
        {
            var item = new QuestionItemViewModel(question);
            item.AnswerChanged += (_, _) => NextCommand.NotifyCanExecuteChanged();
            Questions.Add(item);
        }

        Step = QuestionnaireStep.Title;
        CurrentQuestion = null;
        StartTimer();
    }

    // ── Navigation dans le questionnaire ─────────────────────────────

    [RelayCommand]
    private void Start()
    {
        if (Questions.Count == 0) { Step = QuestionnaireStep.Final; return; }
        CurrentQuestion = Questions[0];
        Step = QuestionnaireStep.Question;
    }

    private bool CanGoNext() => CurrentQuestion?.CanContinue == true;

    [RelayCommand(CanExecute = nameof(CanGoNext))]
    private void Next()
    {
        if (CurrentQuestion == null || !CurrentQuestion.CanContinue) return;
        var index = Questions.IndexOf(CurrentQuestion);
        if (index + 1 < Questions.Count)
            CurrentQuestion = Questions[index + 1];
        else
            Step = QuestionnaireStep.Final;
    }

    /// <summary>« Retour » : question précédente, écran titre depuis la première (jamais LiveView).</summary>
    [RelayCommand]
    private void Back()
    {
        if (Step == QuestionnaireStep.Final)
        {
            if (Questions.Count == 0) { Step = QuestionnaireStep.Title; return; }
            CurrentQuestion = Questions[^1];
            Step = QuestionnaireStep.Question;
            return;
        }
        var index = CurrentQuestion == null ? -1 : Questions.IndexOf(CurrentQuestion);
        if (index > 0)
            CurrentQuestion = Questions[index - 1];
        else
        {
            Step = QuestionnaireStep.Title;
            CurrentQuestion = null;
        }
    }

    [RelayCommand] private void ShowNotice()  => ShowFullNotice = true;
    [RelayCommand] private void CloseNotice() => ShowFullNotice = false;
    [RelayCommand] private void ToggleMarketing() => MarketingConsent = !MarketingConsent;

    // ── Sortie sans réponse ──────────────────────────────────────────

    /// <summary>« Annuler » (mode obligatoire : confirmation) ou « Passer » (mode facultatif).</summary>
    [RelayCommand]
    private async Task ExitAsync()
    {
        if (_finished) return;
        if (IsRequiredMode)
        {
            ShowIdleWarning   = false;
            ShowCancelConfirm = true;
            _confirmSeconds   = 0;
            return;
        }
        await SkipAsync();
    }

    /// <summary>« Revenir aux questions » : écran quitté, réponses conservées, minuterie relancée.</summary>
    [RelayCommand]
    private void Resume()
    {
        ShowCancelConfirm = false;
        RegisterActivity();
    }

    [RelayCommand]
    private Task ConfirmCancelAsync() => AbandonAsync();

    /// <summary>« Continuer » de l'avertissement d'inactivité.</summary>
    [RelayCommand]
    private void Continue()
    {
        ShowIdleWarning = false;
        RegisterActivity();
    }

    /// <summary>Tout appui sur l'écran (touche, tuile, bouton) relance la minuterie.</summary>
    public void RegisterActivity()
    {
        _idleSeconds    = 0;
        _confirmSeconds = 0;
        if (ShowIdleWarning)
        {
            ShowIdleWarning = false;
            IdleCountdown   = WarningSeconds;
        }
    }

    /// <summary>
    /// Mode facultatif : réponses effacées, rien de stocké, on va à la photo (effet ou résultat).
    /// </summary>
    internal async Task SkipAsync()
    {
        if (_finished || _params == null) return;
        _finished = true;
        StopTimer();
        ClearAnswers();

        var result = await WaitForCaptureAsync();
        if (result == null) { _navigation.NavigateTo<Views.HomeView>(); return; }
        result.NavigateNext(_navigation);
    }

    /// <summary>
    /// Abandon du parcours (mode obligatoire) : montage arrêté, dossier d'attente supprimé, rien
    /// de stocké, retour à l'accueil. Journal sans aucune donnée personnelle.
    /// </summary>
    internal async Task AbandonAsync()
    {
        if (_finished || _params == null) return;
        _finished = true;
        StopTimer();
        ClearAnswers();
        ShowCancelConfirm = false;
        ShowIdleWarning   = false;

        _params.CaptureCancellation.Cancel();
        _navigation.NavigateTo<Views.HomeView>();
        await DiscardAsync(_params);
    }

    private async Task DiscardAsync(QuestionnaireParameters p)
    {
        // Le montage peut encore écrire dans le dossier d'attente : on attend sa fin avant de supprimer.
        try { await p.Capture; } catch { }
        if (p.RequiredForPhoto) _sessions.DiscardPendingSession(p.SessionId);
        try { await _log.LogInfoAsync("questionnaire", CancelLogMessage); } catch { }
    }

    // ── Validation ───────────────────────────────────────────────────

    /// <summary>« Valider et voir ma photo » : actif même si la case de prospection reste décochée.</summary>
    [RelayCommand]
    internal async Task SubmitAsync()
    {
        if (_finished || _params == null) return;
        if (Questions.Any(q => !q.CanContinue)) return; // garde-fou : jamais de réponse incomplète
        _finished = true;
        StopTimer();

        var p = _params;
        var submission = BuildSubmission(p);
        if (p.Config.PrefillShareEmail)
            _journey.PrefillEmail = Questions.FirstOrDefault(q => q.Config.Type == QuestionTypes.Email)?.Value as string;

        var result = await WaitForCaptureAsync();
        if (result == null) { _navigation.NavigateTo<Views.HomeView>(); return; }

        if (result.IsPending)
        {
            // Une transaction : séance + réponse + consentement photo, puis la photo quitte le
            // dossier d'attente. Sur un abandon, rien de tout cela n'est écrit.
            var stageConsent = LiveViewModel.StagePhotoConsent(p.PhotoConsent, result.SessionId, result.EventId, p.AccessCode);
            var displayed = await _sessions.CommitPendingSessionAsync(
                result.SessionId, result.EventId, result.EventName, result.CapturedAtUtc,
                result.PhotoPaths[0], result.CompositePath,
                db =>
                {
                    _responses.Stage(db, submission);
                    stageConsent?.Invoke(db);
                });
            result = result.WithCompositePath(displayed);

            // Envoi anticipé seulement après la validation, et sans choix d'effet.
            if (!result.ChoosesEffect && _network.IsOnline)
                _ = LiveViewModel.UploadEarlyAsync(_sessions, _log, result.SessionId);
        }
        else
        {
            // Mode facultatif : séance déjà enregistrée pendant le questionnaire.
            try { await _responses.SaveAsync(submission); }
            catch (Exception ex)
            {
                try { await _log.LogErrorAsync("questionnaire", $"Réponse non enregistrée : {ex.GetType().Name}"); } catch { }
            }
        }

        ClearAnswers();
        result.NavigateNext(_navigation);
    }

    internal GuestSubmission BuildSubmission(QuestionnaireParameters p)
    {
        var answers = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var q in Questions) answers[q.Config.Id] = q.Value;
        return new GuestSubmission(
            EventId:              p.EventId,
            SessionId:            p.SessionId,
            AnsweredAt:           DateTime.UtcNow,
            Questions:            Questions.Select(q => q.Config).ToList(),
            Answers:              answers,
            MarketingConsent:     ShowMarketingConsent && MarketingConsent,
            MarketingConsentText: ShowMarketingConsent ? MarketingLabel : null,
            Notice:               Notice,
            AccessCode:           p.AccessCode);
    }

    // Attend le montage ; « Votre photo arrive… » seulement s'il n'est pas fini.
    private async Task<CaptureResult?> WaitForCaptureAsync()
    {
        var capture = _params!.Capture;
        if (!capture.IsCompleted) IsWaitingForPhoto = true;
        try { return await capture; }
        catch (Exception ex)
        {
            // Ne devrait pas arriver (la tâche ne lève pas) : on n'affiche jamais une photo inconnue.
            try { await _log.LogErrorAsync("questionnaire", $"Montage indisponible : {ex.Message}", ex.ToString()); } catch { }
            return null;
        }
        finally { IsWaitingForPhoto = false; }
    }

    private void ClearAnswers()
    {
        foreach (var q in Questions) q.Clear();
        MarketingConsent = false;
    }

    // ── Minuterie d'inactivité (1 tic par seconde) ───────────────────

    private void StartTimer()
    {
        StopTimer();
        _idleSeconds = 0;
        _confirmSeconds = 0;
        _timer = _timerFactory();
        _timer.Interval = TimeSpan.FromSeconds(1);
        _timer.Tick += OnTick;
        _timer.Start();
    }

    private void StopTimer()
    {
        if (_timer == null) return;
        _timer.Tick -= OnTick;
        _timer.Stop();
        _timer = null;
    }

    private async void OnTick(object? sender, EventArgs e)
    {
        try { await TickAsync(); }
        catch { /* la minuterie ne doit jamais faire tomber l'app */ }
    }

    internal async Task TickAsync()
    {
        if (_finished) return;

        if (ShowCancelConfirm)
        {
            // L'invité est parti pendant la confirmation : vaut « Annuler ».
            if (++_confirmSeconds >= ConfirmIdleSeconds) await AbandonAsync();
            return;
        }

        if (ShowIdleWarning)
        {
            IdleCountdown--;
            if (IdleCountdown > 0) return;
            ShowIdleWarning = false;
            if (IsRequiredMode) await AbandonAsync();
            else await SkipAsync();
            return;
        }

        if (++_idleSeconds >= IdleSeconds)
        {
            ShowFullNotice  = false;
            IdleCountdown   = WarningSeconds;
            ShowIdleWarning = true;
        }
    }

    /// <summary>
    /// Écran quitté sans validation ni sortie (navigation imposée) : en mode obligatoire, la photo
    /// en attente est supprimée comme pour une annulation.
    /// </summary>
    public void Release()
    {
        StopTimer();
        if (_finished || _params == null) return;
        _finished = true;
        ClearAnswers();
        _params.CaptureCancellation.Cancel();
        _ = DiscardAsync(_params);
    }

    private static string NonEmpty(string? value, string fallback)
        => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
}

/// <summary>Textes fixes du questionnaire (MVP), avec les marqueurs de la config.</summary>
public static class QuestionnaireTexts
{
    /// <summary>
    /// Texte complet « En savoir plus » (RGPD art. 13). À faire valider juridiquement (spec LAB-208,
    /// points légaux n° 9).
    /// </summary>
    public const string FullNoticeTemplate =
        "Responsable du traitement\n" +
        "{controller_name} collecte vos réponses. {Provider_name}, qui fournit la borne photo, les traite pour son compte et ne les réutilise jamais.\n\n" +
        "Finalité\n" +
        "Garder le contact avec les invités de l'événement. Vous serez recontacté(e) à des fins commerciales seulement si vous cochez la case prévue.\n\n" +
        "Base légale\n" +
        "Prospection : votre consentement, facultatif et retirable à tout moment. Autres réponses : l'intérêt légitime de {controller_name}.\n\n" +
        "Durée de conservation\n" +
        "{Provider_name} conserve vos réponses 1 mois après l'événement, puis les supprime. Le fichier transmis à {controller_name} relève ensuite de sa propre politique de conservation.\n\n" +
        "Destinataires\n" +
        "{controller_name}, et {provider_name} (prestataire technique de la borne).\n\n" +
        "Vos droits\n" +
        "Vous pouvez demander l'accès à vos réponses, leur rectification ou leur effacement, et vous opposer à leur utilisation.\n\n" +
        "Contact\n" +
        "{controller_contact}\n\n" +
        "Réclamation\n" +
        "Vous pouvez adresser une réclamation à la CNIL (www.cnil.fr).";
}
