using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-433 : le décalage de l'impression est gardé par borne dans machine-settings.json.
public sealed class MachineSettingsPrintAdjustmentTests : IDisposable
{
    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    [Fact]
    public void Saved_adjustment_survives_a_restart_and_keeps_the_other_settings()
    {
        var machine = new MachineSettingsService(_dir.Path);
        machine.SetPrinterName("DNP DS620");
        machine.SetPrintAdjustment(new PrintAdjustment { OffsetXMm = 1.5, OffsetYMm = -0.5, EnlargePercent = 1 });

        var reloaded = new MachineSettingsService(_dir.Path).Current;
        reloaded.PrintAdjustment.Should().Be(new PrintAdjustment { OffsetXMm = 1.5, OffsetYMm = -0.5, EnlargePercent = 1 });
        reloaded.PrinterName.Should().Be("DNP DS620");
    }

    [Fact]
    public void Values_are_bounded_and_zero_removes_the_setting()
    {
        var machine = new MachineSettingsService(_dir.Path);
        machine.SetPrintAdjustment(new PrintAdjustment { OffsetXMm = 40 });
        machine.Current.PrintAdjustment!.OffsetXMm.Should().Be(PrintAdjust.MaxOffsetMm);

        machine.SetPrintAdjustment(PrintAdjust.Zero);
        new MachineSettingsService(_dir.Path).Current.PrintAdjustment.Should().BeNull();
    }
}
