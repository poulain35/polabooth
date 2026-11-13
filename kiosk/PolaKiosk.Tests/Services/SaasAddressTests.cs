using FluentAssertions;
using Newtonsoft.Json.Linq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// Open core K2 : adresse du SaaS saisie sur la borne, lecture de kiosk-config.json, priorité des appsettings.
public class SaasAddressTests
{
    [Theory]
    [InlineData("photobooth.mon-entreprise.fr", "https://photobooth.mon-entreprise.fr")]
    [InlineData("https://photobooth.mon-entreprise.fr", "https://photobooth.mon-entreprise.fr")]
    [InlineData("https://photobooth.mon-entreprise.fr/", "https://photobooth.mon-entreprise.fr")]
    [InlineData("https://photobooth.mon-entreprise.fr/associer/", "https://photobooth.mon-entreprise.fr")]
    [InlineData("photobooth.mon-entreprise.fr/admin?x=1#y", "https://photobooth.mon-entreprise.fr")]
    [InlineData("  Photobooth.Mon-Entreprise.FR  ", "https://photobooth.mon-entreprise.fr")]
    [InlineData("HTTPS://saas.exemple.com", "https://saas.exemple.com")]
    [InlineData("saas.exemple.com:8443/x", "https://saas.exemple.com:8443")]
    public void Address_is_reduced_to_its_https_origin(string input, string expected)
    {
        SaasAddress.TryNormalize(input, out var origin).Should().BeTrue();
        origin.Should().Be(expected);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("http://photobooth.mon-entreprise.fr")]
    [InlineData("ftp://photobooth.mon-entreprise.fr")]
    [InlineData("photo booth.fr")]
    [InlineData("https://")]
    [InlineData("https://user:pass@saas.exemple.com")]
    public void Invalid_addresses_are_refused(string? input)
    {
        SaasAddress.TryNormalize(input, out var origin).Should().BeFalse();
        origin.Should().BeEmpty();
    }

    [Fact]
    public void Config_is_read_at_the_root_of_the_saas()
    {
        SaasAddress.ConfigUri("https://photobooth.mon-entreprise.fr").ToString()
            .Should().Be("https://photobooth.mon-entreprise.fr/kiosk-config.json");
    }

    [Fact]
    public void Valid_config_is_read()
    {
        var config = SaasAddress.ParseConfig("""
            { "supabaseUrl": "https://abc.supabase.co/", "supabaseAnonKey": " cle-anon " }
            """);

        config.Should().Be(new SaasConfig("https://abc.supabase.co", "cle-anon"));
    }

    [Fact]
    public void Unknown_fields_are_ignored()
    {
        SaasAddress.ParseConfig("""{ "supabaseUrl": "https://abc.supabase.co", "supabaseAnonKey": "k", "autre": 1 }""")
            .Should().NotBeNull();
    }

    [Theory]
    [InlineData("")]
    [InlineData("<!doctype html><html></html>")]          // page de l'application à la place du fichier
    [InlineData("{ \"supabaseUrl\": ")]                   // JSON tronqué
    [InlineData("[]")]
    [InlineData("\"texte\"")]
    [InlineData("{}")]
    [InlineData("{ \"supabaseUrl\": \"https://abc.supabase.co\" }")]
    [InlineData("{ \"supabaseAnonKey\": \"k\" }")]
    [InlineData("{ \"supabaseUrl\": \"https://abc.supabase.co\", \"supabaseAnonKey\": \"\" }")]
    [InlineData("{ \"supabaseUrl\": \"https://abc.supabase.co\", \"supabaseAnonKey\": \"   \" }")]
    [InlineData("{ \"supabaseUrl\": \"\", \"supabaseAnonKey\": \"k\" }")]
    [InlineData("{ \"supabaseUrl\": \"http://abc.supabase.co\", \"supabaseAnonKey\": \"k\" }")]
    [InlineData("{ \"supabaseUrl\": \"abc.supabase.co\", \"supabaseAnonKey\": \"k\" }")]
    [InlineData("{ \"supabaseUrl\": 12, \"supabaseAnonKey\": \"k\" }")]
    [InlineData("{ \"supabaseUrl\": \"https://abc.supabase.co\", \"supabaseAnonKey\": null }")]
    public void Invalid_or_incomplete_config_is_refused(string json)
    {
        SaasAddress.ParseConfig(json).Should().BeNull();
    }

    // ── Priorité appsettings > machine-settings.json ───────────────────────

    private static readonly MachineSettings Entered = new()
    {
        SaasUrl         = "https://photobooth.mon-entreprise.fr",
        SupabaseUrl     = "https://saisie.supabase.co",
        SupabaseAnonKey = "cle-saisie",
    };

    private static AppSettings Settings(string url = "", string key = "", string saasUrl = "", string pairingUrl = "")
    {
        var settings = new AppSettings();
        settings.Supabase.Url     = url;
        settings.Supabase.AnonKey = key;
        settings.Kiosk.SaasUrl    = saasUrl;
        settings.Kiosk.PairingUrl = pairingUrl;
        return settings;
    }

    [Fact]
    public void Appsettings_address_wins_over_the_entered_one()
    {
        var settings = Settings("https://appsettings.supabase.co", "cle-appsettings", "https://saas.exemple.com");

        SaasEndpoint.Apply(settings, Entered).Should().Be(SaasEndpointSource.AppSettings);

        settings.Supabase.Url.Should().Be("https://appsettings.supabase.co");
        settings.Supabase.AnonKey.Should().Be("cle-appsettings");
        settings.Kiosk.SaasUrl.Should().Be("https://saas.exemple.com");
        settings.Supabase.Source.Should().Be(SaasEndpointSource.AppSettings);
    }

    [Fact]
    public void Entered_address_is_used_when_appsettings_has_none()
    {
        var settings = Settings();

        SaasEndpoint.Apply(settings, Entered).Should().Be(SaasEndpointSource.MachineSettings);

        settings.Supabase.Url.Should().Be("https://saisie.supabase.co");
        settings.Supabase.AnonKey.Should().Be("cle-saisie");
        settings.Kiosk.SaasUrl.Should().Be("https://photobooth.mon-entreprise.fr");
        settings.Kiosk.ResolvePairingUrl().Should().Be("https://photobooth.mon-entreprise.fr/associer");
        settings.Supabase.Source.Should().Be(SaasEndpointSource.MachineSettings);
    }

    [Theory]
    [InlineData("https://appsettings.supabase.co", "")]
    [InlineData("", "cle-appsettings")]
    public void An_incomplete_appsettings_address_gives_way_to_the_entered_one(string url, string key)
    {
        var settings = Settings(url, key);

        SaasEndpoint.Apply(settings, Entered).Should().Be(SaasEndpointSource.MachineSettings);
        settings.Supabase.Url.Should().Be("https://saisie.supabase.co");
        settings.Supabase.AnonKey.Should().Be("cle-saisie");
    }

    [Fact]
    public void Saas_and_pairing_urls_from_appsettings_are_kept()
    {
        var settings = Settings(saasUrl: "https://saas.appsettings.fr", pairingUrl: "http://localhost:5173/associer");

        SaasEndpoint.Apply(settings, Entered);

        settings.Kiosk.SaasUrl.Should().Be("https://saas.appsettings.fr");
        settings.Kiosk.ResolvePairingUrl().Should().Be("http://localhost:5173/associer");
    }

    [Fact]
    public void No_address_anywhere_means_the_address_screen()
    {
        var settings = Settings();

        SaasEndpoint.Apply(settings, new MachineSettings()).Should().Be(SaasEndpointSource.None);
        SaasEndpoint.Apply(Settings(), Entered with { SupabaseAnonKey = null }).Should().Be(SaasEndpointSource.None);

        settings.Supabase.Url.Should().BeEmpty();
        settings.Supabase.Source.Should().Be(SaasEndpointSource.None);
    }

    [Fact]
    public void The_open_base_settings_no_longer_fix_a_supabase_address()
    {
        var supabase = JObject.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "appsettings.json")))["Supabase"]!;
        supabase["Url"]!.ToString().Should().BeEmpty();
        supabase["AnonKey"]!.ToString().Should().BeEmpty();
    }
}
