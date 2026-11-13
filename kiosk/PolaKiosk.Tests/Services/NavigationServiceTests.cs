using System.Runtime.ExceptionServices;
using System.Windows.Controls;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class NavigationServiceTests
{
    // ── Écrans factices ────────────────────────────────────────────────────
    public sealed class ReleasableVm : IReleasable
    {
        public int ReleaseCount { get; private set; }
        public void Release() => ReleaseCount++;
    }

    public sealed class RootView : UserControl { public RootView() => DataContext = new ReleasableVm(); }
    public sealed class StepView : UserControl { public StepView() => DataContext = new ReleasableVm(); }

    private static (NavigationService Nav, ContentControl Frame) Create()
    {
        var services = new ServiceCollection()
            .AddTransient<RootView>()
            .AddTransient<StepView>()
            .BuildServiceProvider();
        var nav   = new NavigationService(services, new HashSet<Type> { typeof(RootView) });
        var frame = new ContentControl();
        nav.SetFrame(frame);
        return (nav, frame);
    }

    private static ReleasableVm Vm(object? view) => (ReleasableVm)((UserControl)view!).DataContext;

    // Les UserControl WPF exigent un thread STA.
    private static void RunSta(Action action)
    {
        ExceptionDispatchInfo? error = null;
        var thread = new Thread(() =>
        {
            try { action(); }
            catch (Exception ex) { error = ExceptionDispatchInfo.Capture(ex); }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        error?.Throw();
    }

    // ── Tests ──────────────────────────────────────────────────────────────
    [Fact]
    public void Default_root_views_are_home_event_setup_and_pairing()
    {
        NavigationService.DefaultRootViews.Should().BeEquivalentTo(
            new[] { typeof(PolaKiosk.Views.HomeView), typeof(PolaKiosk.Views.EventSetupView),
                    typeof(PolaKiosk.Views.PairingView) });
    }

    [Fact]
    public void Navigating_to_a_root_view_clears_history_and_releases_left_screens() => RunSta(() =>
    {
        var (nav, frame) = Create();
        nav.NavigateTo<RootView>();
        var home = frame.Content;
        nav.NavigateTo<StepView>();
        var step1 = frame.Content;
        nav.NavigateTo<StepView>();
        var step2 = frame.Content;
        nav.HistoryCount.Should().Be(2);

        nav.NavigateTo<RootView>();

        nav.HistoryCount.Should().Be(0);
        frame.Content.Should().BeOfType<RootView>().And.NotBeSameAs(home);
        Vm(home).ReleaseCount.Should().Be(1);
        Vm(step1).ReleaseCount.Should().Be(1);
        Vm(step2).ReleaseCount.Should().Be(1);
        Vm(frame.Content).ReleaseCount.Should().Be(0);
    });

    [Fact]
    public void Go_back_after_returning_home_does_nothing() => RunSta(() =>
    {
        var (nav, frame) = Create();
        nav.NavigateTo<StepView>();
        nav.NavigateTo<RootView>();
        var home = frame.Content;

        nav.GoBack();

        frame.Content.Should().BeSameAs(home);
    });

    [Fact]
    public void History_is_capped_and_oldest_screen_released() => RunSta(() =>
    {
        var (nav, frame) = Create();
        nav.NavigateTo<StepView>();
        var first = frame.Content;

        for (int i = 0; i < NavigationService.MaxHistory + 5; i++)
            nav.NavigateTo<StepView>();

        nav.HistoryCount.Should().Be(NavigationService.MaxHistory);
        Vm(first).ReleaseCount.Should().Be(1);
    });

    [Fact]
    public void Go_back_shows_previous_screen_and_releases_the_one_left() => RunSta(() =>
    {
        var (nav, frame) = Create();
        nav.NavigateTo<RootView>();
        var home = frame.Content;
        nav.NavigateTo<StepView>();
        var step = frame.Content;

        nav.GoBack();

        frame.Content.Should().BeSameAs(home);
        Vm(step).ReleaseCount.Should().Be(1);
        Vm(home).ReleaseCount.Should().Be(0);
        nav.HistoryCount.Should().Be(0);
    });

    [Fact]
    public void Navigated_is_raised_on_each_screen_change() => RunSta(() =>
    {
        var (nav, _) = Create();
        int raised = 0;
        nav.Navigated += (_, _) => raised++;

        nav.NavigateTo<RootView>();
        nav.NavigateTo<StepView>();
        nav.GoBack();

        raised.Should().Be(3);
        nav.CurrentViewType.Should().Be(typeof(RootView));
    });
}
