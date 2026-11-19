using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// Le conteneur de l'app (KioskServices.Configure) résout les services du démarrage et de l'association,
/// sans boucle d'injection (régression corrigée par 2e99782 : journaux → licence → PIN admin → journaux).
/// </summary>
public sealed class ServiceRegistrationTests : IDisposable
{
    private readonly TempDir _dir = new();
    private readonly IHost _host;

    public ServiceRegistrationTests()
    {
        _host = new HostBuilder()
            .UseEnvironment("Production")
            .ConfigureAppConfiguration(c => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Kiosk:DataDirectory"] = _dir.Path,
                ["Supabase:Url"]        = "https://projet.supabase.co",
                ["Supabase:AnonKey"]    = "anon-key",
            }))
            .ConfigureServices(KioskServices.Configure)
            .Build();
    }

    public void Dispose()
    {
        _host.Dispose();
        _dir.Dispose();
    }

    [Theory]
    [InlineData(typeof(IKioskCredentials))]
    [InlineData(typeof(IKioskLogService))]
    [InlineData(typeof(IAdminPinService))]
    [InlineData(typeof(ILicenseService))]
    [InlineData(typeof(IKioskStateService))]
    [InlineData(typeof(ISupabaseService))]
    [InlineData(typeof(IPairingService))]
    [InlineData(typeof(ISyncService))]
    [InlineData(typeof(IPolaHistory))]
    [InlineData(typeof(IEventPushService))]
    [InlineData(typeof(PairingViewModel))]
    [InlineData(typeof(EventSetupViewModel))]
    [InlineData(typeof(SaasAddressViewModel))]
    [InlineData(typeof(IKioskConfigClient))]
    [InlineData(typeof(ISaasSwitchService))]
    [InlineData(typeof(IAppRestart))]
    [InlineData(typeof(IFrameSelection))]
    [InlineData(typeof(FrameSelectViewModel))]
    [InlineData(typeof(IKioskLogContext))]
    [InlineData(typeof(IGuestJourneyService))]
    [InlineData(typeof(ICameraHealthService))]
    [InlineData(typeof(ICameraSettingsSync))]
    [InlineData(typeof(IPrinterDriver))]
    [InlineData(typeof(IAnimationService))]
    public void Service_resolves(Type type)
    {
        object? resolved = null;
        Exception? error = null;
        // Thread à part : une boucle d'injection ne bloque pas toute la suite de tests.
        var thread = new Thread(() =>
        {
            try
            {
                using var scope = _host.Services.CreateScope();
                resolved = scope.ServiceProvider.GetRequiredService(type);
            }
            catch (Exception ex) { error = ex; }
        });
        thread.Start();

        thread.Join(TimeSpan.FromSeconds(20)).Should().BeTrue($"{type.Name} doit se résoudre sans boucle");
        error.Should().BeNull();
        resolved.Should().NotBeNull();
    }

    [Fact]
    public async Task The_log_context_reads_the_event_loaded_after_the_start()
    {
        var context = _host.Services.GetRequiredService<IKioskLogContext>();
        context.Current.EventId.Should().BeNull();

        var ev = Guid.NewGuid();
        await _host.Services.GetRequiredService<IKioskStateService>().SetActiveEventAsync(ev, "Salon", "ABC123");

        context.Current.Should().Be((ev, (Guid?)null));
    }

    [Fact]
    public void Each_pairing_screen_gets_its_own_key()
    {
        _host.Services.GetRequiredService<IPairingService>()
            .Should().NotBeSameAs(_host.Services.GetRequiredService<IPairingService>());
    }

    [Fact]
    public void Old_license_screen_is_gone()
    {
        typeof(App).Assembly.GetTypes().Select(t => t.Name)
            .Should().NotContain(["LicenseView", "LicenseViewModel"]);
    }

    [Fact]
    public void Appsettings_address_is_kept_and_marked_as_such()
    {
        var settings = _host.Services.GetRequiredService<AppSettings>();
        settings.Supabase.Url.Should().Be("https://projet.supabase.co");
        settings.Supabase.Source.Should().Be(SaasEndpointSource.AppSettings);
    }

    // Open core K2 : borne d'un autre loueur, adresse saisie sur la borne (machine-settings.json).
    [Fact]
    public void Entered_address_is_applied_when_appsettings_has_none()
    {
        using var dir = new TempDir();
        new MachineSettingsService(dir.Path)
            .SetSaasAddress("https://photobooth.mon-entreprise.fr", "https://saisie.supabase.co", "cle-saisie");

        using var host = BuildHost(dir.Path);
        var settings = host.Services.GetRequiredService<AppSettings>();

        settings.Supabase.Source.Should().Be(SaasEndpointSource.MachineSettings);
        settings.Supabase.Url.Should().Be("https://saisie.supabase.co");
        settings.Supabase.AnonKey.Should().Be("cle-saisie");
        settings.Kiosk.SaasUrl.Should().Be("https://photobooth.mon-entreprise.fr");
        host.Services.GetRequiredService<ISupabaseService>().Should().NotBeNull();
    }

    // Sans aucune adresse, l'app doit quand même démarrer (écran « Adresse de votre SaaS »).
    [Fact]
    public void Without_any_address_startup_services_still_resolve()
    {
        using var dir = new TempDir();
        using var host = BuildHost(dir.Path);

        host.Services.GetRequiredService<AppSettings>().Supabase.Source.Should().Be(SaasEndpointSource.None);
        foreach (var type in new[] { typeof(ISupabaseService), typeof(IKioskLogService), typeof(IAdminPinService),
                     typeof(INetworkMonitorService), typeof(ISessionService), typeof(SaasAddressViewModel) })
        {
            using var scope = host.Services.CreateScope();
            scope.ServiceProvider.GetRequiredService(type).Should().NotBeNull(type.Name);
        }
    }

    private static IHost BuildHost(string dataDir) => new HostBuilder()
        .UseEnvironment("Production")
        .ConfigureAppConfiguration(c => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Kiosk:DataDirectory"] = dataDir,
        }))
        .ConfigureServices(KioskServices.Configure)
        .Build();

    [Fact]
    public void Dev_secret_is_ignored_outside_development()
    {
        using var host = new HostBuilder()
            .UseEnvironment("Production")
            .ConfigureAppConfiguration(c => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Kiosk:DataDirectory"] = _dir.Path,
                ["Kiosk:LicenseSecret"] = "secret-dev",
            }))
            .ConfigureServices(KioskServices.Configure)
            .Build();

        host.Services.GetRequiredService<IKioskCredentials>().Secret.Should().BeEmpty();
    }
}
