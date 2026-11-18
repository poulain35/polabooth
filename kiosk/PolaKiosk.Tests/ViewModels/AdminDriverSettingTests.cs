using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;
using static PolaKiosk.Tests.Services.PrinterDriverSettingTests;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Admin → Imprimante : enregistrer les réglages « bandes coupées » et « normal » du pilote (LAB-334).</summary>
public sealed class AdminDriverSettingTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 11, 15, 9, 30, 0, TimeSpan.Zero); // 10 h 30 à Paris

    private readonly TempDir _dir = new();
    private readonly MachineSettingsService _machine;
    private readonly AppSettings _settings = new();
    private readonly Mock<IPrintService> _print = new();
    private readonly Mock<IPrinterDriver> _driver = new();

    public AdminDriverSettingTests()
    {
        _machine = new MachineSettingsService(_dir.Path);
        _settings.Kiosk.PrinterName = Printer;
        _print.Setup(p => p.GetAvailablePrinters()).Returns([Printer, "DNP RX1-HS"]);
        _print.Setup(p => p.GetDefaultPrinterName()).Returns("DNP RX1-HS");
        _driver.Setup(d => d.GetDevModeSize(It.IsAny<string>())).Returns(DriverSize);
    }

    public void Dispose() => _dir.Dispose();

    private AdminViewModel NewViewModel()
    {
        var history = new Mock<IPolaHistory>();
        history.Setup(h => h.List()).Returns([]);
        var cameras = new Mock<ICameraDetectionService>();
        cameras.Setup(c => c.DetectAvailableCameras()).Returns([]);
        var clock = new Mock<TimeProvider>();
        clock.Setup(c => c.GetUtcNow()).Returns(Now);

        return new AdminViewModel(Mock.Of<IKioskStateService>(), Mock.Of<INavigationService>(), Mock.Of<ISyncService>(),
            Mock.Of<IKioskService>(), _print.Object, _machine, cameras.Object, _settings,
            Mock.Of<ISaasSwitchService>(), Mock.Of<IAppRestart>(), history.Object, _driver.Object, clock: clock.Object);
    }

    [Fact]
    public void Validated_cut_setting_is_saved_for_the_printer()
    {
        _driver.Setup(d => d.Prompt(Printer, null)).Returns(DevMode(marker: 5));
        var vm = NewViewModel();
        vm.StripCutSettingStatus.Should().StartWith("Bandes coupées : non enregistré");

        vm.RecordStripCutSettingCommand.Execute(null);

        var saved = new MachineSettingsService(_dir.Path).Current.PrinterDriverSettings;
        var lookup = DriverSettingCheck.Find(saved, PrinterDriverSettingKind.StripCut, Printer, DriverSize);
        lookup.Status.Should().Be(DriverSettingStatus.Valid);
        lookup.DevMode.Should().Equal(DevMode(marker: 5));
        lookup.Setting!.SavedAt.Should().Be(Now);
        vm.DriverSettingMsg.Should().StartWith("✓").And.Contain("bandes coupées").And.Contain(Printer);
        vm.StripCutSettingStatus.Should().Be($"Bandes coupées : enregistré le 15 novembre 2026 à 10:30 pour « {Printer} ».");
        vm.NormalSettingStatus.Should().StartWith("Normal : non enregistré");
    }

    [Fact]
    public void Recording_again_starts_from_the_saved_setting()
    {
        _machine.SetPrinterDriverSetting(Setting(PrinterDriverSettingKind.Normal, marker: 2));
        _driver.Setup(d => d.Prompt(Printer, It.IsAny<byte[]?>())).Returns(DevMode(marker: 6));
        var vm = NewViewModel();

        vm.RecordNormalSettingCommand.Execute(null);

        var previous = DevMode(marker: 2);
        _driver.Verify(d => d.Prompt(Printer, It.Is<byte[]?>(b => b != null && b.SequenceEqual(previous))));
        DriverSettingCheck.Find(_machine.Current.PrinterDriverSettings, PrinterDriverSettingKind.Normal, Printer, DriverSize)
            .DevMode.Should().Equal(DevMode(marker: 6));
        _machine.Current.PrinterDriverSettings.Should().ContainSingle();
    }

    [Fact]
    public void Cancelled_window_changes_nothing()
    {
        _driver.Setup(d => d.Prompt(Printer, null)).Returns((byte[]?)null);
        var vm = NewViewModel();

        vm.RecordStripCutSettingCommand.Execute(null);

        _machine.Current.PrinterDriverSettings.Should().BeNull();
        vm.DriverSettingMsg.Should().Be("Fenêtre fermée sans valider : le réglage « bandes coupées » n'a pas changé.");
    }

    [Fact]
    public void Driver_window_error_is_explained_with_an_instruction()
    {
        _driver.Setup(d => d.Prompt(Printer, null)).Throws(new InvalidOperationException("pilote absent"));
        var vm = NewViewModel();

        vm.RecordStripCutSettingCommand.Execute(null);

        _machine.Current.PrinterDriverSettings.Should().BeNull();
        vm.DriverSettingMsg.Should().StartWith("✗").And.Contain("pilote absent").And.Contain("Vérifiez que l'imprimante est allumée");
    }

    [Fact]
    public void Unreadable_answer_of_the_driver_is_not_saved()
    {
        _driver.Setup(d => d.Prompt(Printer, null)).Returns(new byte[30]);
        var vm = NewViewModel();

        vm.RecordStripCutSettingCommand.Execute(null);

        _machine.Current.PrinterDriverSettings.Should().BeNull();
        vm.DriverSettingMsg.Should().StartWith("✗").And.Contain("illisible");
    }

    [Fact]
    public void Printer_chosen_but_not_saved_is_asked_to_be_saved_first()
    {
        var vm = NewViewModel();
        vm.SelectedPrinter = "DNP RX1-HS";

        vm.RecordStripCutSettingCommand.Execute(null);

        _driver.Verify(d => d.Prompt(It.IsAny<string>(), It.IsAny<byte[]?>()), Times.Never);
        vm.DriverSettingMsg.Should().StartWith("✗ Enregistrez d'abord l'imprimante choisie");
    }

    [Fact]
    public void System_default_printer_is_the_one_whose_driver_opens()
    {
        _settings.Kiosk.PrinterName = "";
        _driver.Setup(d => d.Prompt("DNP RX1-HS", null)).Returns(DevMode());
        var vm = NewViewModel();

        vm.RecordStripCutSettingCommand.Execute(null);

        _machine.Current.PrinterDriverSettings.Should().ContainSingle().Which.PrinterName.Should().Be("DNP RX1-HS");
    }

    [Fact]
    public void No_printer_at_all_is_explained()
    {
        _settings.Kiosk.PrinterName = "";
        _print.Setup(p => p.GetDefaultPrinterName()).Returns("");
        var vm = NewViewModel();

        vm.RecordStripCutSettingCommand.Execute(null);

        _driver.Verify(d => d.Prompt(It.IsAny<string>(), It.IsAny<byte[]?>()), Times.Never);
        vm.DriverSettingMsg.Should().StartWith("✗ Aucune imprimante trouvée");
    }

    [Fact]
    public void Saving_another_printer_refreshes_the_statuses()
    {
        _machine.SetPrinterDriverSetting(Setting(PrinterDriverSettingKind.StripCut));
        var vm = NewViewModel();
        vm.StripCutSettingStatus.Should().StartWith("Bandes coupées : enregistré le");

        vm.SelectedPrinter = "DNP RX1-HS";
        vm.SavePrinterCommand.Execute(null);

        vm.StripCutSettingStatus.Should().Contain("autre imprimante").And.Contain("« DNP DS620 »").And.Contain("À enregistrer pour « DNP RX1-HS »");
    }

    [Fact]
    public void Status_texts_explain_each_case()
    {
        var setting = Setting(PrinterDriverSettingKind.Normal);
        DriverSettingText.Status(new(DriverSettingStatus.Missing, null, null), PrinterDriverSettingKind.StripCut, Printer)
            .Should().Be("Bandes coupées : non enregistré ; les bandes sortent seules en taille 2x6, sans être doublées.");
        DriverSettingText.Status(new(DriverSettingStatus.Missing, null, null), PrinterDriverSettingKind.Normal, Printer)
            .Should().Be("Normal : non enregistré ; les 10x15 utilisent le réglage par défaut du pilote.");
        DriverSettingText.Status(new(DriverSettingStatus.OtherDriver, null, setting), PrinterDriverSettingKind.Normal, Printer)
            .Should().Contain("le pilote de l'imprimante a changé").And.EndWith("À enregistrer à nouveau.");
        DriverSettingText.Status(new(DriverSettingStatus.Unreadable, null, setting), PrinterDriverSettingKind.Normal, Printer)
            .Should().Contain("illisible").And.EndWith("À enregistrer à nouveau.");
    }
}
