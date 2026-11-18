using FluentAssertions;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

public sealed class QuestionnaireViewModelTests
{
    private sealed class FakeTimer : IIdleTimer
    {
        public TimeSpan Interval { get; set; }
        public bool IsEnabled { get; private set; }
        public event EventHandler? Tick;
        public void Start() => IsEnabled = true;
        public void Stop()  => IsEnabled = false;
        public void Fire()  => Tick?.Invoke(this, EventArgs.Empty);
    }

    private static readonly Guid SessionId = Guid.NewGuid();
    private static readonly Guid EventId   = Guid.NewGuid();
    // Début de la séance (avant le décompte) : le commit après le questionnaire doit le garder.
    private static readonly DateTime CapturedAt = new(2026, 11, 4, 21, 10, 5, DateTimeKind.Utc);

    private readonly Mock<INavigationService>     _nav      = new();
    private readonly Mock<ISessionService>        _sessions = new();
    private readonly Mock<IKioskLogService>       _log      = new();
    private readonly Mock<IGuestJourneyService>   _journey  = new();
    private readonly Mock<IGuestResponseService>  _sink     = new();
    private readonly Mock<INetworkMonitorService> _network  = new();
    private readonly FakeTimer _timer = new();
    private readonly CancellationTokenSource _captureCts = new();
    private TaskCompletionSource<CaptureResult> _capture = new();

    public QuestionnaireViewModelTests()
    {
        _network.SetupGet(n => n.IsOnline).Returns(true);
        _sessions.Setup(s => s.CommitPendingSessionAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<DateTime>(),
                     It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Action<AppDbContext>?>()))
                 .ReturnsAsync(@"C:\data\events\Mariage_6f1d2c3b\composites\composite.jpg");
    }

    private static QuestionnaireConfig Config(bool required, params QuestionConfig[] questions) => new()
    {
        Enabled          = true,
        RequiredForPhoto = required,
        Questions        = questions.Length > 0
            ? questions.ToList()
            : [new QuestionConfig { Id = "email", Label = "Votre e-mail", Type = QuestionTypes.Email, Required = true }],
        Controller       = new ControllerConfig { Name = "Camille & Hugo" },
    };

    private static CaptureResult Captured(bool pending) => new(
        SessionId:      SessionId,
        CapturedAtUtc:  CapturedAt,
        EventId:        EventId,
        EventName:      "Mariage",
        CompositePath:  @"C:\data\pending\composite.jpg",
        PhotoPaths:     [@"C:\data\pending\photo.jpg"],
        TemplateFormat: "portrait",
        IsPending:      pending,
        NextParameters: new object());

    private QuestionnaireViewModel Create(QuestionnaireConfig config, bool captureDone = true, PhotoConsent? consent = null)
    {
        if (captureDone) _capture.SetResult(Captured(config.RequiredForPhoto));
        var vm = new QuestionnaireViewModel(_nav.Object, _sessions.Object, _log.Object, _journey.Object,
            _sink.Object, _network.Object, () => _timer);
        vm.ReceiveParameter(new QuestionnaireParameters(_capture.Task, _captureCts, config, SessionId, EventId, "ABC123", consent));
        return vm;
    }

    private async Task TickAsync(QuestionnaireViewModel vm, int seconds)
    {
        for (var i = 0; i < seconds; i++) await vm.TickAsync();
    }

    private void VerifyAbandoned()
    {
        _captureCts.IsCancellationRequested.Should().BeTrue();
        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Once);
        _nav.Verify(n => n.NavigateTo<ResultView>(It.IsAny<object>()), Times.Never);
        _sessions.Verify(s => s.DiscardPendingSession(SessionId), Times.Once);
        _log.Verify(l => l.LogInfoAsync("questionnaire", QuestionnaireViewModel.CancelLogMessage), Times.Once);
        _sessions.Verify(s => s.CommitPendingSessionAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<DateTime>(),
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Action<AppDbContext>?>()), Times.Never);
    }

    private void VerifyShowsPhoto() => _nav.Verify(n => n.NavigateTo<ResultView>(It.IsAny<object>()), Times.Once);

    // ── Saisie ───────────────────────────────────────────────────────

    [Fact]
    public void Next_stays_disabled_until_the_required_answer_is_valid()
    {
        var vm = Create(Config(required: true));
        vm.StartCommand.Execute(null);

        vm.ProgressText.Should().Be("1 sur 1");
        vm.NextCommand.CanExecute(null).Should().BeFalse();

        vm.CurrentQuestion!.Text = "jean@gmail";
        vm.NextCommand.CanExecute(null).Should().BeFalse();
        vm.CurrentQuestion.Error.Should().Be(GuestAnswerValidator.EmailError);

        vm.CurrentQuestion.Text = "jean@gmail.com";
        vm.NextCommand.CanExecute(null).Should().BeTrue();
        vm.NextCommand.Execute(null);
        vm.Step.Should().Be(QuestionnaireStep.Final);
    }

    [Fact]
    public void Phone_answer_is_kept_in_e164()
    {
        var vm = Create(Config(required: true,
            new QuestionConfig { Id = "tel", Label = "Téléphone", Type = QuestionTypes.Tel, Required = true }));
        vm.StartCommand.Execute(null);

        vm.CurrentQuestion!.Text = "06 12 34 56 78";

        vm.BuildSubmission(new QuestionnaireParameters(_capture.Task, _captureCts, Config(true), SessionId, EventId, "ABC123"))
          .Answers["tel"].Should().Be("+33612345678");
    }

    [Fact]
    public void Marketing_consent_is_unchecked_by_default()
    {
        var vm = Create(Config(required: true));

        vm.ShowMarketingConsent.Should().BeTrue();
        vm.MarketingConsent.Should().BeFalse();
        vm.MarketingLabel.Should().Contain("Camille & Hugo");
    }

    [Fact]
    public void Back_from_the_first_question_returns_to_the_title()
    {
        var vm = Create(Config(required: true));
        vm.StartCommand.Execute(null);

        vm.BackCommand.Execute(null);

        vm.Step.Should().Be(QuestionnaireStep.Title);
        _nav.Verify(n => n.GoBack(), Times.Never);
    }

    // ── Mode obligatoire ─────────────────────────────────────────────

    [Fact]
    public async Task Required_mode_cancel_asks_for_confirmation_first()
    {
        var vm = Create(Config(required: true));

        await vm.ExitCommand.ExecuteAsync(null);

        vm.ExitLabel.Should().Be("Annuler");
        vm.ShowCancelConfirm.Should().BeTrue();
        _nav.VerifyNoOtherCalls();

        vm.ResumeCommand.Execute(null);
        vm.ShowCancelConfirm.Should().BeFalse();
        _sessions.Verify(s => s.DiscardPendingSession(It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Required_mode_confirmed_cancel_discards_the_photo_and_goes_home()
    {
        var vm = Create(Config(required: true));
        vm.StartCommand.Execute(null);
        vm.CurrentQuestion!.Text = "jean@gmail.com";

        await vm.ExitCommand.ExecuteAsync(null);
        await vm.ConfirmCancelCommand.ExecuteAsync(null);

        VerifyAbandoned();
        vm.Questions.Should().OnlyContain(q => q.Value == null); // rien n'est gardé
        _sink.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Required_mode_submit_commits_the_pending_session_with_the_answer()
    {
        var vm = Create(Config(required: true));
        vm.StartCommand.Execute(null);
        vm.CurrentQuestion!.Text = "Jean@Gmail.com";
        vm.NextCommand.Execute(null);
        Action<AppDbContext>? stage = null;
        _sessions.Setup(s => s.CommitPendingSessionAsync(SessionId, EventId, "Mariage", CapturedAt,
                     @"C:\data\pending\photo.jpg", @"C:\data\pending\composite.jpg", It.IsAny<Action<AppDbContext>?>(), It.IsAny<Guid?>()))
                 .Callback<Guid, Guid, string, DateTime, string, string, Action<AppDbContext>?, Guid?>((_, _, _, _, _, _, s, _) => stage = s)
                 .ReturnsAsync(@"C:\data\events\composite.jpg");

        await vm.SubmitCommand.ExecuteAsync(null);

        stage.Should().NotBeNull();
        stage!(null!);
        _sink.Verify(s => s.Stage(It.IsAny<AppDbContext>(), It.Is<GuestSubmission>(g =>
            g.SessionId == SessionId && (string)g.Answers["email"]! == "jean@gmail.com" && !g.MarketingConsent)), Times.Once);
        _nav.Verify(n => n.NavigateTo<ResultView>(It.IsAny<object>()), Times.Once);
        _sessions.Verify(s => s.UploadSessionAsync(SessionId), Times.Once); // envoi après validation
        _sessions.Verify(s => s.CommitPendingSessionAsync(SessionId, EventId, "Mariage", CapturedAt,
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Action<AppDbContext>?>()), Times.Once); // heure du début de séance, pas du commit
        _sessions.Verify(s => s.DiscardPendingSession(It.IsAny<Guid>()), Times.Never);
        _journey.VerifySet(j => j.PrefillEmail = "jean@gmail.com");
    }

    [Fact]
    public async Task Required_mode_submit_writes_the_photo_consent_with_the_session()
    {
        var consent = new PhotoConsent("J'accepte que ma photo soit prise.", DateTime.UtcNow);
        var vm = Create(Config(required: true), consent: consent);
        vm.StartCommand.Execute(null);
        vm.CurrentQuestion!.Text = "jean@gmail.com";
        vm.NextCommand.Execute(null);
        Action<AppDbContext>? stage = null;
        _sessions.Setup(s => s.CommitPendingSessionAsync(SessionId, EventId, "Mariage", It.IsAny<DateTime>(),
                     It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Action<AppDbContext>?>(), It.IsAny<Guid?>()))
                 .Callback<Guid, Guid, string, DateTime, string, string, Action<AppDbContext>?, Guid?>((_, _, _, _, _, _, s, _) => stage = s)
                 .ReturnsAsync(@"C:\data\events\composite.jpg");

        await vm.SubmitCommand.ExecuteAsync(null);

        using var db = new PolaKiosk.Tests.Services.TestDb();
        using var ctx = db.NewContext();
        stage!(ctx);
        _sink.Verify(s => s.Stage(ctx, It.IsAny<GuestSubmission>()), Times.Once);
        var row = ctx.ChangeTracker.Entries<PhotoConsentEntity>().Should().ContainSingle().Subject.Entity;
        row.SessionId.Should().Be(SessionId);
        row.EventId.Should().Be(EventId);
        row.AccessCode.Should().Be("ABC123");
        row.ConsentText.Should().Be(consent.Text);
    }

    [Fact]
    public async Task Required_mode_cancel_writes_no_photo_consent()
    {
        var vm = Create(Config(required: true), consent: new PhotoConsent("J'accepte.", DateTime.UtcNow));
        vm.StartCommand.Execute(null);

        await vm.ExitCommand.ExecuteAsync(null);
        await vm.ConfirmCancelCommand.ExecuteAsync(null);

        VerifyAbandoned(); // aucun CommitPendingSessionAsync : ni séance, ni réponse, ni consentement
    }

    [Fact]
    public async Task Submit_waits_for_the_photo_and_shows_it_is_coming()
    {
        var vm = Create(Config(required: true), captureDone: false);
        vm.StartCommand.Execute(null);
        vm.CurrentQuestion!.Text = "jean@gmail.com";

        var submit = vm.SubmitAsync();

        vm.IsWaitingForPhoto.Should().BeTrue();
        _nav.Verify(n => n.NavigateTo<ResultView>(It.IsAny<object>()), Times.Never);
        _capture.SetResult(Captured(pending: true));
        await submit;
        vm.IsWaitingForPhoto.Should().BeFalse();
        VerifyShowsPhoto();
    }

    [Fact]
    public async Task Submit_is_refused_while_a_required_answer_is_missing()
    {
        var vm = Create(Config(required: true));

        await vm.SubmitAsync();

        _nav.VerifyNoOtherCalls();
        _sessions.VerifyNoOtherCalls();
    }

    // ── Mode facultatif ──────────────────────────────────────────────

    [Fact]
    public async Task Optional_mode_skip_shows_the_photo_and_keeps_nothing()
    {
        var vm = Create(Config(required: false));
        vm.StartCommand.Execute(null);
        vm.CurrentQuestion!.Text = "jean@gmail.com";

        await vm.ExitCommand.ExecuteAsync(null);

        vm.ExitLabel.Should().Be("Passer");
        VerifyShowsPhoto();
        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Never);
        vm.Questions.Should().OnlyContain(q => q.Value == null);
        _sink.VerifyNoOtherCalls();
        _sessions.Verify(s => s.DiscardPendingSession(It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Optional_mode_submit_saves_the_answer_alone()
    {
        var vm = Create(Config(required: false));
        vm.StartCommand.Execute(null);
        vm.CurrentQuestion!.Text = "jean@gmail.com";
        vm.NextCommand.Execute(null);
        vm.ToggleMarketingCommand.Execute(null);

        await vm.SubmitCommand.ExecuteAsync(null);

        _sink.Verify(s => s.SaveAsync(It.Is<GuestSubmission>(g => g.MarketingConsent && g.MarketingConsentText != null)), Times.Once);
        _sessions.Verify(s => s.CommitPendingSessionAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<DateTime>(),
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Action<AppDbContext>?>()), Times.Never);
        VerifyShowsPhoto();
    }

    // ── Inactivité (horloge injectée) ────────────────────────────────

    [Fact]
    public async Task Idle_90_seconds_shows_the_warning()
    {
        var vm = Create(Config(required: true));

        await TickAsync(vm, QuestionnaireViewModel.IdleSeconds - 1);
        vm.ShowIdleWarning.Should().BeFalse();

        _timer.Fire();
        vm.ShowIdleWarning.Should().BeTrue();
        vm.IdleCountdown.Should().Be(QuestionnaireViewModel.WarningSeconds);
    }

    [Fact]
    public async Task Required_mode_warning_runs_out_into_an_abandon()
    {
        var vm = Create(Config(required: true));

        await TickAsync(vm, QuestionnaireViewModel.IdleSeconds + QuestionnaireViewModel.WarningSeconds);

        VerifyAbandoned();
        _timer.IsEnabled.Should().BeFalse();
    }

    [Fact]
    public async Task Optional_mode_warning_runs_out_into_the_photo()
    {
        var vm = Create(Config(required: false));

        await TickAsync(vm, QuestionnaireViewModel.IdleSeconds + QuestionnaireViewModel.WarningSeconds);

        VerifyShowsPhoto();
        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Never);
        _sessions.Verify(s => s.DiscardPendingSession(It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Continue_or_any_touch_resets_the_idle_timer()
    {
        var vm = Create(Config(required: true));
        await TickAsync(vm, QuestionnaireViewModel.IdleSeconds);

        vm.ContinueCommand.Execute(null);
        vm.ShowIdleWarning.Should().BeFalse();

        await TickAsync(vm, QuestionnaireViewModel.IdleSeconds - 1);
        vm.RegisterActivity();
        await TickAsync(vm, QuestionnaireViewModel.IdleSeconds - 1);

        vm.ShowIdleWarning.Should().BeFalse();
        _nav.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Fifteen_seconds_without_touch_on_the_confirmation_count_as_cancel()
    {
        var vm = Create(Config(required: true));
        await vm.ExitCommand.ExecuteAsync(null);

        await TickAsync(vm, QuestionnaireViewModel.ConfirmIdleSeconds - 1);
        _nav.VerifyNoOtherCalls();

        await TickAsync(vm, 1);
        VerifyAbandoned();
    }

    [Fact]
    public async Task Leaving_the_screen_unfinished_discards_the_pending_photo()
    {
        var vm = Create(Config(required: true));

        vm.Release();
        await _capture.Task;

        _captureCts.IsCancellationRequested.Should().BeTrue();
        _timer.IsEnabled.Should().BeFalse();
        _sessions.Verify(s => s.DiscardPendingSession(SessionId), Times.Once);
    }
}
