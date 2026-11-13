using System.Net;
using System.Text;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// LAB-244 : seul un refus du serveur renvoie à l'association. Une coupure réseau garde la borne en
/// service (cache de licence), ou la laisse « non vérifiée » sans cache.
/// </summary>
public sealed class LicenseStatusTests : IDisposable
{
    private const string SupabaseUrl = "https://projet.supabase.co";
    private readonly TempDir _dir = new();
    private readonly ServiceProvider _services = new ServiceCollection().BuildServiceProvider();
    private Func<HttpResponseMessage> _checkLicense = () => Json("true");
    private string _secret = "s3cret";

    public void Dispose()
    {
        _services.Dispose();
        _dir.Dispose();
    }

    private static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK)
        => new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static Func<HttpResponseMessage> Offline => () => throw new HttpRequestException("Hôte inaccessible");

    private LicenseService NewLicense()
    {
        var credentials = new Mock<IKioskCredentials>();
        credentials.SetupGet(c => c.MachineId).Returns("MACHINE-1");
        credentials.SetupGet(c => c.Secret).Returns(() => _secret);
        var settings = new AppSettings { Supabase = new SupabaseSettings { Url = SupabaseUrl, AnonKey = "anon-key" } };
        settings.Kiosk.PrinterName = "Imprimante absente du poste de test";
        var supabase = new SupabaseService(settings, credentials.Object,
            _services.GetRequiredService<IServiceScopeFactory>(), new Handler(this));
        return new LicenseService(supabase, settings, credentials.Object, new Mock<IAdminPinService>().Object,
            Mock.Of<IPendingUploadsCounter>(), _dir.Path);
    }

    [Fact]
    public async Task Valid_license_is_valid()
        => (await NewLicense().CheckAsync()).Should().Be(LicenseStatus.Valid);

    [Fact]
    public async Task Retired_kiosk_is_refused()
    {
        _checkLicense = () => Json("false");

        (await NewLicense().CheckAsync()).Should().Be(LicenseStatus.Refused);
        (await NewLicense().IsRefusedOnlineAsync()).Should().BeTrue();
    }

    [Fact]
    public async Task Kiosk_never_paired_is_refused_without_asking_the_server()
    {
        _secret = "";
        _checkLicense = () => throw new InvalidOperationException("aucun appel attendu");

        (await NewLicense().CheckAsync()).Should().Be(LicenseStatus.Refused);
    }

    [Fact]
    public async Task Offline_without_cache_is_unverified_not_refused()
    {
        _checkLicense = Offline;

        var license = NewLicense();

        (await license.CheckAsync()).Should().Be(LicenseStatus.Unverified);
        (await license.IsRefusedOnlineAsync()).Should().BeFalse("une coupure réseau n'est pas un refus");
    }

    [Fact]
    public async Task Offline_after_a_valid_check_stays_valid()
    {
        (await NewLicense().CheckAsync()).Should().Be(LicenseStatus.Valid);
        _checkLicense = Offline;

        (await NewLicense().CheckAsync()).Should().Be(LicenseStatus.Valid);
    }

    [Fact]
    public async Task Server_error_is_never_a_refusal()
    {
        _checkLicense = () => Json("""{"message":"boom"}""", HttpStatusCode.InternalServerError);

        (await NewLicense().IsRefusedOnlineAsync()).Should().BeFalse();
        (await NewLicense().CheckAsync()).Should().Be(LicenseStatus.Unverified);
    }

    [Fact]
    public async Task Refusal_seen_in_the_background_is_kept_for_the_next_start_offline()
    {
        (await NewLicense().CheckAsync()).Should().Be(LicenseStatus.Valid);
        _checkLicense = () => Json("false");
        (await NewLicense().IsRefusedOnlineAsync()).Should().BeTrue();
        _checkLicense = Offline;

        (await NewLicense().CheckAsync()).Should().Be(LicenseStatus.Unverified,
            "le cache garde le refus : la borne ne repart pas hors ligne sur une licence retirée");
    }

    private sealed class Handler(LicenseStatusTests test) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromResult(request.RequestUri!.AbsolutePath.EndsWith("/kiosk_check_license")
                ? test._checkLicense()
                : Json(""));
    }
}

/// <summary>LAB-244 : secret reçu à l'association (DPAPI) et compte de la borne (state.json).</summary>
public sealed class PairingStorageTests : IDisposable
{
    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    [Fact]
    public void Secret_is_kept_encrypted_between_restarts()
    {
        new KioskCredentialsService(_dir.Path, machineId: "MACHINE-1").SetSecret("secret-recu");

        new KioskCredentialsService(_dir.Path, machineId: "MACHINE-1").Secret.Should().Be("secret-recu");
        File.ReadAllText(_dir.File("activation.bin")).Should().NotContain("secret-recu");
    }

    [Fact]
    public void Dev_secret_is_only_a_fallback()
    {
        new KioskCredentialsService(_dir.Path, "secret-dev", "MACHINE-1").Secret.Should().Be("secret-dev");

        var credentials = new KioskCredentialsService(_dir.Path, "secret-dev", "MACHINE-1");
        credentials.SetSecret("secret-recu");

        credentials.Secret.Should().Be("secret-recu");
        new KioskCredentialsService(_dir.Path, "secret-dev", "MACHINE-1").Secret.Should().Be("secret-recu");
    }

    [Fact]
    public void Kiosk_without_pairing_has_no_secret()
        => new KioskCredentialsService(_dir.Path, machineId: "MACHINE-1").Secret.Should().BeEmpty();

    [Fact]
    public void Empty_secret_is_refused()
    {
        var act = () => new KioskCredentialsService(_dir.Path, machineId: "MACHINE-1").SetSecret(" ");

        act.Should().Throw<ArgumentException>();
    }

    private KioskStateService NewState()
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dir.Path;
        return new KioskStateService(settings);
    }

    [Fact]
    public async Task Account_survives_the_end_of_an_event_and_a_restart()
    {
        var orgId = Guid.NewGuid();
        var state = NewState();
        await state.SetPairedAccountAsync(" Studio Lumière ");
        await state.SetAccountOrgIdAsync(orgId);
        await state.SetActiveEventAsync(Guid.NewGuid(), "Mariage", "TUQNA5");

        await state.ClearActiveEventAsync();

        var reloaded = NewState();
        reloaded.AccountName.Should().Be("Studio Lumière");
        reloaded.AccountOrgId.Should().Be(orgId);
        reloaded.ActiveEventId.Should().BeNull();
    }

    [Fact]
    public async Task New_pairing_forgets_the_previous_account()
    {
        var state = NewState();
        await state.SetPairedAccountAsync("Ancien compte");
        await state.SetAccountOrgIdAsync(Guid.NewGuid());

        await state.SetPairedAccountAsync("Nouveau compte");

        state.AccountName.Should().Be("Nouveau compte");
        state.AccountOrgId.Should().BeNull("l'org du nouveau compte sera lue au premier code événement");
    }

    [Fact]
    public async Task Pairing_with_the_account_id_keeps_it_for_pola_files()
    {
        var orgId = Guid.NewGuid();
        var state = NewState();
        await state.SetPairedAccountAsync("Ancien compte");
        await state.SetAccountOrgIdAsync(Guid.NewGuid());

        await state.SetPairedAccountAsync("Nouveau compte", orgId);

        NewState().AccountOrgId.Should().Be(orgId, "un .pola d'un autre compte est refusé dès l'association");
    }
}
