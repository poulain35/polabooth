using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using FluentAssertions;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

public sealed class LiveViewModelTests : IDisposable
{
    private readonly Guid _eventId = Guid.NewGuid();
    private readonly string _dataDir = Path.Combine(Path.GetTempPath(), "polakiosk-tests-" + Guid.NewGuid().ToString("N"));
    private readonly Mock<ICameraService>      _camera    = new();
    private readonly Mock<INavigationService>  _nav       = new();
    private readonly Mock<ICompositeService>   _composite = new();
    private readonly Mock<ISyncService>        _sync      = new();
    private readonly Mock<IKioskStateService>  _state     = new();
    private readonly Mock<IKioskLogService>    _log       = new();
    private readonly Mock<ISessionService>     _sessions  = new();
    private readonly Mock<INetworkMonitorService> _network = new();
    private readonly GuestJourneyService       _journey   = new(new Mock<INavigationService>().Object);
    private readonly LiveViewModel _vm;

    public LiveViewModelTests()
    {
        _state.SetupGet(s => s.ActiveEventId).Returns(_eventId);
        _sync.Setup(s => s.GetCurrentEventAsync(_eventId)).ReturnsAsync(new EventEntity
        {
            Id = _eventId,
            Name = "Test",
            // Pas de compte à rebours : la capture part immédiatement.
            FormConfigJson = """{"kiosk":{"capture":{"countdown_seconds":0}}}""",
        });
        _sync.Setup(s => s.GetTemplatesAsync(_eventId)).ReturnsAsync(new List<TemplateEntity>());
        _composite.Setup(c => c.CreateFromSinglePhotoAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>()))
                  .ReturnsAsync("composite.jpg");

        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dataDir;
        _vm = new LiveViewModel(_camera.Object, _nav.Object, settings, _composite.Object,
            _sync.Object, _state.Object, _log.Object, new SessionPathService(settings), _sessions.Object,
            _network.Object, _journey);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dataDir, recursive: true); } catch { }
    }

    private void VerifyNoResultNavigation()
    {
        _nav.Verify(n => n.NavigateTo<ResultView>(It.IsAny<object>()), Times.Never);
        _nav.Verify(n => n.NavigateTo<EffectSelectView>(It.IsAny<object>()), Times.Never);
    }

    [Fact]
    public async Task Completed_capture_navigates_to_result()
    {
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ReturnsAsync("photo.jpg");

        await _vm.StartAsync();

        _nav.Verify(n => n.NavigateTo<ResultView>(It.IsAny<object>()), Times.Once);
    }

    [Fact]
    public async Task Leaving_during_capture_skips_compositing_and_result()
    {
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).Returns(async () =>
        {
            await _vm.StopAsync(); // écran quitté pendant le déclenchement
            return "photo.jpg";
        });

        await _vm.StartAsync();

        VerifyNoResultNavigation();
        _composite.Verify(c => c.CreateFromSinglePhotoAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Leaving_during_compositing_skips_result()
    {
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ReturnsAsync("photo.jpg");
        _composite.Setup(c => c.CreateFromSinglePhotoAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>()))
                  .Returns(async () =>
                  {
                      await _vm.StopAsync(); // retour accueil par inactivité pendant le montage
                      return "composite.jpg";
                  });

        await _vm.StartAsync();

        VerifyNoResultNavigation();
    }

    // ── Questionnaire après la prise de vue (LAB-222) ────────────────

    private void UseQuestionnaire(bool required, string effects = "")
    {
        var mode = required ? "true" : "false";
        _sync.Setup(s => s.GetCurrentEventAsync(_eventId)).ReturnsAsync(new EventEntity
        {
            Id = _eventId,
            Name = "Test",
            FormConfigJson = """{"kiosk":{"capture":{"countdown_seconds":0}""" + effects
                + """,  "questionnaire":{"enabled":true,"required_for_photo":""" + mode
                + """,  "questions":[{"id":"email","label":"E-mail","type":"email","required":true}]}}}""",
        });
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ReturnsAsync("photo.jpg");
        _network.SetupGet(n => n.IsOnline).Returns(true);
    }

    private QuestionnaireParameters? _questionnaire;

    private void CaptureQuestionnaireNavigation()
        => _nav.Setup(n => n.NavigateTo<QuestionnaireView>(It.IsAny<object>()))
               .Callback<object>(p => _questionnaire = (QuestionnaireParameters)p);

    [Fact]
    public async Task Required_questionnaire_keeps_the_photo_pending()
    {
        UseQuestionnaire(required: true);
        CaptureQuestionnaireNavigation();

        await _vm.StartAsync();

        _questionnaire.Should().NotBeNull();
        var result = await _questionnaire!.Capture;
        var paths = new SessionPathService(new AppSettings { Kiosk = { DataDirectory = _dataDir } });
        _camera.Verify(c => c.CaptureAsync(paths.GetPendingOriginalsDirectory(_questionnaire.SessionId)), Times.Once);
        _composite.Verify(c => c.CreateFromSinglePhotoAsync("photo.jpg",
            paths.GetPendingCompositesDirectory(_questionnaire.SessionId), It.IsAny<int>(), It.IsAny<int>()), Times.Once);
        result.IsPending.Should().BeTrue();
        result.SessionId.Should().Be(_questionnaire.SessionId);
        _sessions.Verify(s => s.RecordSessionAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<DateTime>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        _sessions.Verify(s => s.UploadSessionAsync(It.IsAny<Guid>()), Times.Never);
        VerifyNoResultNavigation();
        _journey.QuestionnaireHandled.Should().BeTrue();
    }

    [Fact]
    public async Task Optional_questionnaire_records_and_uploads_early_without_effect_choice()
    {
        UseQuestionnaire(required: false);
        CaptureQuestionnaireNavigation();

        await _vm.StartAsync();
        var result = await _questionnaire!.Capture;

        result.IsPending.Should().BeFalse();
        _sessions.Verify(s => s.RecordSessionAsync(result.SessionId, _eventId, It.IsAny<DateTime>(), "photo.jpg", "composite.jpg"), Times.Once);
        _sessions.Verify(s => s.UploadSessionAsync(result.SessionId), Times.Once);
        VerifyNoResultNavigation();
    }

    [Fact]
    public async Task Optional_questionnaire_with_effect_choice_does_not_upload_early()
    {
        UseQuestionnaire(required: false,
            effects: """, "effects":{"enabled_effects":["none","bw"],"user_can_choose":true}""");
        CaptureQuestionnaireNavigation();

        await _vm.StartAsync();
        var result = await _questionnaire!.Capture;

        result.ChoosesEffect.Should().BeTrue();
        _sessions.Verify(s => s.UploadSessionAsync(It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Retake_does_not_ask_the_questionnaire_again()
    {
        UseQuestionnaire(required: true);
        _journey.QuestionnaireHandled = true; // déjà posé dans ce parcours (« Reprendre »)

        await _vm.StartAsync();

        _nav.Verify(n => n.NavigateTo<QuestionnaireView>(It.IsAny<object>()), Times.Never);
        _nav.Verify(n => n.NavigateTo<ResultView>(It.IsAny<object>()), Times.Once);
        _sessions.Verify(s => s.RecordSessionAsync(It.IsAny<Guid>(), _eventId, It.IsAny<DateTime>(), "photo.jpg", "composite.jpg"), Times.Once);
    }

    [Fact]
    public async Task Leaving_during_capture_in_required_mode_discards_the_pending_photos()
    {
        UseQuestionnaire(required: true);
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).Returns(async () =>
        {
            await _vm.StopAsync(); // écran quitté pendant le déclenchement
            return "photo.jpg";
        });

        await _vm.StartAsync();

        _sessions.Verify(s => s.DiscardPendingSession(It.IsAny<Guid>()), Times.Once);
        _nav.Verify(n => n.NavigateTo<QuestionnaireView>(It.IsAny<object>()), Times.Never);
    }

    // ── Consentement photo (LAB-223) ─────────────────────────────────

    private static readonly PhotoConsent Consent = new("J'accepte que ma photo soit prise.", new DateTime(2026, 11, 4, 18, 30, 5, DateTimeKind.Utc));

    [Fact]
    public async Task Accepted_consent_is_written_with_the_session()
    {
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ReturnsAsync("photo.jpg");
        _state.SetupGet(s => s.LastAccessCode).Returns("TUQNA5");
        _journey.PhotoConsent = Consent;
        Guid sessionId = default;
        Action<AppDbContext>? stage = null;
        _sessions.Setup(s => s.RecordSessionAsync(It.IsAny<Guid>(), _eventId, It.IsAny<DateTime>(), "photo.jpg", "composite.jpg", It.IsAny<Action<AppDbContext>?>()))
                 .Callback<Guid, Guid, DateTime, string, string, Action<AppDbContext>?>((id, _, _, _, _, a) => (sessionId, stage) = (id, a))
                 .ReturnsAsync(() => sessionId);

        await _vm.StartAsync();

        stage.Should().NotBeNull();
        using var db = new PolaKiosk.Tests.Services.TestDb();
        using var ctx = db.NewContext();
        stage!(ctx);
        var row = ctx.ChangeTracker.Entries<PhotoConsentEntity>().Should().ContainSingle().Subject.Entity;
        row.SessionId.Should().Be(sessionId);
        row.EventId.Should().Be(_eventId);
        row.AccessCode.Should().Be("TUQNA5");
        row.ConsentText.Should().Be(Consent.Text);
        row.ConsentedAt.Should().Be(Consent.ConsentedAtUtc);
    }

    [Fact]
    public async Task Without_consent_the_session_is_written_alone()
    {
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ReturnsAsync("photo.jpg");

        await _vm.StartAsync();

        _sessions.Verify(s => s.RecordSessionAsync(It.IsAny<Guid>(), _eventId, It.IsAny<DateTime>(), "photo.jpg", "composite.jpg", null), Times.Once);
    }

    [Fact]
    public async Task Required_questionnaire_carries_the_consent_until_validation()
    {
        UseQuestionnaire(required: true);
        CaptureQuestionnaireNavigation();
        _journey.PhotoConsent = Consent;

        await _vm.StartAsync();
        await _questionnaire!.Capture;

        _questionnaire.PhotoConsent.Should().BeSameAs(Consent);
        _sessions.Verify(s => s.RecordSessionAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<DateTime>(), It.IsAny<string>(), It.IsAny<string>(),
            It.IsAny<Action<AppDbContext>?>()), Times.Never);
    }

    [Fact]
    public async Task Optional_questionnaire_writes_the_consent_with_the_session()
    {
        UseQuestionnaire(required: false);
        CaptureQuestionnaireNavigation();
        _journey.PhotoConsent = Consent;

        await _vm.StartAsync();
        var result = await _questionnaire!.Capture;

        _sessions.Verify(s => s.RecordSessionAsync(result.SessionId, _eventId, It.IsAny<DateTime>(), "photo.jpg", "composite.jpg",
            It.IsNotNull<Action<AppDbContext>?>()), Times.Once);
    }

    // LAB-231 : l'heure de séance est prise au lancement (avant le décompte et le questionnaire),
    // puis envoyée telle quelle (p_captured_at), même si l'envoi part bien plus tard.
    private static readonly DateTime SessionStart = new(2026, 11, 4, 21, 10, 5, 123, DateTimeKind.Utc);

    [Fact]
    public async Task Session_is_recorded_with_the_time_it_started()
    {
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ReturnsAsync("photo.jpg");
        _vm.UtcNow = () => SessionStart;

        await _vm.StartAsync();

        _sessions.Verify(s => s.RecordSessionAsync(It.IsAny<Guid>(), _eventId, SessionStart, "photo.jpg", "composite.jpg",
            It.IsAny<Action<AppDbContext>?>()), Times.Once);
    }

    [Fact]
    public async Task Required_questionnaire_carries_the_session_start_time()
    {
        UseQuestionnaire(required: true);
        CaptureQuestionnaireNavigation();
        _vm.UtcNow = () => SessionStart;

        await _vm.StartAsync();
        var result = await _questionnaire!.Capture;

        result.CapturedAtUtc.Should().Be(SessionStart); // repris par CommitPendingSessionAsync à la validation
    }
    // ── Écran de prise de vue (LAB-248) ───────────────────────────────

    private readonly List<TimeSpan> _delays = new();

    /// <summary>Attentes immédiates (compte à rebours, flash), notées.</summary>
    private void UseInstantDelays(Func<Task>? onDelay = null)
        => _vm.Delay = async (t, ct) =>
        {
            _delays.Add(t);
            if (onDelay != null) await onDelay();
            ct.ThrowIfCancellationRequested();
        };

    private void UseCountdown(int seconds)
        => _sync.Setup(s => s.GetCurrentEventAsync(_eventId)).ReturnsAsync(new EventEntity
        {
            Id = _eventId,
            Name = "Test",
            FormConfigJson = """{"kiosk":{"capture":{"countdown_seconds":""" + seconds + "}}}",
        });

    private static BitmapSource FakeBitmap()
    {
        var bmp = BitmapSource.Create(2, 2, 96, 96, PixelFormats.Bgra32, null, new byte[16], 8);
        bmp.Freeze();
        return bmp;
    }

    /// <summary>Modèle à trois zones photo (vrai PNG pour l'aperçu du modèle).</summary>
    private void UseThreePhotoTemplate()
    {
        Directory.CreateDirectory(_dataDir);
        var png = Path.Combine(_dataDir, "template.png");
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(FakeBitmap()));
        using (var file = File.Create(png)) encoder.Save(file);

        var template = new TemplateEntity { Id = Guid.NewGuid(), EventId = _eventId, Format = "portrait", ThumbnailPath = png };
        _sync.Setup(s => s.GetTemplatesAsync(_eventId)).ReturnsAsync(new List<TemplateEntity> { template });
        _composite.Setup(c => c.GetPhotoZonesAsync(template.Id, It.IsAny<string>())).ReturnsAsync(new List<PhotoZone>
        {
            new(20, 20, 360, 170), new(20, 210, 360, 170), new(20, 400, 360, 170),
        });
        _composite.Setup(c => c.CreateCompositeAsync(It.IsAny<IReadOnlyList<string>>(), png, It.IsAny<IReadOnlyList<PhotoZone>>(),
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
                  .ReturnsAsync("composite.jpg");
    }

    [Fact]
    public async Task Countdown_shows_3_2_1_then_the_white_flash()
    {
        UseCountdown(3);
        UseInstantDelays();
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ReturnsAsync("photo.jpg");
        var steps = new List<string>();
        _vm.PropertyChanged += (_, e) =>
        {
            switch (e.PropertyName)
            {
                case nameof(LiveViewModel.IsCountingDown): steps.Add($"anneau:{_vm.IsCountingDown}:{_vm.CountdownValue}:{_vm.CountdownTotalSeconds}"); break;
                case nameof(LiveViewModel.CountdownValue) when _vm.IsCountingDown: steps.Add($"chiffre:{_vm.CountdownValue}"); break;
                case nameof(LiveViewModel.IsFlashing): steps.Add($"flash:{_vm.IsFlashing}"); break;
            }
        };

        await _vm.StartAsync();

        // Pas de « Souriez ! » dans l'anneau (LAB-260) : seul le flash le porte. Le blanc passe
        // devant l'anneau avant que celui-ci ne disparaisse.
        steps.Should().Equal(
            "anneau:True:3:3", "chiffre:2", "chiffre:1",
            "flash:True", "anneau:False:1:3", "flash:False");
        _delays.Should().ContainInConsecutiveOrder(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
        // Après le 1, seule reste la durée minimale du flash : plus de pause « Souriez ! ».
        _delays.SkipWhile(d => d != TimeSpan.FromSeconds(1)).Skip(3).Should().OnlyContain(d => d < TimeSpan.FromMilliseconds(750));
        _nav.Verify(n => n.NavigateTo<ResultView>(It.IsAny<object>()), Times.Once);
    }

    [Fact]
    public async Task Without_countdown_there_is_no_ring()
    {
        UseInstantDelays();
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ReturnsAsync("photo.jpg");
        var changed = new List<string?>();
        _vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await _vm.StartAsync();

        changed.Should().NotContain(nameof(LiveViewModel.IsCountingDown));
        changed.Should().Contain(nameof(LiveViewModel.IsFlashing));
    }

    [Fact]
    public async Task A_single_photo_has_one_slot_and_hides_the_indicator()
    {
        UseInstantDelays();
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ReturnsAsync("photo.jpg");

        await _vm.StartAsync();

        _vm.HasMultiplePhotos.Should().BeFalse(); // pastilles et cases masquées
        _vm.PhotoSlots.Should().ContainSingle();
    }

    [Fact]
    public async Task Three_photos_move_the_current_dot_and_fill_the_boxes()
    {
        UseThreePhotoTemplate();
        UseInstantDelays();
        var loaded = new List<string>();
        _vm.LoadSlotPhoto = path => { lock (loaded) loaded.Add(path); return FakeBitmap(); };
        var seen = new List<string>();
        int shot = 0;
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ReturnsAsync(() =>
        {
            seen.Add($"{_vm.CurrentPhotoNumber}/{_vm.TotalPhotoCount} "
                + string.Concat(_vm.PhotoSlots.Select(s => s.IsCurrent ? "C" : s.IsTaken ? "P" : "-")));
            return $"photo{++shot}.jpg";
        });

        await _vm.StartAsync();
        await _vm.WhenSlotPhotosLoaded();

        _vm.HasMultiplePhotos.Should().BeTrue();
        _vm.PhotoSlots.Select(s => s.Number).Should().Equal(1, 2, 3);
        // C : case en cours (rose), P : déjà prise (avec sa photo), - : à venir (pointillés)
        seen.Should().Equal("1/3 C--", "2/3 PC-", "3/3 PPC");
        _vm.PhotoSlots.Should().OnlyContain(s => s.IsTaken && s.Photo != null);
        loaded.Should().BeEquivalentTo("photo1.jpg", "photo2.jpg", "photo3.jpg");
        _nav.Verify(n => n.NavigateTo<ResultView>(It.IsAny<object>()), Times.Once);
    }

    [Fact]
    public async Task Cancel_during_countdown_stops_the_camera_and_goes_home()
    {
        UseCountdown(3);
        UseInstantDelays(async () =>
        {
            if (_vm.CountdownValue == 2) await _vm.CancelCommand.ExecuteAsync(null); // « Annuler » sur le 2
        });

        await _vm.StartAsync();

        _camera.Verify(c => c.StopLiveViewAsync(), Times.AtLeastOnce);
        _camera.Verify(c => c.ShutdownAsync(), Times.Once);
        _camera.Verify(c => c.CaptureAsync(It.IsAny<string>()), Times.Never);
        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Once);
        _nav.Verify(n => n.GoBack(), Times.Never);
        VerifyNoResultNavigation();
        _composite.Verify(c => c.CreateFromSinglePhotoAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Cancel_goes_home_even_if_the_camera_fails_to_stop()
    {
        _camera.Setup(c => c.ShutdownAsync()).ThrowsAsync(new InvalidOperationException("USB"));

        await _vm.CancelCommand.ExecuteAsync(null);

        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Once);
        _log.Verify(l => l.LogWarningAsync("camera", It.IsAny<string>()), Times.Once);
    }

    // ── LAB-263 : appareil photo débranché ────────────────────────────

    private LiveViewModel NewLiveWithHealth(ICameraHealthService health)
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dataDir;
        var vm = new LiveViewModel(_camera.Object, _nav.Object, settings, _composite.Object,
            _sync.Object, _state.Object, _log.Object, new SessionPathService(settings), _sessions.Object,
            _network.Object, _journey, health);
        vm.Delay = (t, ct) => { _delays.Add(t); return Task.CompletedTask; };
        return vm;
    }

    [Fact]
    public async Task Camera_that_cannot_be_opened_after_3_attempts_is_reported_absent_and_home_shows_at_once()
    {
        _camera.Setup(c => c.InitializeAsync()).ThrowsAsync(new InvalidOperationException("Aucun appareil Canon détecté"));
        var health = new Mock<ICameraHealthService>();
        var vm = NewLiveWithHealth(health.Object);

        await vm.StartAsync();

        _camera.Verify(c => c.InitializeAsync(), Times.Exactly(3));
        health.Verify(h => h.ReportAbsent(), Times.Once);
        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Once);
        vm.HasError.Should().BeFalse("l'accueil affiche « Problème technique », pas d'écran d'erreur ici");
        _delays.Should().NotContain(TimeSpan.FromSeconds(6));
        // L'erreur des journaux est écrite par l'état partagé, une fois par passage à absent.
        _log.Verify(l => l.LogErrorAsync("camera", It.IsAny<string>(), It.IsAny<string?>()), Times.Never);
    }

    [Fact]
    public async Task Failure_after_opening_goes_home_when_the_camera_is_gone()
    {
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ThrowsAsync(new InvalidOperationException("EDS_ERR_DEVICE_NOT_FOUND"));
        var health = new Mock<ICameraHealthService>();
        health.Setup(h => h.CheckNowAsync(It.IsAny<CancellationToken>())).ReturnsAsync(CameraHealth.Absent);
        var vm = NewLiveWithHealth(health.Object);

        await vm.StartAsync();

        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Once);
        vm.HasError.Should().BeFalse();
        health.Verify(h => h.ReportAbsent(), Times.Never);
    }

    [Fact]
    public async Task Failure_with_the_camera_still_there_keeps_the_error_message()
    {
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ThrowsAsync(new InvalidOperationException("EDS_ERR_TAKE_PICTURE"));
        var health = new Mock<ICameraHealthService>();
        health.Setup(h => h.CheckNowAsync(It.IsAny<CancellationToken>())).ReturnsAsync(CameraHealth.Present);
        var vm = NewLiveWithHealth(health.Object);

        await vm.StartAsync();

        vm.HasError.Should().BeTrue();
        vm.ErrorMessage.Should().Contain("EDS_ERR_TAKE_PICTURE");
        _delays.Should().Contain(TimeSpan.FromSeconds(6));
        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Once);
    }

    [Fact]
    public async Task Transfer_timeout_is_not_a_missing_camera()
    {
        _camera.Setup(c => c.CaptureAsync(It.IsAny<string>())).ThrowsAsync(new TimeoutException());
        var health = new Mock<ICameraHealthService>(MockBehavior.Strict);
        var vm = NewLiveWithHealth(health.Object);

        await vm.StartAsync();

        vm.HasError.Should().BeTrue();
        vm.ErrorMessage.Should().Contain("carte SD");
    }
}
