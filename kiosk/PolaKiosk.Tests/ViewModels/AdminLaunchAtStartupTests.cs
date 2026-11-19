using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Admin › « Démarrage de Windows » : case appliquée tout de suite, état réel en cas d'échec.</summary>
public class AdminLaunchAtStartupTests
{
    private readonly Mock<IWindowsStartup> _startup = new();

    private AdminViewModel NewViewModel()
    {
        var history = new Mock<IPolaHistory>();
        history.Setup(h => h.List()).Returns([]);
        var machine = new Mock<IMachineSettingsService>();
        machine.SetupGet(m => m.Current).Returns(new MachineSettings());
        var print = new Mock<IPrintService>();
        print.Setup(p => p.GetAvailablePrinters()).Returns([]);
        var cameras = new Mock<ICameraDetectionService>();
        cameras.Setup(c => c.DetectAvailableCameras()).Returns([]);

        return new AdminViewModel(Mock.Of<IKioskStateService>(), Mock.Of<INavigationService>(), Mock.Of<ISyncService>(),
            Mock.Of<IKioskService>(), print.Object, machine.Object, cameras.Object, new AppSettings(),
            Mock.Of<ISaasSwitchService>(), Mock.Of<IAppRestart>(), history.Object, Mock.Of<IPrinterDriver>(),
            startup: _startup.Object);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Shows_the_current_state_without_writing_anything(bool enabled)
    {
        _startup.SetupGet(s => s.IsAvailable).Returns(true);
        _startup.SetupGet(s => s.IsEnabled).Returns(enabled);

        var vm = NewViewModel();

        vm.LaunchAtStartup.Should().Be(enabled);
        vm.CanChangeLaunchAtStartup.Should().BeTrue();
        vm.LaunchAtStartupStatusMsg.Should().BeEmpty();
        _startup.Verify(s => s.SetEnabled(It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public void Checking_then_unchecking_applies_at_once()
    {
        _startup.SetupGet(s => s.IsAvailable).Returns(true);
        var vm = NewViewModel();

        vm.LaunchAtStartup = true;
        _startup.Verify(s => s.SetEnabled(true), Times.Once);
        vm.LaunchAtStartupStatusMsg.Should().Be("✓ La borne se lancera toute seule à chaque démarrage de Windows.");

        vm.LaunchAtStartup = false;
        _startup.Verify(s => s.SetEnabled(false), Times.Once);
        vm.LaunchAtStartupStatusMsg.Should().StartWith("✓ La borne ne se lancera plus");
    }

    [Fact]
    public void Failure_shows_the_message_and_the_real_state()
    {
        _startup.SetupGet(s => s.IsAvailable).Returns(true);
        _startup.SetupGet(s => s.IsEnabled).Returns(false);
        _startup.Setup(s => s.SetEnabled(true)).Throws(new UnauthorizedAccessException("Accès refusé."));
        var vm = NewViewModel();

        vm.LaunchAtStartup = true;

        vm.LaunchAtStartup.Should().BeFalse("le raccourci n'a pas été posé");
        vm.LaunchAtStartupStatusMsg.Should().Be("✗ Réglage impossible à enregistrer : Accès refusé.");
    }

    [Fact]
    public void Not_installed_greys_the_box_out()
    {
        _startup.SetupGet(s => s.IsAvailable).Returns(false);

        NewViewModel().CanChangeLaunchAtStartup.Should().BeFalse();
    }
}
