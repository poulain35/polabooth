using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Admin → Imprimante : décalage de l'impression et feuille de test (LAB-433).</summary>
public sealed class AdminPrintAdjustmentTests : IDisposable
{
    private const string Printer = "DNP DS620";

    private readonly TempDir _dir = new();
    private readonly MachineSettingsService _machine;
    private readonly AppSettings _settings = new();
    private readonly Mock<IPrintService> _print = new();

    public AdminPrintAdjustmentTests()
    {
        _machine = new MachineSettingsService(_dir.Path);
        _settings.Kiosk.PrinterName = Printer;
        _print.Setup(p => p.GetAvailablePrinters()).Returns([Printer]);
        _print.Setup(p => p.GetDefaultPrinterName()).Returns(Printer);
    }

    public void Dispose() => _dir.Dispose();

    private AdminViewModel NewViewModel()
    {
        var history = new Mock<IPolaHistory>();
        history.Setup(h => h.List()).Returns([]);
        var cameras = new Mock<ICameraDetectionService>();
        cameras.Setup(c => c.DetectAvailableCameras()).Returns([]);

        return new AdminViewModel(Mock.Of<IKioskStateService>(), Mock.Of<INavigationService>(), Mock.Of<ISyncService>(),
            Mock.Of<IKioskService>(), _print.Object, _machine, cameras.Object, _settings,
            Mock.Of<ISaasSwitchService>(), Mock.Of<IAppRestart>(), history.Object, Mock.Of<IPrinterDriver>());
    }

    [Fact]
    public void Starts_centred_and_shows_the_saved_setting()
    {
        NewViewModel().OffsetXLabel.Should().Be("centré");

        _machine.SetPrintAdjustment(new PrintAdjustment { OffsetYMm = -1, EnlargePercent = 1.5 });
        var vm = NewViewModel();
        vm.OffsetXLabel.Should().Be("centré");
        vm.OffsetYLabel.Should().Be("1 mm vers le haut");
        vm.EnlargeLabel.Should().Be("1,5 %");
    }

    [Fact]
    public void Each_press_moves_by_half_a_millimetre_and_is_saved_at_once()
    {
        var vm = NewViewModel();

        vm.MoveRightCommand.Execute(null);
        vm.MoveRightCommand.Execute(null);
        vm.MoveRightCommand.Execute(null);
        vm.MoveLeftCommand.Execute(null);
        vm.MoveDownCommand.Execute(null);
        vm.EnlargeMoreCommand.Execute(null);

        vm.OffsetXLabel.Should().Be("1 mm vers la droite");
        vm.OffsetYLabel.Should().Be("0,5 mm vers le bas");
        vm.EnlargeLabel.Should().Be("0,5 %");
        vm.PrintAdjustMsg.Should().StartWith("✓");
        new MachineSettingsService(_dir.Path).Current.PrintAdjustment
            .Should().Be(new PrintAdjustment { OffsetXMm = 1, OffsetYMm = 0.5, EnlargePercent = 0.5 });
    }

    [Fact]
    public void Limit_is_reported_and_reset_centres_again()
    {
        _machine.SetPrintAdjustment(new PrintAdjustment { OffsetXMm = -5 });
        var vm = NewViewModel();

        vm.MoveLeftCommand.Execute(null);
        vm.PrintAdjustMsg.Should().StartWith("Limite atteinte");
        vm.OffsetXLabel.Should().Be("5 mm vers la gauche");

        vm.ResetPrintAdjustmentCommand.Execute(null);
        vm.OffsetXLabel.Should().Be("centré");
        _machine.Current.PrintAdjustment.Should().BeNull();
    }

    [Fact]
    public async Task Test_sheet_goes_to_the_kiosk_printer_with_the_current_setting()
    {
        _machine.SetPrintAdjustment(new PrintAdjustment { OffsetXMm = 1.5 });
        var vm = NewViewModel();

        await vm.PrintTestSheetCommand.ExecuteAsync(null);

        _print.Verify(p => p.PrintTestSheetAsync(Printer, new PrintAdjustment { OffsetXMm = 1.5 }), Times.Once);
        vm.PrintAdjustMsg.Should().Be("✓ Feuille de test envoyée à l'imprimante.");
        vm.IsPrintingTestSheet.Should().BeFalse();
    }

    [Fact]
    public async Task Printer_error_is_shown()
    {
        _print.Setup(p => p.PrintTestSheetAsync(It.IsAny<string>(), It.IsAny<PrintAdjustment?>()))
            .ThrowsAsync(new PrintBusyException());
        var vm = NewViewModel();

        await vm.PrintTestSheetCommand.ExecuteAsync(null);

        vm.PrintAdjustMsg.Should().StartWith("✗").And.Contain("Une impression est encore en cours");
        vm.IsPrintingTestSheet.Should().BeFalse();
    }
}
