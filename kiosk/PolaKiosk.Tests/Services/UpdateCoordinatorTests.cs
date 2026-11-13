using System.Net.Http;
using System.Windows.Controls;
using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.Services;

// LAB-200 : la mise à jour demandée depuis le SaaS s'installe au premier écran sans séance invité ;
// un échec est signalé au SaaS et ne bloque jamais l'écran.
public class UpdateCoordinatorTests
{
    private static readonly UpdateRequest Request =
        new("9.9.9", "https://exemple.test/setup.exe", new string('a', 64), "2026-11-03T10:00:00.123456+00:00");

    private readonly FakeNavigation _navigation = new();
    private readonly Mock<IUpdateService> _updates = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly UpdateCoordinator _coordinator;

    public UpdateCoordinatorTests()
    {
        _coordinator = new UpdateCoordinator(_updates.Object, _navigation, _log.Object);
    }

    [Theory]
    [InlineData(typeof(SplashView), true)]
    [InlineData(typeof(EventSetupView), true)]
    [InlineData(typeof(HomeView), true)]
    [InlineData(typeof(RgpdView), false)]
    [InlineData(typeof(EffectSelectView), false)]
    [InlineData(typeof(LiveView), false)]
    [InlineData(typeof(ResultView), false)]
    [InlineData(typeof(GalleryView), false)]
    [InlineData(typeof(AdminView), false)]
    [InlineData(typeof(EventLoadingView), false)]
    [InlineData(typeof(PairingView), false)]
    [InlineData(typeof(UpdateView), false)]
    [InlineData(null, false)]
    public void CanApplyNow_only_without_a_guest_session(Type? view, bool expected)
    {
        UpdateCoordinator.CanApplyNow(view).Should().Be(expected);
    }

    [Fact]
    public void CanApplyNow_reads_the_current_screen()
    {
        _navigation.Current = typeof(HomeView);
        _coordinator.CanApplyNow().Should().BeTrue();

        _navigation.Current = typeof(LiveView);
        _coordinator.CanApplyNow().Should().BeFalse();
    }

    [Fact]
    public async Task TryApply_is_skipped_during_a_guest_session_without_touching_the_screen()
    {
        _navigation.Current = typeof(LiveView);

        var outcome = await _coordinator.TryApplyAsync(Request);

        outcome.Should().Be(UpdateOutcome.Skipped);
        _navigation.History.Should().BeEmpty();
        _updates.Verify(u => u.ApplyAsync(It.IsAny<UpdateRequest>(), It.IsAny<CancellationToken>()), Times.Never);
        _updates.Verify(u => u.ReportFailureAsync(It.IsAny<UpdateRequest>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData(typeof(EventSetupView))]
    [InlineData(typeof(HomeView))]
    public async Task TryApply_shows_the_update_screen_and_reports_installing(Type start)
    {
        _navigation.Current = start;
        Type? screenDuringApply = null;
        _updates.Setup(u => u.ApplyAsync(Request, It.IsAny<CancellationToken>()))
            .Callback(() => screenDuringApply = _navigation.Current)
            .ReturnsAsync(true);

        var outcome = await _coordinator.TryApplyAsync(Request);

        outcome.Should().Be(UpdateOutcome.Installing);
        screenDuringApply.Should().Be(typeof(UpdateView));
        _updates.Verify(u => u.ReportFailureAsync(It.IsAny<UpdateRequest>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Download_failure_returns_to_event_setup_and_is_reported()
    {
        _navigation.Current = typeof(EventSetupView);
        _updates.Setup(u => u.ApplyAsync(Request, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("Hôte inaccessible"));

        var outcome = await _coordinator.TryApplyAsync(Request);

        outcome.Should().Be(UpdateOutcome.Failed);
        _navigation.History.Should().Equal(typeof(UpdateView), typeof(EventSetupView));
        _navigation.Current.Should().Be(typeof(EventSetupView), "la borne ne doit jamais rester sur l'écran « Mise à jour »");
        _log.Verify(l => l.LogErrorAsync("update", It.Is<string>(m => m.Contains("9.9.9")), It.IsAny<string?>()), Times.Once);
        _updates.Verify(u => u.ReportFailureAsync(Request, "Hôte inaccessible", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData(typeof(SplashView))]
    [InlineData(typeof(HomeView))]
    public async Task Failure_returns_to_the_previous_screen(Type start)
    {
        _navigation.Current = start;
        _updates.Setup(u => u.ApplyAsync(Request, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new TimeoutException("aucune donnée reçue"));

        (await _coordinator.TryApplyAsync(Request)).Should().Be(UpdateOutcome.Failed);

        _navigation.Current.Should().Be(start);
    }

    [Fact]
    public async Task Rejected_installer_is_reported_as_a_hash_mismatch()
    {
        _navigation.Current = typeof(EventSetupView);
        _updates.Setup(u => u.ApplyAsync(Request, It.IsAny<CancellationToken>())).ReturnsAsync(false);

        (await _coordinator.TryApplyAsync(Request)).Should().Be(UpdateOutcome.Failed);

        _navigation.Current.Should().Be(typeof(EventSetupView));
        _updates.Verify(u => u.ReportFailureAsync(Request, It.Is<string>(m => m.Contains("SHA-256")), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Too_long_download_is_reported_with_a_readable_message()
    {
        _navigation.Current = typeof(EventSetupView);
        _updates.Setup(u => u.ApplyAsync(Request, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new OperationCanceledException());

        (await _coordinator.TryApplyAsync(Request)).Should().Be(UpdateOutcome.Failed);

        _updates.Verify(u => u.ReportFailureAsync(Request, It.Is<string>(m => m.Contains("15 min")), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_failing_log_does_not_prevent_returning_to_the_previous_screen()
    {
        _navigation.Current = typeof(EventSetupView);
        _updates.Setup(u => u.ApplyAsync(Request, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new IOException("disque plein"));
        _log.Setup(l => l.LogErrorAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>()))
            .ThrowsAsync(new IOException("base locale verrouillée"));

        (await _coordinator.TryApplyAsync(Request)).Should().Be(UpdateOutcome.Failed);

        _navigation.Current.Should().Be(typeof(EventSetupView));
        _updates.Verify(u => u.ReportFailureAsync(Request, "disque plein", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Apply_receives_a_bounded_cancellation_token()
    {
        _navigation.Current = typeof(EventSetupView);
        var token = CancellationToken.None;
        _updates.Setup(u => u.ApplyAsync(Request, It.IsAny<CancellationToken>()))
            .Callback<UpdateRequest, CancellationToken>((_, ct) => token = ct)
            .ReturnsAsync(true);

        await _coordinator.TryApplyAsync(Request);

        token.CanBeCanceled.Should().BeTrue("un téléchargement ne doit pas pouvoir durer indéfiniment");
    }

    /// <summary>Navigation en mémoire : écran courant + historique des NavigateTo.</summary>
    private sealed class FakeNavigation : INavigationService
    {
        public Type? Current { get; set; }
        public List<Type> History { get; } = new();

        public Type? CurrentViewType => Current;
        public event EventHandler? Navigated;

        public void NavigateTo<TView>() where TView : UserControl
        {
            Current = typeof(TView);
            History.Add(typeof(TView));
            Navigated?.Invoke(this, EventArgs.Empty);
        }

        public void NavigateTo<TView>(object parameter) where TView : UserControl => NavigateTo<TView>();

        public void GoBack() { }
    }
}
