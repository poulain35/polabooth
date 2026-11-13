using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// Open core K2 : adresse du SaaS conservée dans machine-settings.json.
public sealed class MachineSettingsSaasAddressTests : IDisposable
{
    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    [Fact]
    public void Saved_address_survives_a_restart()
    {
        new MachineSettingsService(_dir.Path)
            .SetSaasAddress(" https://photobooth.mon-entreprise.fr ", "https://abc.supabase.co", " cle-anon ");

        var reloaded = new MachineSettingsService(_dir.Path).Current;
        reloaded.SaasUrl.Should().Be("https://photobooth.mon-entreprise.fr");
        reloaded.SupabaseUrl.Should().Be("https://abc.supabase.co");
        reloaded.SupabaseAnonKey.Should().Be("cle-anon");
    }

    [Fact]
    public void Hand_written_lowercase_keys_are_read()
    {
        File.WriteAllText(_dir.File("machine-settings.json"), """
            { "printerName": "DNP", "supabaseUrl": "https://abc.supabase.co", "supabaseAnonKey": "cle-anon" }
            """);

        var current = new MachineSettingsService(_dir.Path).Current;
        current.SupabaseUrl.Should().Be("https://abc.supabase.co");
        current.SupabaseAnonKey.Should().Be("cle-anon");
        current.PrinterName.Should().Be("DNP");
    }

    [Fact]
    public void Clearing_keeps_the_other_settings()
    {
        var service = new MachineSettingsService(_dir.Path);
        service.SetPrinterName("DNP");
        service.SetEventRetentionDays(30);
        service.SetSaasAddress("https://photobooth.mon-entreprise.fr", "https://abc.supabase.co", "cle-anon");

        service.ClearSaasAddress();

        var reloaded = new MachineSettingsService(_dir.Path).Current;
        reloaded.SupabaseUrl.Should().BeNull();
        reloaded.SupabaseAnonKey.Should().BeNull();
        reloaded.SaasUrl.Should().BeNull();
        reloaded.PrinterName.Should().Be("DNP");
        reloaded.EventRetentionDays.Should().Be(30);
    }

    [Theory]
    [InlineData("", "https://abc.supabase.co", "k")]
    [InlineData("https://saas.fr", " ", "k")]
    [InlineData("https://saas.fr", "https://abc.supabase.co", "")]
    public void Incomplete_address_is_refused(string saasUrl, string supabaseUrl, string key)
    {
        var service = new MachineSettingsService(_dir.Path);

        var act = () => service.SetSaasAddress(saasUrl, supabaseUrl, key);

        act.Should().Throw<ArgumentException>();
        service.Current.SupabaseUrl.Should().BeNull();
    }
}
