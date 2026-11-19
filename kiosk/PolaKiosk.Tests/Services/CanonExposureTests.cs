using FluentAssertions;
using PolaKiosk.Models;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Codes Canon des réglages d'exposition → libellés, repli, synchro flash, kelvins (LAB-427).</summary>
public class CanonExposureTests
{
    [Theory]
    [InlineData(0x70, "1/125")]
    [InlineData(0x75, "1/200")]
    [InlineData(0x98, "1/4000")]
    [InlineData(0xA0, "1/8000")]
    [InlineData(0x40, "0\"5")]
    [InlineData(0x38, "1\"")]
    [InlineData(0x10, "30\"")]
    [InlineData(0x0C, "Bulb")]
    public void Shutter_speed_labels_follow_the_camera(int code, string label)
        => CanonExposure.TvLabel(code).Should().Be(label);

    [Theory]
    [InlineData(0x2B, "4,5")]
    [InlineData(0x30, "5,6")]
    [InlineData(0x40, "11")]
    [InlineData(0x18, "2")]
    public void Aperture_labels_use_a_decimal_comma_without_f(int code, string label)
        => CanonExposure.AvLabel(code).Should().Be(label);

    [Theory]
    [InlineData(0x00, "Auto")]
    [InlineData(0x48, "100")]
    [InlineData(0x68, "1600")]
    public void Iso_labels(int code, string label) => CanonExposure.IsoLabel(code).Should().Be(label);

    [Theory]
    [InlineData(0, "Auto")]
    [InlineData(1, "Lumière du jour")]
    [InlineData(8, "Ombre")]
    [InlineData(2, "Nuageux")]
    [InlineData(3, "Tungstène")]
    [InlineData(4, "Fluorescent")]
    [InlineData(5, "Flash")]
    [InlineData(9, "Température de couleur")]
    [InlineData(6, "Personnalisée")]
    public void White_balance_labels_are_french(int code, string label)
        => CanonExposure.WbLabel(code).Should().Be(label);

    [Fact]
    public void Color_temperature_white_balance_code_is_9()
        => CanonExposure.WbColorTemperature.Should().Be(9);

    [Theory]
    [InlineData(3, "M")]
    [InlineData(2, "Av")]
    [InlineData(1, "Tv")]
    [InlineData(0, "P")]
    [InlineData(9, "Auto")]
    [InlineData(22, "Auto")]
    [InlineData(10, "Scène")]
    [InlineData(40, "Scène")]
    [InlineData(-1, "Inconnu")]
    public void Mode_labels_are_short_canon_labels(int code, string label)
        => CanonExposure.ModeLabel(code).Should().Be(label);

    [Fact]
    public void Only_manual_mode_is_settable()
    {
        CanonExposure.IsManual(3).Should().BeTrue();
        CanonExposure.IsManual(2).Should().BeFalse();
        CanonExposure.IsManual(null).Should().BeFalse();
    }

    [Fact]
    public void Unknown_codes_give_a_readable_fallback_never_an_exception()
    {
        CanonExposure.TvLabel(0x5A).Should().Be("Vitesse (code 0x5A)");
        CanonExposure.AvLabel(0xFE).Should().Be("Ouverture (code 0xFE)");
        CanonExposure.IsoLabel(0x01).Should().Be("ISO (code 0x01)");
        CanonExposure.WbLabel(77).Should().Be("Balance (code 0x4D)");
        CanonExposure.ModeLabel(1000).Should().Be("Mode (code 0x3E8)");
        CanonExposure.TvLabel(CanonExposure.Invalid).Should().Be("—");
        CanonExposure.Label("autre", 5).Should().Be("Valeur (code 0x05)");
    }

    [Theory]
    [InlineData(0x70, false)] // 1/125
    [InlineData(0x75, false)] // 1/200 : la synchro elle-même
    [InlineData(0x78, true)]  // 1/250
    [InlineData(0x98, true)]  // 1/4000
    [InlineData(0x0C, false)] // Bulb
    public void Faster_than_flash_sync_is_beyond_1_200(int code, bool faster)
        => CanonExposure.IsFasterThanFlashSync(code).Should().Be(faster);

    [Fact]
    public void Missing_or_invalid_speed_is_not_faster_than_flash_sync()
    {
        CanonExposure.IsFasterThanFlashSync(null).Should().BeFalse();
        CanonExposure.IsFasterThanFlashSync(CanonExposure.Invalid).Should().BeFalse();
    }

    [Fact]
    public void Kelvin_list_goes_from_2500_to_10000_by_100()
    {
        var options = CanonExposure.KelvinOptions();

        options.Should().HaveCount(76);
        options[0].Should().Be(new CameraOption(2500, "2500 K"));
        options[^1].Should().Be(new CameraOption(10000, "10000 K"));
        options.Should().Contain(new CameraOption(5600, "5600 K"));
    }

    [Theory]
    [InlineData(5600, true)]
    [InlineData(2500, true)]
    [InlineData(10000, true)]
    [InlineData(2400, false)]
    [InlineData(10100, false)]
    [InlineData(5650, false)]
    public void Valid_kelvins(int kelvin, bool valid) => CanonExposure.IsValidKelvin(kelvin).Should().Be(valid);

    [Fact]
    public void Options_keep_the_camera_order_without_invalid_codes_or_duplicates()
    {
        var options = CanonExposure.Options(CameraExposureKeys.Tv, [0x70, CanonExposure.Invalid, 0x75, 0x70, 0x5A]);

        options.Should().Equal(
            new CameraOption(0x70, "1/125"),
            new CameraOption(0x75, "1/200"),
            new CameraOption(0x5A, "Vitesse (code 0x5A)"));
    }

    [Fact]
    public void Label_dispatches_on_the_contract_keys()
    {
        CanonExposure.Label(CameraExposureKeys.Tv, 0x70).Should().Be("1/125");
        CanonExposure.Label(CameraExposureKeys.Av, 0x30).Should().Be("5,6");
        CanonExposure.Label(CameraExposureKeys.Iso, 0x48).Should().Be("100");
        CanonExposure.Label(CameraExposureKeys.Wb, 1).Should().Be("Lumière du jour");
        CanonExposure.Label(CameraExposureKeys.Kelvin, 5600).Should().Be("5600 K");
    }

    [Fact]
    public void Refusal_messages_name_the_refused_values()
    {
        EdsdkCameraService.RefusedMessage(
            [EdsdkCameraService.DescribeForMessage(CameraExposureKeys.Tv, 0x98),
             EdsdkCameraService.DescribeForMessage(CameraExposureKeys.Iso, 0x68),
             EdsdkCameraService.DescribeForMessage(CameraExposureKeys.Av, 0x30)])
            .Should().Be("L'appareil a refusé 1/4000, ISO 1600, ouverture 5,6.");
    }
}
