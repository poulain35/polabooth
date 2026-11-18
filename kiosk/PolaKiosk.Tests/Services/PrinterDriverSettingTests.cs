using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Réglages du pilote enregistrés : contrôle du DEVMODE, imprimante, pilote (LAB-334).</summary>
public class PrinterDriverSettingTests
{
    internal const string Printer = "DNP DS620";
    internal const int DriverSize = 220 + 1000; // dmSize + dmDriverExtra du pilote installé
    private static readonly DateTimeOffset At = new(2026, 11, 15, 9, 30, 0, TimeSpan.Zero);

    /// <summary>DEVMODE factice : en-tête cohérent (dmSize, dmDriverExtra), contenu marqué par <paramref name="marker"/>.</summary>
    internal static byte[] DevMode(ushort size = 220, ushort extra = 1000, byte marker = 7)
    {
        var bytes = new byte[size + extra];
        Array.Fill(bytes, marker);
        BitConverter.GetBytes(size).CopyTo(bytes, DriverSettingCheck.SizeOffset);
        BitConverter.GetBytes(extra).CopyTo(bytes, DriverSettingCheck.DriverExtraOffset);
        return bytes;
    }

    internal static PrinterDriverSetting Setting(string kind, string printer = Printer, byte marker = 7, DateTimeOffset? at = null)
        => PrinterDriverSetting.Create(printer, kind, DevMode(marker: marker), at ?? At);

    [Fact]
    public void Create_keeps_the_whole_devmode_in_base64_with_its_size()
    {
        var devMode = DevMode();
        var setting = PrinterDriverSetting.Create(Printer, PrinterDriverSettingKind.StripCut, devMode, At);

        setting.PrinterName.Should().Be(Printer);
        setting.Kind.Should().Be("strip-cut");
        setting.Size.Should().Be(1220);
        Convert.FromBase64String(setting.DevMode).Should().Equal(devMode);
        setting.SavedAt.Should().Be(At);
    }

    [Fact]
    public void Consistent_devmode_declares_its_own_length()
    {
        DriverSettingCheck.DeclaredSize(DevMode()).Should().Be(1220);
        DriverSettingCheck.IsConsistent(DevMode()).Should().BeTrue();
        DriverSettingCheck.IsConsistent(DevMode(extra: 0)).Should().BeTrue();
    }

    [Fact]
    public void Truncated_or_inconsistent_devmode_is_refused()
    {
        DriverSettingCheck.IsConsistent([]).Should().BeFalse();
        DriverSettingCheck.IsConsistent(new byte[40]).Should().BeFalse();
        DriverSettingCheck.DeclaredSize(new byte[40]).Should().Be(0);
        DriverSettingCheck.IsConsistent(DevMode()[..1000]).Should().BeFalse("le tampon est plus court que la taille annoncée");
        DriverSettingCheck.IsConsistent([.. DevMode(), 0]).Should().BeFalse("le tampon est plus long que la taille annoncée");
        DriverSettingCheck.IsConsistent(DevMode(size: 10, extra: 100)).Should().BeFalse("dmSize plus petit que l'en-tête");
    }

    [Fact]
    public void Valid_setting_gives_back_the_devmode()
    {
        var status = DriverSettingCheck.Validate(Setting(PrinterDriverSettingKind.StripCut), Printer, DriverSize, out var devMode);

        status.Should().Be(DriverSettingStatus.Valid);
        devMode.Should().Equal(DevMode());
    }

    [Theory]
    [InlineData(" dnp ds620 ")]
    [InlineData("DNP DS620")]
    public void Printer_name_ignores_case_and_spaces(string printer)
        => DriverSettingCheck.Validate(Setting(PrinterDriverSettingKind.Normal), printer, DriverSize, out _)
            .Should().Be(DriverSettingStatus.Valid);

    [Fact]
    public void Setting_of_another_printer_is_refused()
    {
        DriverSettingCheck.Validate(Setting(PrinterDriverSettingKind.StripCut), "DNP RX1-HS", DriverSize, out var devMode)
            .Should().Be(DriverSettingStatus.OtherPrinter);
        devMode.Should().BeNull();
    }

    [Theory]
    [InlineData("pas du base64 !")]
    [InlineData("")]
    public void Unreadable_base64_is_refused(string base64)
    {
        var setting = Setting(PrinterDriverSettingKind.StripCut) with { DevMode = base64 };

        DriverSettingCheck.Validate(setting, Printer, DriverSize, out var devMode).Should().Be(DriverSettingStatus.Unreadable);
        devMode.Should().BeNull();
    }

    [Fact]
    public void Inconsistent_devmode_in_the_file_is_refused()
    {
        var truncated = Setting(PrinterDriverSettingKind.StripCut) with { DevMode = Convert.ToBase64String(DevMode()[..500]) };
        DriverSettingCheck.Validate(truncated, Printer, DriverSize, out _).Should().Be(DriverSettingStatus.Unreadable);

        var wrongSize = Setting(PrinterDriverSettingKind.StripCut) with { Size = 999 };
        DriverSettingCheck.Validate(wrongSize, Printer, DriverSize, out _).Should().Be(DriverSettingStatus.Unreadable);
    }

    [Theory]
    [InlineData(1500)]
    [InlineData(0)]
    public void Setting_of_another_driver_or_unknown_driver_is_refused(int installedSize)
    {
        DriverSettingCheck.Validate(Setting(PrinterDriverSettingKind.StripCut), Printer, installedSize, out var devMode)
            .Should().Be(DriverSettingStatus.OtherDriver);
        devMode.Should().BeNull();
    }

    [Fact]
    public void Find_takes_the_last_setting_of_the_kind_for_the_printer()
    {
        PrinterDriverSetting[] saved =
        [
            Setting(PrinterDriverSettingKind.StripCut, marker: 1),
            Setting(PrinterDriverSettingKind.Normal, marker: 2),
            Setting(PrinterDriverSettingKind.StripCut, "DNP RX1-HS", marker: 3),
            Setting(PrinterDriverSettingKind.StripCut, marker: 4),
        ];

        var cut = DriverSettingCheck.Find(saved, PrinterDriverSettingKind.StripCut, Printer, DriverSize);
        cut.Status.Should().Be(DriverSettingStatus.Valid);
        cut.DevMode.Should().Equal(DevMode(marker: 4));

        var normal = DriverSettingCheck.Find(saved, PrinterDriverSettingKind.Normal, Printer, DriverSize);
        normal.DevMode.Should().Equal(DevMode(marker: 2));

        var rx = DriverSettingCheck.Find(saved, PrinterDriverSettingKind.StripCut, "DNP RX1-HS", DriverSize);
        rx.DevMode.Should().Equal(DevMode(marker: 3));
    }

    [Fact]
    public void Find_reports_a_setting_kept_for_another_printer()
    {
        var lookup = DriverSettingCheck.Find([Setting(PrinterDriverSettingKind.StripCut, "DNP RX1-HS")],
            PrinterDriverSettingKind.StripCut, Printer, DriverSize);

        lookup.Status.Should().Be(DriverSettingStatus.OtherPrinter);
        lookup.DevMode.Should().BeNull();
        lookup.Setting!.PrinterName.Should().Be("DNP RX1-HS");
    }

    [Fact]
    public void Find_without_setting_of_the_kind_is_missing()
    {
        DriverSettingCheck.Find(null, PrinterDriverSettingKind.StripCut, Printer, DriverSize).Status
            .Should().Be(DriverSettingStatus.Missing);
        DriverSettingCheck.Find([Setting(PrinterDriverSettingKind.Normal)], PrinterDriverSettingKind.StripCut, Printer, DriverSize).Status
            .Should().Be(DriverSettingStatus.Missing);
        DriverSettingCheck.Find([null!], PrinterDriverSettingKind.StripCut, Printer, DriverSize).Status
            .Should().Be(DriverSettingStatus.Missing, "une ligne vide du fichier est ignorée");
    }

    [Fact]
    public void Machine_settings_keep_one_setting_per_printer_and_kind()
    {
        using var dir = new TempDir();
        var svc = new MachineSettingsService(dir.Path);
        svc.Current.PrinterDriverSettings.Should().BeNull();

        svc.SetPrinterDriverSetting(Setting(PrinterDriverSettingKind.StripCut, marker: 1));
        svc.SetPrinterDriverSetting(Setting(PrinterDriverSettingKind.Normal, marker: 2));
        svc.SetPrinterDriverSetting(Setting(PrinterDriverSettingKind.StripCut, "DNP RX1-HS", marker: 3));
        svc.SetPrinterDriverSetting(Setting(PrinterDriverSettingKind.StripCut, "dnp ds620", marker: 4));

        var reloaded = new MachineSettingsService(dir.Path).Current.PrinterDriverSettings;
        reloaded.Should().HaveCount(3);
        var cut = DriverSettingCheck.Find(reloaded, PrinterDriverSettingKind.StripCut, Printer, DriverSize);
        cut.Status.Should().Be(DriverSettingStatus.Valid);
        cut.DevMode.Should().Equal(DevMode(marker: 4), "le nouveau réglage remplace l'ancien");
        cut.Setting!.SavedAt.Should().Be(At);
        DriverSettingCheck.Find(reloaded, PrinterDriverSettingKind.Normal, Printer, DriverSize).DevMode
            .Should().Equal(DevMode(marker: 2));
        DriverSettingCheck.Find(reloaded, PrinterDriverSettingKind.StripCut, "DNP RX1-HS", DriverSize).DevMode
            .Should().Equal(DevMode(marker: 3));
    }

    [Fact]
    public void Machine_settings_keep_the_other_settings_when_a_driver_setting_is_saved()
    {
        using var dir = new TempDir();
        var svc = new MachineSettingsService(dir.Path);
        svc.SetPrinterName(Printer);
        svc.SetEventRetentionDays(60);

        svc.SetPrinterDriverSetting(Setting(PrinterDriverSettingKind.StripCut));

        var reloaded = new MachineSettingsService(dir.Path).Current;
        reloaded.PrinterName.Should().Be(Printer);
        reloaded.EventRetentionDays.Should().Be(60);
        reloaded.PrinterDriverSettings.Should().ContainSingle();
    }
}
