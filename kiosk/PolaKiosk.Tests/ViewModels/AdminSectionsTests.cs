using System.Globalization;
using System.Windows;
using FluentAssertions;
using Moq;
using PolaKiosk.Converters;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>
/// Écran admin tactile : menu à gauche (une section à la fois) et choix en tuiles enregistrés dès
/// qu'on les touche, sans rien enregistrer à l'ouverture de l'écran.
/// </summary>
public sealed class AdminSectionsTests : IDisposable
{
    private readonly TempDir _dir = new();
    private readonly MachineSettingsService _machine;
    private readonly AppSettings _settings = new();

    public AdminSectionsTests() => _machine = new MachineSettingsService(_dir.Path);

    public void Dispose() => _dir.Dispose();

    private AdminViewModel NewViewModel()
    {
        var history = new Mock<IPolaHistory>();
        history.Setup(h => h.List()).Returns([]);
        var print = new Mock<IPrintService>();
        print.Setup(p => p.GetAvailablePrinters()).Returns(["DNP DS620"]);
        var cameras = new Mock<ICameraDetectionService>();
        cameras.Setup(c => c.DetectAvailableCameras()).Returns([]);

        return new AdminViewModel(Mock.Of<IKioskStateService>(), Mock.Of<INavigationService>(), Mock.Of<ISyncService>(),
            Mock.Of<IKioskService>(), print.Object, _machine, cameras.Object, _settings,
            Mock.Of<ISaasSwitchService>(), Mock.Of<IAppRestart>(), history.Object, Mock.Of<IPrinterDriver>());
    }

    private MachineSettings Saved() => new MachineSettingsService(_dir.Path).Current;

    [Fact]
    public void Screen_opens_on_the_event_section()
    {
        var vm = NewViewModel();

        vm.Section.Should().Be(AdminViewModel.EventSection);
        vm.IsEventSection.Should().BeTrue();
        vm.IsPrinterSection.Should().BeFalse();
        vm.IsCameraSection.Should().BeFalse();
        vm.IsKioskSection.Should().BeFalse();
    }

    [Theory]
    [InlineData("printer")]
    [InlineData("camera")]
    [InlineData("kiosk")]
    [InlineData("event")]
    public void Menu_shows_one_section_at_a_time(string section)
    {
        var vm = NewViewModel();

        vm.ShowSectionCommand.Execute(section);

        vm.Section.Should().Be(section);
        new[] { vm.IsEventSection, vm.IsPrinterSection, vm.IsCameraSection, vm.IsKioskSection }
            .Count(shown => shown).Should().Be(1);
    }

    [Fact]
    public void Unknown_section_is_ignored()
    {
        var vm = NewViewModel();
        vm.ShowSectionCommand.Execute(AdminViewModel.PrinterSection);

        vm.ShowSectionCommand.Execute("inconnue");
        vm.ShowSectionCommand.Execute(null);

        vm.Section.Should().Be(AdminViewModel.PrinterSection);
    }

    [Fact]
    public void Changing_section_cancels_a_pending_confirmation()
    {
        var vm = NewViewModel();
        vm.ShowSectionCommand.Execute(AdminViewModel.KioskSection);
        vm.AskQuitCommand.Execute(null);
        vm.IsConfirmingQuit.Should().BeTrue();

        vm.ShowSectionCommand.Execute(AdminViewModel.EventSection);

        vm.IsConfirmingQuit.Should().BeFalse();
        vm.IsConfirmingSaasChange.Should().BeFalse();
    }

    [Fact]
    public void Opening_the_screen_saves_no_choice()
    {
        var vm = NewViewModel();

        vm.SelectedCamera.Should().NotBeNull();
        vm.SelectedPhotoSize.Should().NotBeNull();
        vm.CameraStatusMsg.Should().BeEmpty();
        vm.PhotoSizeStatusMsg.Should().BeEmpty();
        vm.RetentionStatusMsg.Should().BeEmpty();
        File.Exists(Path.Combine(_dir.Path, "machine-settings.json")).Should().BeFalse("rien n'a été touché");
    }

    [Fact]
    public void Touching_a_camera_saves_it_at_once()
    {
        var vm = NewViewModel();
        var simulation = vm.AvailableCameras.Single(c => c.Mode == "mock");

        vm.SelectedCamera = simulation;

        Saved().CameraMode.Should().Be("mock");
        _settings.Camera.ForcedSource.Should().Be(CameraSource.Mock);
        vm.CameraStatusMsg.Should().StartWith("✓ Caméra : Simulation (test)").And.Contain("redémarrez la borne");
    }

    [Fact]
    public void Touching_a_photo_size_saves_it_at_once()
    {
        var vm = NewViewModel();

        vm.SelectedPhotoSize = vm.PhotoSizes[0];

        Saved().CanonPhotoSize.Should().Be(CanonPhotoSize.Small);
        vm.PhotoSizeStatusMsg.Should().StartWith("✓ Photos du Canon : Petite");
    }

    [Fact]
    public void Touching_a_retention_delay_saves_it_at_once()
    {
        var vm = NewViewModel();
        var other = vm.RetentionOptions.First(o => o != vm.SelectedRetention);

        vm.SelectedRetention = other;

        Saved().EventRetentionDays.Should().Be(other.Days);
        vm.RetentionStatusMsg.Should().StartWith("✓").And.Contain($"{other.Days} jours");
    }

    [Theory]
    [InlineData(true, null, Visibility.Visible)]
    [InlineData(false, null, Visibility.Collapsed)]
    [InlineData("✓ Enregistré", null, Visibility.Visible)]
    [InlineData("", null, Visibility.Collapsed)]
    [InlineData(null, null, Visibility.Collapsed)]
    [InlineData(true, "invert", Visibility.Collapsed)]
    [InlineData("", "invert", Visibility.Visible)]
    public void Status_messages_show_only_when_not_empty(object? value, string? parameter, Visibility expected)
    {
        new BoolToVisibilityConverter().Convert(value!, typeof(Visibility), parameter!, CultureInfo.InvariantCulture)
            .Should().Be(expected);
    }
}
