using FluentAssertions;
using PolaKiosk.EDSDK;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Réglage Admin « Photos du Canon » → valeur EDSDK kEdsPropID_ImageQuality.</summary>
public class CanonPhotoSizeTests
{
    [Theory]
    [InlineData(CanonPhotoSize.Small,  EdsImageQuality.S1JF)]
    [InlineData(CanonPhotoSize.Medium, EdsImageQuality.MJF)]
    [InlineData(CanonPhotoSize.Full,   EdsImageQuality.LJF)]
    [InlineData(null,                  EdsImageQuality.MJF)]
    [InlineData("",                    EdsImageQuality.MJF)]
    [InlineData("raw",                 EdsImageQuality.MJF)]
    public void ToEdsImageQuality_maps_the_admin_setting(string? size, uint expected)
        => CanonPhotoSize.ToEdsImageQuality(size).Should().Be(expected);

    [Fact]
    public void EdsImageQuality_values_match_the_EDSDK_header()
    {
        EdsPropID.ImageQuality.Should().Be(0x00000100u);
        EdsImageQuality.LJF.Should().Be(0x0013ff0fu);
        EdsImageQuality.MJF.Should().Be(0x0113ff0fu);
        EdsImageQuality.S1JF.Should().Be(0x0E13ff0fu);
    }

    [Fact]
    public void MachineSettings_persists_the_photo_size_and_the_retention_delay()
    {
        using var dir = new TempDir();
        var svc = new MachineSettingsService(dir.Path);
        svc.Current.CanonPhotoSize.Should().BeNull();

        svc.SetCanonPhotoSize(CanonPhotoSize.Small);
        svc.SetEventRetentionDays(60);

        var reloaded = new MachineSettingsService(dir.Path).Current;
        reloaded.CanonPhotoSize.Should().Be(CanonPhotoSize.Small);
        reloaded.EventRetentionDays.Should().Be(60);
    }
}
