using FluentAssertions;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-197 : en production, mode kiosk actif et aucun PIN admin par défaut.
public class KioskSettingsTests
{
    private static JObject ReadSettings(string fileName)
        => JObject.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, fileName)));

    [Fact]
    public void Kiosk_mode_is_on_by_default()
    {
        new AppSettings().Kiosk.KioskMode.Should().BeTrue();
        ReadSettings("appsettings.json")["Kiosk"]!["KioskMode"]!.Value<bool>().Should().BeTrue();
    }

    [Fact]
    public void There_is_no_default_admin_pin()
    {
        typeof(KioskSettings).GetProperty("AdminPin").Should().BeNull();
        new AppSettings().Kiosk.DevAdminPin.Should().BeEmpty();

        var kiosk = (JObject)ReadSettings("appsettings.json")["Kiosk"]!;
        kiosk.ContainsKey("AdminPin").Should().BeFalse();
        kiosk.ContainsKey("DevAdminPin").Should().BeFalse();
    }

    [Fact]
    public void The_dev_pin_and_windowed_mode_only_live_in_the_development_settings()
    {
        var kiosk = ReadSettings("appsettings.Development.json")["Kiosk"]!;
        kiosk["KioskMode"]!.Value<bool>().Should().BeFalse();
        kiosk["DevAdminPin"]!.ToString().Should().NotBeEmpty();
    }

    [Fact]
    public void A_production_service_without_dev_pin_is_not_configured()
    {
        using var dir = new TempDir();
        var service = new AdminPinService(new Mock<ISupabaseService>().Object, dir.Path, devPin: null);

        service.IsConfigured.Should().BeFalse();
    }
}
