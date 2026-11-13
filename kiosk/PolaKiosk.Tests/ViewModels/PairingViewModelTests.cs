using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>LAB-244 : écran d'association (renouvellement, expiration, hors ligne, validation, réponse perdue).</summary>
public class PairingViewModelTests
{
    private static readonly DateTimeOffset T0 = new(2026, 11, 5, 10, 0, 0, TimeSpan.Zero);

    private readonly FakeClock _clock = new(T0);
    private readonly Mock<IPairingService> _pairing = new();
    private readonly Mock<ILicenseService> _license = new();
    private readonly FakeCredentials _credentials = new();
    private readonly Mock<IKioskStateService> _state = new();
    private readonly Mock<INavigationService> _navigation = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly AppSettings _settings = new();

    private readonly Queue<Func<PairingCode>> _starts = new();
    private readonly Queue<Func<PairingPollResult>> _polls = new();
    private int _codeNumber;

    public PairingViewModelTests()
    {
        _settings.Kiosk.PairingUrl = "https://photobooth.exemple.fr/associer";
        _settings.Kiosk.PairingPollSeconds = 3;

        _pairing.Setup(p => p.StartAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => _starts.Count > 0 ? _starts.Dequeue()() : NewCode());
        _pairing.Setup(p => p.PollAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => _polls.Count > 0 ? _polls.Dequeue()() : new PairingPollResult(PairingStatus.Pending));
    }

    private PairingCode NewCode(TimeSpan? validity = null)
    {
        _codeNumber++;
        return new PairingCode(Guid.NewGuid(), $"ABC{_codeNumber:000}", _clock.UtcNow + (validity ?? TimeSpan.FromMinutes(10)));
    }

    private static readonly Guid OrgId = Guid.Parse("7a6b5c4d-2222-4333-8444-955566667777");

    private static PairingPollResult Approved(string? secret = "secret-recu")
        => new(PairingStatus.Approved, secret, Guid.NewGuid(), "Borne salon", "Studio Lumière", OrgId);

    private static Exception NetworkDown() => new HttpRequestException("Hôte inaccessible");

    private PairingViewModel NewViewModel()
        => new(_pairing.Object, _license.Object, _credentials, _state.Object, _navigation.Object, _log.Object,
               _settings, _clock);

    private static async Task RunAsync(PairingViewModel vm)
        => await vm.RunAsync().WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);

    // ── Validation ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Approval_saves_the_secret_shows_the_account_then_opens_the_event_code_screen()
    {
        _polls.Enqueue(() => new PairingPollResult(PairingStatus.Pending));
        _polls.Enqueue(() => Approved());
        var vm = NewViewModel();
        var paired = false;
        _clock.OnDelay = d => { if (vm.IsPaired && d == PairingViewModel.PairedMessageTime) paired = true; };

        await RunAsync(vm);

        _credentials.Saved.Should().Equal("secret-recu");
        paired.Should().BeTrue("le message reste 3 secondes avant la saisie du code");
        vm.PairedMessage.Should().Be("Borne associée à Studio Lumière — Borne salon");
        _state.Verify(s => s.ClearActiveEventAsync(), Times.Once);
        _state.Verify(s => s.SetPairedAccountAsync("Studio Lumière", OrgId), Times.Once);
        _pairing.Verify(p => p.Forget(), Times.AtLeastOnce);
        _license.Verify(l => l.CheckAsync(), Times.Once, "heartbeat et PIN admin dès l'association");
        _navigation.Verify(n => n.NavigateTo<EventSetupView>(), Times.Once);
        _pairing.Verify(p => p.StartAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Code_and_qr_link_are_shown_while_waiting()
    {
        var vm = NewViewModel();
        string? code = null, qr = null, countdown = null;
        _polls.Enqueue(() =>
        {
            (code, qr, countdown) = (vm.DisplayCode, vm.QrUrl, vm.Countdown);
            return Approved();
        });

        await RunAsync(vm);

        code.Should().Be("ABC-001");
        qr.Should().Be("https://photobooth.exemple.fr/associer?code=ABC001");
        countdown.Should().Be("Code valable encore 9:57");
        vm.PairingAddress.Should().Be("photobooth.exemple.fr/associer");
    }

    [Fact]
    public async Task Polls_every_configured_interval()
    {
        var pollTimes = new List<DateTimeOffset>();
        for (var i = 0; i < 3; i++)
            _polls.Enqueue(() => { pollTimes.Add(_clock.UtcNow); return new PairingPollResult(PairingStatus.Pending); });
        _polls.Enqueue(() => Approved());

        await RunAsync(NewViewModel());

        pollTimes.Should().Equal(T0.AddSeconds(3), T0.AddSeconds(6), T0.AddSeconds(9));
    }

    [Fact]
    public void Paired_message_without_name_or_account()
    {
        PairingViewModel.BuildPairedMessage("Studio", null).Should().Be("Borne associée à Studio");
        PairingViewModel.BuildPairedMessage(null, null).Should().Be("Borne associée");
        PairingViewModel.BuildPairedMessage(" Studio ", " Borne 2 ").Should().Be("Borne associée à Studio — Borne 2");
    }

    // ── Renouvellement et expiration ─────────────────────────────────────────

    [Fact]
    public async Task Expired_code_is_replaced_automatically()
    {
        var vm = NewViewModel();
        var codes = new List<string>();
        _pairing.Setup(p => p.PollAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync(() =>
                {
                    if (!codes.Contains(vm.DisplayCode)) codes.Add(vm.DisplayCode);
                    return codes.Count == 2 ? Approved() : new PairingPollResult(PairingStatus.Pending);
                });

        await RunAsync(vm);

        codes.Should().Equal("ABC-001", "ABC-002");
        _clock.UtcNow.Should().BeOnOrAfter(T0.AddMinutes(10), "le premier code a vécu ses 10 minutes");
        vm.Notice.Should().BeEmpty("une expiration ne mérite pas de message");
    }

    [Theory]
    [InlineData(PairingStatus.Expired)]
    [InlineData(PairingStatus.Cancelled)]
    [InlineData(PairingStatus.NotFound)]
    [InlineData(PairingStatus.InvalidKey)]
    public async Task Code_ended_by_the_server_is_replaced_without_message(PairingStatus status)
    {
        _polls.Enqueue(() => new PairingPollResult(status));
        _polls.Enqueue(() => Approved());

        var vm = NewViewModel();
        await RunAsync(vm);

        _pairing.Verify(p => p.StartAsync(It.IsAny<CancellationToken>()), Times.Exactly(2));
        _credentials.Saved.Should().Equal("secret-recu");
        _clock.UtcNow.Should().BeBefore(T0.AddMinutes(1));
    }

    [Fact]
    public async Task Server_expiry_in_the_past_does_not_end_the_code_at_once()
    {
        // Horloge du PC en avance : expires_at du serveur déjà dépassé pour la borne.
        _starts.Enqueue(() => NewCode(TimeSpan.FromMinutes(-5)));
        var pollTimes = new List<DateTimeOffset>();
        _pairing.Setup(p => p.PollAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => { pollTimes.Add(_clock.UtcNow); return pollTimes.Count == 100 ? Approved() : new(PairingStatus.Pending); });

        await RunAsync(NewViewModel());

        _pairing.Verify(p => p.StartAsync(It.IsAny<CancellationToken>()), Times.Once);
        pollTimes.Last().Should().Be(T0.AddSeconds(300), "le code vit 10 minutes sur l'horloge de la borne");
    }

    [Fact]
    public async Task After_six_codes_the_screen_waits_for_a_touch()
    {
        var vm = NewViewModel();

        await RunAsync(vm);

        vm.State.Should().Be(PairingScreenState.Exhausted);
        vm.IsExhausted.Should().BeTrue();
        vm.ExhaustedText.Should().Be("Touchez l'écran pour afficher un nouveau code");
        vm.CodesShown.Should().Be(6);
        _pairing.Verify(p => p.StartAsync(It.IsAny<CancellationToken>()), Times.Exactly(6));
        _clock.UtcNow.Should().Be(T0.AddHours(1));
        _pairing.Verify(p => p.Forget(), Times.AtLeastOnce, "plus de code affiché : K est effacée");
        vm.DisplayCode.Should().BeEmpty();
    }

    [Fact]
    public async Task Touching_the_screen_starts_a_new_series_of_codes()
    {
        var vm = NewViewModel();
        await RunAsync(vm);
        _polls.Enqueue(() => Approved());

        vm.RestartCommand.Execute(null);
        await WaitUntilAsync(() => _credentials.Saved.Count == 1);

        _pairing.Verify(p => p.StartAsync(It.IsAny<CancellationToken>()), Times.Exactly(7));
        vm.CodesShown.Should().Be(1);
    }

    // ── Réponse perdue ───────────────────────────────────────────────────────

    [Fact]
    public async Task Delivered_without_secret_received_shows_a_message_and_a_new_code()
    {
        var vm = NewViewModel();
        string? noticeWithSecondCode = null;
        _polls.Enqueue(() => new PairingPollResult(PairingStatus.Delivered));
        _polls.Enqueue(() => { noticeWithSecondCode = vm.Notice; return Approved(); });

        await RunAsync(vm);

        noticeWithSecondCode.Should().Be("L'association n'a pas abouti, nouveau code");
        _pairing.Verify(p => p.StartAsync(It.IsAny<CancellationToken>()), Times.Exactly(2));
        _credentials.Saved.Should().Equal("secret-recu");
    }

    [Fact]
    public async Task Approved_without_secret_is_treated_as_lost()
    {
        var vm = NewViewModel();
        string? notice = null;
        _polls.Enqueue(() => Approved(secret: null));
        _polls.Enqueue(() => { notice = vm.Notice; return Approved(); });

        await RunAsync(vm);

        notice.Should().Be(PairingViewModel.LostMessage);
        _credentials.Saved.Should().Equal("secret-recu");
    }

    // ── Hors ligne ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Offline_shows_the_message_and_retries_every_15_seconds()
    {
        var vm = NewViewModel();
        var states = new List<PairingScreenState>();
        _starts.Enqueue(() => throw NetworkDown());
        _starts.Enqueue(() => { states.Add(vm.State); throw NetworkDown(); });
        _polls.Enqueue(() => Approved());

        await RunAsync(vm);

        states.Should().Equal(PairingScreenState.Offline);
        vm.OfflineText.Should().Be("Pas de connexion internet. Branchez la borne au réseau pour l'associer.");
        _clock.Delays.Where(d => d == PairingViewModel.OfflineRetry).Should().HaveCount(2);
        _pairing.Verify(p => p.StartAsync(It.IsAny<CancellationToken>()), Times.Exactly(3));
        vm.CodesShown.Should().Be(1, "un essai hors ligne ne compte pas parmi les six codes");
    }

    [Fact]
    public async Task Retry_button_does_not_wait_the_15_seconds()
    {
        _starts.Enqueue(() => throw NetworkDown());
        _polls.Enqueue(() => Approved());
        _clock.BlockOn = PairingViewModel.OfflineRetry;
        var vm = NewViewModel();

        var run = vm.RunAsync();
        await WaitUntilAsync(() => vm.IsOffline && _clock.Blocked);
        vm.RetryCommand.Execute(null);
        await run.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);

        _credentials.Saved.Should().Equal("secret-recu");
    }

    [Fact]
    public async Task Connection_lost_while_showing_a_code_keeps_the_code()
    {
        var vm = NewViewModel();
        var lost = new List<bool>();
        _polls.Enqueue(() => throw NetworkDown());
        _polls.Enqueue(() => { lost.Add(vm.IsConnectionLost); throw NetworkDown(); });
        _polls.Enqueue(() => { lost.Add(vm.IsConnectionLost); return new PairingPollResult(PairingStatus.Pending); });
        _polls.Enqueue(() => { lost.Add(vm.IsConnectionLost); return Approved(); });

        await RunAsync(vm);

        lost.Should().Equal(true, true, false);
        _pairing.Verify(p => p.StartAsync(It.IsAny<CancellationToken>()), Times.Once, "le code reste valable");
        _credentials.Saved.Should().Equal("secret-recu");
    }

    [Fact]
    public async Task Rate_limit_waits_a_minute_before_a_new_code()
    {
        var vm = NewViewModel();
        string? notice = null;
        _starts.Enqueue(() => throw new PairingRateLimitedException());
        _starts.Enqueue(() => { notice = vm.Notice; return NewCode(); });
        _polls.Enqueue(() => Approved());

        await RunAsync(vm);

        notice.Should().Be(PairingViewModel.RateLimitMessage);
        _clock.Delays.Should().Contain(PairingViewModel.RateLimitedRetry);
        vm.Notice.Should().BeEmpty();
    }

    // ── Borne déjà associée ──────────────────────────────────────────────────

    [Fact]
    public async Task Valid_license_goes_straight_to_the_event_code_screen()
    {
        _credentials.Secret = "secret-actuel";
        _license.Setup(l => l.CheckAsync()).ReturnsAsync(LicenseStatus.Valid);

        await RunAsync(NewViewModel());

        _navigation.Verify(n => n.NavigateTo<EventSetupView>(), Times.Once);
        _pairing.Verify(p => p.StartAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Retired_kiosk_names_its_former_account_and_asks_for_a_new_pairing()
    {
        _credentials.Secret = "secret-retire";
        _license.Setup(l => l.CheckAsync()).ReturnsAsync(LicenseStatus.Refused);
        _state.SetupGet(s => s.AccountName).Returns("Studio Lumière");
        var vm = NewViewModel();
        string? retired = null;
        _polls.Enqueue(() => { retired = vm.RetiredMessage; return Approved(); });

        await RunAsync(vm);

        retired.Should().Be("Cette borne a été retirée du compte Studio Lumière.");
        _credentials.Saved.Should().Equal("secret-recu");
    }

    [Fact]
    public async Task Retired_kiosk_with_unknown_account_has_no_message()
    {
        _credentials.Secret = "secret-retire";
        _license.Setup(l => l.CheckAsync()).ReturnsAsync(LicenseStatus.Refused);
        var vm = NewViewModel();
        bool? hasRetired = null;
        _polls.Enqueue(() => { hasRetired = vm.HasRetiredMessage; return Approved(); });

        await RunAsync(vm);

        hasRetired.Should().BeFalse();
    }

    [Fact]
    public async Task Unverified_license_waits_for_the_network_instead_of_asking_a_code()
    {
        _credentials.Secret = "secret-actuel";
        var vm = NewViewModel();
        var states = new List<PairingScreenState>();
        _license.SetupSequence(l => l.CheckAsync())
                .ReturnsAsync(LicenseStatus.Unverified)
                .ReturnsAsync(LicenseStatus.Valid);
        _clock.OnDelay = _ => states.Add(vm.State);

        await RunAsync(vm);

        states.Should().Equal(PairingScreenState.Offline);
        _navigation.Verify(n => n.NavigateTo<EventSetupView>(), Times.Once);
        _pairing.Verify(p => p.StartAsync(It.IsAny<CancellationToken>()), Times.Never,
            "une coupure réseau ne doit pas faire réassocier la borne");
    }

    // ── Écran quitté ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Leaving_the_screen_stops_polling_and_forgets_the_key()
    {
        var vm = NewViewModel();
        var polls = 0;
        _pairing.Setup(p => p.PollAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync(() =>
                {
                    if (++polls == 2) vm.Release();
                    return new PairingPollResult(PairingStatus.Pending);
                });

        await RunAsync(vm);

        polls.Should().Be(2);
        _pairing.Verify(p => p.Forget(), Times.AtLeastOnce);
        _credentials.Saved.Should().BeEmpty();
        _navigation.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(600, "Code valable encore 10:00")]
    [InlineData(61.2, "Code valable encore 1:02")]
    [InlineData(0.4, "Code valable encore 0:01")]
    [InlineData(-3, "Code valable encore 0:00")]
    public void Countdown_format(double seconds, string expected)
        => PairingViewModel.FormatCountdown(TimeSpan.FromSeconds(seconds)).Should().Be(expected);

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        var until = DateTime.UtcNow.AddSeconds(10);
        while (!condition())
        {
            if (DateTime.UtcNow > until) throw new TimeoutException("Condition jamais atteinte.");
            await Task.Delay(10, TestContext.Current.CancellationToken);
        }
    }

    /// <summary>Horloge simulée : chaque attente avance le temps aussitôt (sauf <see cref="BlockOn"/>).</summary>
    private sealed class FakeClock(DateTimeOffset start) : IPairingClock
    {
        private long _ticks = start.UtcTicks;
        public DateTimeOffset UtcNow => new(Interlocked.Read(ref _ticks), TimeSpan.Zero);
        public List<TimeSpan> Delays { get; } = [];
        public Action<TimeSpan>? OnDelay { get; set; }
        public TimeSpan? BlockOn { get; set; }
        public volatile bool Blocked;

        public async Task Delay(TimeSpan delay, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            lock (Delays)
            {
                Delays.Add(delay);
                if (Delays.Count > 100_000) throw new InvalidOperationException("Boucle sans fin.");
            }
            OnDelay?.Invoke(delay);
            if (delay == BlockOn)
            {
                Blocked = true;
                await Task.Delay(Timeout.Infinite, ct);
            }
            Interlocked.Add(ref _ticks, delay.Ticks);
        }
    }

    private sealed class FakeCredentials : IKioskCredentials
    {
        public string MachineId => "MACHINE-1";
        public string Secret { get; set; } = "";
        public List<string> Saved { get; } = [];

        public void SetSecret(string secret)
        {
            Saved.Add(secret);
            Secret = secret;
        }
    }
}
