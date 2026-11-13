using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.Services;

public class IdleTimeoutServiceTests
{
    private sealed class FakeTimer : IIdleTimer
    {
        public TimeSpan Interval { get; set; }
        public bool IsEnabled { get; private set; }
        public int StartCount { get; private set; }
        public event EventHandler? Tick;
        public void Start() { IsEnabled = true; StartCount++; }
        public void Stop()  => IsEnabled = false;
        public void Fire()  => Tick?.Invoke(this, EventArgs.Empty);
    }

    private readonly Mock<INavigationService> _nav   = new();
    private readonly Mock<IKioskStateService> _state = new();
    private readonly FakeTimer _timer = new();
    private Type? _current;

    public IdleTimeoutServiceTests()
    {
        _nav.SetupGet(n => n.CurrentViewType).Returns(() => _current);
        _state.SetupGet(s => s.ActiveEventId).Returns(Guid.NewGuid());
    }

    private IdleTimeoutService Create(int seconds = 60)
    {
        var svc = new IdleTimeoutService(_nav.Object, _state.Object, new AppSettings(), () => _timer);
        svc.SetTimeout(seconds);
        return svc;
    }

    private void NavigateTo(Type view)
    {
        _current = view;
        _nav.Raise(n => n.Navigated += null, EventArgs.Empty);
    }

    [Fact]
    public void Live_screen_is_not_a_session_screen()
    {
        IdleTimeoutService.SessionScreens.Should().NotContain(typeof(LiveView));
        IdleTimeoutService.SessionScreens.Should().Contain(typeof(ResultView));
    }

    [Fact]
    public void Timer_is_suspended_during_live()
    {
        var svc = Create();
        NavigateTo(typeof(ResultView));
        svc.IsRunning.Should().BeTrue();

        NavigateTo(typeof(LiveView));

        svc.IsRunning.Should().BeFalse();
    }

    [Fact]
    public void Each_navigation_restarts_the_countdown()
    {
        var svc = Create();
        NavigateTo(typeof(EffectSelectView));
        var starts = _timer.StartCount;

        NavigateTo(typeof(ResultView));

        _timer.StartCount.Should().Be(starts + 1);
        svc.IsRunning.Should().BeTrue();
    }

    [Fact]
    public void Tick_on_session_screen_returns_home()
    {
        Create();
        NavigateTo(typeof(ResultView));

        _timer.Fire();

        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Once);
    }

    [Fact]
    public void Tick_after_leaving_session_screen_does_nothing()
    {
        Create();
        NavigateTo(typeof(ResultView));
        _current = typeof(LiveView); // changement d'écran sans événement (cas limite)

        _timer.Fire();

        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Never);
    }

    [Fact]
    public void Zero_timeout_disables_the_timer()
    {
        var svc = Create(seconds: 0);
        NavigateTo(typeof(ResultView));
        svc.IsRunning.Should().BeFalse();
    }
}
