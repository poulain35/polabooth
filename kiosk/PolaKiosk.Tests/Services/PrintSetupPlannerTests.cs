using FluentAssertions;
using PolaKiosk.Services;
using static PolaKiosk.Tests.Services.PrinterDriverSettingTests;

namespace PolaKiosk.Tests.Services;

/// <summary>Choix du papier et du réglage du pilote pour chaque impression (LAB-334).</summary>
public class PrintSetupPlannerTests
{
    private static readonly PrinterDriverSetting Cut    = Setting(PrinterDriverSettingKind.StripCut, marker: 1);
    private static readonly PrinterDriverSetting Normal = Setting(PrinterDriverSettingKind.Normal, marker: 2);

    [Fact]
    public void Strip_with_the_cut_setting_is_doubled_on_a_4x6_sheet()
    {
        var setup = PrintSetupPlanner.Plan("2x6", Printer, [Normal, Cut], DriverSize);

        setup.PaperFormat.Should().Be("4x6");
        setup.DoubleStrip.Should().BeTrue();
        setup.DevMode.Should().Equal(DevMode(marker: 1));
        setup.DevModeKind.Should().Be(PrinterDriverSettingKind.StripCut);
        setup.Notes.Should().ContainSingle().Which.IsWarning.Should().BeFalse();
        setup.Notes[0].Key.Should().Be($"{Printer}|strip-cut|ok");
    }

    [Fact]
    public void Strip_without_the_cut_setting_falls_back_to_2x6_with_a_warning()
    {
        var setup = PrintSetupPlanner.Plan("2x6", Printer, null, DriverSize);

        setup.PaperFormat.Should().Be("2x6");
        setup.DoubleStrip.Should().BeFalse();
        setup.DevMode.Should().BeNull("sans réglage enregistré, le réglage par défaut du pilote est gardé");
        setup.DevModeKind.Should().BeNull();
        var note = setup.Notes.Should().ContainSingle().Subject;
        note.IsWarning.Should().BeTrue();
        note.Key.Should().Be($"{Printer}|strip-cut|fallback");
        note.Message.Should().Contain("2x6").And.Contain("Enregistrer le réglage bandes coupées");
    }

    [Fact]
    public void Strip_fallback_uses_the_normal_setting_when_recorded()
    {
        var setup = PrintSetupPlanner.Plan("2x6", Printer, [Normal], DriverSize);

        setup.PaperFormat.Should().Be("2x6");
        setup.DoubleStrip.Should().BeFalse();
        setup.DevMode.Should().Equal(DevMode(marker: 2));
        setup.DevModeKind.Should().Be(PrinterDriverSettingKind.Normal);
    }

    [Theory]
    [InlineData("4x6")]
    [InlineData("6x8")]
    [InlineData("5x7")]
    public void Sheet_uses_the_normal_setting_even_when_a_cut_setting_exists(string format)
    {
        var setup = PrintSetupPlanner.Plan(format, Printer, [Cut, Normal], DriverSize);

        setup.PaperFormat.Should().Be(format);
        setup.DoubleStrip.Should().BeFalse();
        setup.DevMode.Should().Equal(DevMode(marker: 2));
        setup.DevModeKind.Should().Be(PrinterDriverSettingKind.Normal);
        setup.Notes.Should().BeEmpty();
    }

    [Fact]
    public void Sheet_right_after_a_strip_never_reuses_the_cut_setting()
    {
        IReadOnlyList<PrinterDriverSetting> saved = [Cut, Normal];
        PrintSetupPlanner.Plan("2x6", Printer, saved, DriverSize).DevModeKind.Should().Be(PrinterDriverSettingKind.StripCut);

        var next = PrintSetupPlanner.Plan("4x6", Printer, saved, DriverSize);

        next.DevModeKind.Should().Be(PrinterDriverSettingKind.Normal);
        next.DevMode.Should().Equal(DevMode(marker: 2));
    }

    [Fact]
    public void Sheet_without_the_normal_setting_keeps_the_driver_default_without_warning()
    {
        var setup = PrintSetupPlanner.Plan("4x6", Printer, [Cut], DriverSize);

        setup.DevMode.Should().BeNull();
        setup.DevModeKind.Should().BeNull();
        setup.DoubleStrip.Should().BeFalse();
        setup.Notes.Should().BeEmpty("le réglage normal est facultatif");
    }

    [Fact]
    public void Cut_setting_of_another_printer_is_ignored_with_a_warning()
    {
        var setup = PrintSetupPlanner.Plan("2x6", "DNP RX1-HS", [Cut], DriverSize);

        setup.PaperFormat.Should().Be("2x6");
        setup.DoubleStrip.Should().BeFalse();
        setup.DevMode.Should().BeNull();
        setup.Notes.Select(n => n.Key).Should().Equal("DNP RX1-HS|strip-cut|OtherPrinter", "DNP RX1-HS|strip-cut|fallback");
        setup.Notes.Should().OnlyContain(n => n.IsWarning);
        setup.Notes[0].Message.Should().Contain("« DNP DS620 »").And.Contain("Enregistrer le réglage bandes coupées");
    }

    [Fact]
    public void Settings_of_another_driver_are_ignored_with_warnings()
    {
        var setup = PrintSetupPlanner.Plan("2x6", Printer, [Cut, Normal], 1500);

        setup.PaperFormat.Should().Be("2x6");
        setup.DevMode.Should().BeNull();
        setup.Notes.Select(n => n.Key).Should().Equal(
            $"{Printer}|strip-cut|OtherDriver", $"{Printer}|normal|OtherDriver", $"{Printer}|strip-cut|fallback");
        setup.Notes[0].Message.Should().Contain("1220 octets").And.Contain("1500 octets");
    }

    [Fact]
    public void Unknown_driver_size_ignores_the_settings()
    {
        var setup = PrintSetupPlanner.Plan("4x6", Printer, [Normal], 0);

        setup.DevMode.Should().BeNull();
        setup.Notes.Should().ContainSingle().Which.Message.Should().Contain("taille inconnue");
    }

    [Fact]
    public void Unreadable_normal_setting_is_ignored_with_a_warning()
    {
        var broken = Normal with { DevMode = "@@@" };
        var setup = PrintSetupPlanner.Plan("4x6", Printer, [broken], DriverSize);

        setup.DevMode.Should().BeNull();
        var note = setup.Notes.Should().ContainSingle().Subject;
        note.Key.Should().Be($"{Printer}|normal|Unreadable");
        note.Message.Should().Contain("illisible").And.Contain("Enregistrer le réglage normal");
    }
}
