using System.Net.Http;
using System.Windows.Controls;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.Services;

// LAB-245 : l'événement envoyé depuis le SaaS se charge au premier écran sans séance invité, sans
// confirmation sur la borne, puis il est confirmé au SaaS (ou son échec signalé).
// LAB-246 : l'écran de chargement s'affiche dès le début de la synchro, puis l'accueil (ou l'écran d'avant).
public sealed class EventPushServiceTests : IDisposable
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private const string RequestedAt = "2026-11-05T10:00:00.123456+00:00";

    private static readonly EventPushRequest Request = new(
        new EventDto { Id = EventId, OrgId = Guid.NewGuid(), Name = "Mariage Léa & Tom", AccessCode = "ABC123" },
        RequestedAt);

    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly Mock<ISyncService> _sync = new();
    private readonly Mock<IKioskStateService> _state = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly FakeNavigation _navigation = new() { Current = typeof(HomeView) };
    private readonly ServiceProvider _provider;
    private readonly EventPushService _service;
    private readonly List<TimeSpan> _delays = new();

    public EventPushServiceTests()
    {
        _provider = new ServiceCollection().AddTransient(_ => _sync.Object).BuildServiceProvider();
        _service = new EventPushService(_supabase.Object, _provider.GetRequiredService<IServiceScopeFactory>(),
            _state.Object, _navigation, _log.Object)
        {
            Delay = d => { _delays.Add(d); return Task.CompletedTask; },
        };

        _supabase.Setup(s => s.GetEventPushRequestAsync(It.IsAny<CancellationToken>())).ReturnsAsync(Request);
        _supabase.Setup(s => s.AckEventPushAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string?>(),
            It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _sync.Setup(s => s.SyncPushedEventAsync(It.IsAny<EventDto>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new EventEntity { Id = EventId, Name = "Mariage Léa & Tom", AccessCode = "ABC123" });
        _state.Setup(s => s.SetActiveEventAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string>()))
            .Returns(Task.CompletedTask);
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public void Dispose() => _provider.Dispose();

    private void VerifyAck(string? error, Times times)
        => _supabase.Verify(s => s.AckEventPushAsync(EventId, RequestedAt, error, It.IsAny<CancellationToken>()), times);

    [Fact]
    public async Task Nothing_to_apply_without_a_pushed_event()
    {
        _supabase.Setup(s => s.GetEventPushRequestAsync(It.IsAny<CancellationToken>())).ReturnsAsync((EventPushRequest?)null);

        await _service.PollAsync(Ct);

        _service.HasPending.Should().BeFalse();
        (await _service.TryApplyAsync(showLoadingScreen: true, Ct)).Should().Be(EventPushOutcome.None);
        _sync.Verify(s => s.SyncPushedEventAsync(It.IsAny<EventDto>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Loads_the_event_on_home_with_its_access_code_then_confirms_it()
    {
        await _service.PollAsync(Ct);
        _service.HasPending.Should().BeTrue();

        (await _service.TryApplyAsync(showLoadingScreen: true, Ct)).Should().Be(EventPushOutcome.Applied);

        _sync.Verify(s => s.SyncPushedEventAsync(Request.Event, It.IsAny<CancellationToken>()), Times.Once);
        _state.Verify(s => s.SetActiveEventAsync(EventId, "Mariage Léa & Tom", "ABC123"), Times.Once);
        _navigation.History.Should().Equal(typeof(EventLoadingView), typeof(HomeView));
        _navigation.Parameters[0].Should().Be(new EventLoadingParameters("Mariage Léa & Tom", ContinueToHome: false));
        _delays.Should().Equal(EventPushService.LoadedScreenDelay);
        VerifyAck(null, Times.Once());
        _service.HasPending.Should().BeFalse();
    }

    [Theory]
    [InlineData(typeof(HomeView))]
    [InlineData(typeof(EventSetupView))]
    public async Task Shows_the_loading_screen_from_the_start_of_the_sync(Type current)
    {
        _navigation.Current = current;
        Type? duringSync = null;
        _sync.Setup(s => s.SyncPushedEventAsync(It.IsAny<EventDto>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(() =>
            {
                duringSync = _navigation.Current;
                return new EventEntity { Id = EventId, Name = "Mariage Léa & Tom", AccessCode = "ABC123" };
            });
        await _service.PollAsync(Ct);

        (await _service.TryApplyAsync(showLoadingScreen: true, Ct)).Should().Be(EventPushOutcome.Applied);

        duringSync.Should().Be(typeof(EventLoadingView), "personne ne lance une séance sur l'ancien événement");
        _navigation.History.Should().Equal(typeof(EventLoadingView), typeof(HomeView));
    }

    [Fact]
    public async Task On_the_splash_screen_shows_the_loaded_event_then_home()
    {
        _navigation.Current = typeof(SplashView);
        await _service.PollAsync(Ct);

        (await _service.TryApplyAsync(showLoadingScreen: true, Ct)).Should().Be(EventPushOutcome.Applied);

        _navigation.History.Should().Equal(typeof(EventLoadingView));
        _navigation.Parameters[0].Should().Be(new EventLoadingParameters("Mariage Léa & Tom"));
        _delays.Should().BeEmpty("l'écran de chargement passe lui-même à l'accueil");
    }

    [Fact]
    public async Task Leaves_the_screen_to_the_startup_flow_when_asked()
    {
        _navigation.Current = typeof(SplashView);
        await _service.PollAsync(Ct);

        (await _service.TryApplyAsync(showLoadingScreen: false, Ct)).Should().Be(EventPushOutcome.Applied);

        _navigation.History.Should().BeEmpty();
        _state.Verify(s => s.SetActiveEventAsync(EventId, "Mariage Léa & Tom", "ABC123"), Times.Once);
        VerifyAck(null, Times.Once());
    }

    [Theory]
    [InlineData(typeof(RgpdView))]
    [InlineData(typeof(LiveView))]
    [InlineData(typeof(ResultView))]
    [InlineData(typeof(AdminView))]
    [InlineData(typeof(EventLoadingView))]
    public async Task Waits_during_a_guest_session(Type current)
    {
        _navigation.Current = current;
        await _service.PollAsync(Ct);

        (await _service.TryApplyAsync(showLoadingScreen: true, Ct)).Should().Be(EventPushOutcome.Skipped);

        _service.HasPending.Should().BeTrue();
        _sync.Verify(s => s.SyncPushedEventAsync(It.IsAny<EventDto>(), It.IsAny<CancellationToken>()), Times.Never);
        VerifyAck(null, Times.Never());
    }

    [Fact]
    public async Task Waits_when_a_guest_session_started_during_the_sync()
    {
        _navigation.Current = typeof(SplashView);
        _sync.Setup(s => s.SyncPushedEventAsync(It.IsAny<EventDto>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(() =>
            {
                _navigation.Current = typeof(RgpdView); // une séance a commencé pendant la synchro
                return new EventEntity { Id = EventId, Name = "Mariage Léa & Tom", AccessCode = "ABC123" };
            });
        await _service.PollAsync(Ct);

        (await _service.TryApplyAsync(showLoadingScreen: false, Ct)).Should().Be(EventPushOutcome.Skipped);

        _service.HasPending.Should().BeTrue();
        _state.Verify(s => s.SetActiveEventAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        _navigation.History.Should().BeEmpty();
    }

    [Fact]
    public async Task Waits_and_stays_put_when_another_screen_opened_during_the_sync()
    {
        _sync.Setup(s => s.SyncPushedEventAsync(It.IsAny<EventDto>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(() =>
            {
                _navigation.Current = typeof(AdminView); // l'admin ouvre son écran pendant la synchro
                return new EventEntity { Id = EventId, Name = "Mariage Léa & Tom", AccessCode = "ABC123" };
            });
        await _service.PollAsync(Ct);

        (await _service.TryApplyAsync(showLoadingScreen: true, Ct)).Should().Be(EventPushOutcome.Skipped);

        _service.HasPending.Should().BeTrue();
        _state.Verify(s => s.SetActiveEventAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        _navigation.History.Should().Equal(typeof(EventLoadingView));
        _navigation.Current.Should().Be(typeof(AdminView));
    }

    [Theory]
    [InlineData(typeof(HomeView))]
    [InlineData(typeof(EventSetupView))]
    public async Task Keeps_the_push_pending_and_goes_back_when_the_network_is_down(Type previous)
    {
        _navigation.Current = previous;
        _sync.Setup(s => s.SyncPushedEventAsync(It.IsAny<EventDto>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("Pas de réseau"));
        await _service.PollAsync(Ct);

        (await _service.TryApplyAsync(showLoadingScreen: true, Ct)).Should().Be(EventPushOutcome.Skipped);

        _service.HasPending.Should().BeTrue();
        _navigation.History.Should().Equal(typeof(EventLoadingView), previous);
        _supabase.Verify(s => s.AckEventPushAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Goes_back_when_the_sync_is_cancelled()
    {
        _sync.Setup(s => s.SyncPushedEventAsync(It.IsAny<EventDto>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new OperationCanceledException());
        await _service.PollAsync(Ct);

        (await _service.TryApplyAsync(showLoadingScreen: true, Ct)).Should().Be(EventPushOutcome.Skipped);

        _navigation.History.Should().Equal(typeof(EventLoadingView), typeof(HomeView));
    }

    [Fact]
    public async Task Reports_the_failure_to_the_saas_and_stops_retrying()
    {
        _sync.Setup(s => s.SyncPushedEventAsync(It.IsAny<EventDto>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Base locale verrouillée"));
        await _service.PollAsync(Ct);

        (await _service.TryApplyAsync(showLoadingScreen: true, Ct)).Should().Be(EventPushOutcome.Failed);

        _service.HasPending.Should().BeFalse();
        _supabase.Verify(s => s.AckEventPushAsync(EventId, RequestedAt,
            It.Is<string?>(e => !string.IsNullOrWhiteSpace(e)), It.IsAny<CancellationToken>()), Times.Once);
        _state.Verify(s => s.SetActiveEventAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        _navigation.History.Should().Equal(typeof(EventLoadingView), typeof(HomeView));
    }

    [Fact]
    public async Task Reports_a_failure_when_the_event_is_missing_after_the_sync()
    {
        _sync.Setup(s => s.SyncPushedEventAsync(It.IsAny<EventDto>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((EventEntity?)null);
        await _service.PollAsync(Ct);

        (await _service.TryApplyAsync(showLoadingScreen: true, Ct)).Should().Be(EventPushOutcome.Failed);

        _supabase.Verify(s => s.AckEventPushAsync(EventId, RequestedAt,
            It.Is<string?>(e => !string.IsNullOrWhiteSpace(e)), It.IsAny<CancellationToken>()), Times.Once);
        _navigation.History.Should().Equal(typeof(EventLoadingView), typeof(HomeView));
    }

    [Fact]
    public async Task Resends_a_lost_confirmation_before_reading_again()
    {
        _supabase.SetupSequence(s => s.AckEventPushAsync(EventId, RequestedAt, null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("Coupure"))
            .ReturnsAsync(true);
        await _service.PollAsync(Ct);
        (await _service.TryApplyAsync(showLoadingScreen: true, Ct)).Should().Be(EventPushOutcome.Applied);

        _supabase.Setup(s => s.GetEventPushRequestAsync(It.IsAny<CancellationToken>())).ReturnsAsync((EventPushRequest?)null);
        await _service.PollAsync(Ct);

        VerifyAck(null, Times.Exactly(2));
        _service.HasPending.Should().BeFalse();
        _sync.Verify(s => s.SyncPushedEventAsync(It.IsAny<EventDto>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_refused_license_drops_the_push_without_throwing()
    {
        await _service.PollAsync(Ct);
        _supabase.Setup(s => s.GetEventPushRequestAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new KioskLicenseRefusedException());

        await _service.Invoking(s => s.PollAsync(Ct)).Should().NotThrowAsync();

        _service.HasPending.Should().BeFalse();
    }

    // LAB-246 : lecture rapprochée seulement en ligne, sur l'accueil ou la saisie du code.
    [Theory]
    [InlineData(typeof(HomeView), true, true)]
    [InlineData(typeof(EventSetupView), true, true)]
    [InlineData(typeof(HomeView), false, false)]
    [InlineData(typeof(EventSetupView), false, false)]
    [InlineData(typeof(SplashView), true, false)]
    [InlineData(typeof(EventLoadingView), true, false)]
    [InlineData(typeof(RgpdView), true, false)]
    [InlineData(typeof(LiveView), true, false)]
    [InlineData(typeof(ResultView), true, false)]
    [InlineData(typeof(AdminView), true, false)]
    [InlineData(typeof(PairingView), true, false)]
    [InlineData(null, true, false)]
    public void Polls_quickly_only_online_on_home_or_code_entry(Type? current, bool online, bool expected)
        => EventPushService.ShouldPollQuickly(current, online).Should().Be(expected);

    private sealed class FakeNavigation : INavigationService
    {
        public Type? Current { get; set; }
        public List<Type> History { get; } = new();
        public List<object?> Parameters { get; } = new();

        public Type? CurrentViewType => Current;
        public event EventHandler? Navigated;

        public void NavigateTo<TView>() where TView : UserControl => Navigate(typeof(TView), null);

        public void NavigateTo<TView>(object parameter) where TView : UserControl => Navigate(typeof(TView), parameter);

        private void Navigate(Type view, object? parameter)
        {
            Current = view;
            History.Add(view);
            Parameters.Add(parameter);
            Navigated?.Invoke(this, EventArgs.Empty);
        }

        public void GoBack() { }
    }
}
