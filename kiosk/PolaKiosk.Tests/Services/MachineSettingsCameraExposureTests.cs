using System.Text.Json;
using FluentAssertions;
using PolaKiosk.Models;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-427 : réglages de l'appareil gardés par borne dans machine-settings.json.
public sealed class MachineSettingsCameraExposureTests : IDisposable
{
    private static readonly DateTimeOffset ChangedAt = new(2026, 11, 19, 14, 0, 0, TimeSpan.Zero);

    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    [Fact]
    public void Saved_exposure_survives_a_restart()
    {
        var values = new CameraExposureValues { Tv = 0x70, Av = 0x30, Iso = 0x48, Wb = 9, Kelvin = 5600 };
        new MachineSettingsService(_dir.Path).SetCameraExposure(values, ChangedAt);

        var reloaded = new MachineSettingsService(_dir.Path).Current.CameraExposure;
        reloaded.Should().NotBeNull();
        reloaded!.Values.Should().Be(values);
        reloaded.ChangedAt.Should().Be(ChangedAt);
    }

    [Fact]
    public void Saving_exposure_keeps_the_other_settings()
    {
        var service = new MachineSettingsService(_dir.Path);
        service.SetPrinterName("DNP");
        service.SetCamera("canon", null);

        service.SetCameraExposure(new CameraExposureValues { Tv = 0x75 }, ChangedAt);

        var reloaded = new MachineSettingsService(_dir.Path).Current;
        reloaded.PrinterName.Should().Be("DNP");
        reloaded.CameraMode.Should().Be("canon");
        reloaded.CameraExposure!.Values.Tv.Should().Be(0x75);
        reloaded.CameraExposure.Values.Av.Should().BeNull();
    }

    [Fact]
    public void A_file_without_exposure_is_read_as_none()
    {
        File.WriteAllText(_dir.File("machine-settings.json"), """{ "PrinterName": "DNP" }""");

        new MachineSettingsService(_dir.Path).Current.CameraExposure.Should().BeNull();
    }

    [Fact]
    public void Exposure_values_are_written_with_their_contract_names()
    {
        new MachineSettingsService(_dir.Path)
            .SetCameraExposure(new CameraExposureValues { Tv = 0x70, Kelvin = 5600 }, ChangedAt);

        using var json = JsonDocument.Parse(File.ReadAllText(_dir.File("machine-settings.json")));
        var exposure = json.RootElement.GetProperty("CameraExposure");
        exposure.GetProperty("Values").GetProperty("Tv").GetInt32().Should().Be(0x70);
        exposure.GetProperty("Values").GetProperty("Kelvin").GetInt32().Should().Be(5600);
        exposure.GetProperty("ChangedAt").GetDateTimeOffset().Should().Be(ChangedAt);
    }
}
