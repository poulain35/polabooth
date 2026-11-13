using System.Net;
using System.Security.Cryptography;
using System.Text;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-244 : clé K, code affiché, lien du QR code.</summary>
public class PairingServiceTests
{
    private static readonly Guid PairingId = Guid.Parse("3c2b1a00-1111-4222-8333-944455556666");

    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly List<string> _hashes = [];
    private readonly List<string> _keys = [];

    public PairingServiceTests()
    {
        _supabase.Setup(s => s.StartPairingAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
                 .Callback((string _, string _, string hash, CancellationToken _) => _hashes.Add(hash))
                 .ReturnsAsync(() => new PairingCode(PairingId, "K7M4PX", DateTimeOffset.UtcNow.AddMinutes(10)));
        _supabase.Setup(s => s.PollPairingAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
                 .Callback((Guid _, string key, CancellationToken _) => _keys.Add(key))
                 .ReturnsAsync(new PairingPollResult(PairingStatus.Pending));
    }

    private static string Sha256OfHex(string hex) => Convert.ToHexStringLower(SHA256.HashData(Convert.FromHexString(hex)));

    [Fact]
    public async Task Poll_sends_the_key_whose_sha256_was_sent_at_start()
    {
        var service = new PairingService(_supabase.Object);

        await service.StartAsync(TestContext.Current.CancellationToken);
        await service.PollAsync(TestContext.Current.CancellationToken);

        var key = _keys.Should().ContainSingle().Subject;
        key.Should().MatchRegex("^[0-9a-f]{64}$", "32 octets en hexadécimal minuscule");
        _hashes.Should().ContainSingle().Which.Should().MatchRegex("^[0-9a-f]{64}$").And.Be(Sha256OfHex(key));
        _supabase.Verify(s => s.PollPairingAsync(PairingId, key, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Start_sends_the_pc_name_and_app_version()
    {
        await new PairingService(_supabase.Object).StartAsync(TestContext.Current.CancellationToken);

        _supabase.Verify(s => s.StartPairingAsync(Environment.MachineName, AppVersion.Current,
            It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Each_code_gets_a_new_key()
    {
        var service = new PairingService(_supabase.Object);

        await service.StartAsync(TestContext.Current.CancellationToken);
        await service.PollAsync(TestContext.Current.CancellationToken);
        await service.StartAsync(TestContext.Current.CancellationToken);
        await service.PollAsync(TestContext.Current.CancellationToken);

        _hashes.Should().HaveCount(2).And.OnlyHaveUniqueItems();
        _keys.Should().HaveCount(2).And.OnlyHaveUniqueItems();
        Sha256OfHex(_keys[1]).Should().Be(_hashes[1]);
    }

    [Fact]
    public async Task Poll_is_impossible_before_start_and_after_forget()
    {
        var service = new PairingService(_supabase.Object);

        var before = () => service.PollAsync(TestContext.Current.CancellationToken);
        await before.Should().ThrowAsync<InvalidOperationException>();

        await service.StartAsync(TestContext.Current.CancellationToken);
        service.Forget();

        var after = () => service.PollAsync(TestContext.Current.CancellationToken);
        await after.Should().ThrowAsync<InvalidOperationException>();
        _keys.Should().BeEmpty();
    }

    [Fact]
    public async Task A_code_received_after_forget_is_dropped()
    {
        var service = new PairingService(_supabase.Object);
        _supabase.Setup(s => s.StartPairingAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
                 .Returns(() =>
                 {
                     service.Forget(); // écran quitté pendant la demande
                     return Task.FromResult(new PairingCode(PairingId, "K7M4PX", DateTimeOffset.UtcNow.AddMinutes(10)));
                 });

        var act = () => service.StartAsync(TestContext.Current.CancellationToken);

        await act.Should().ThrowAsync<OperationCanceledException>();
        var poll = () => service.PollAsync(TestContext.Current.CancellationToken);
        await poll.Should().ThrowAsync<InvalidOperationException>();
    }

    [Theory]
    [InlineData("K7M4PX", "K7M-4PX")]
    [InlineData(" k7m4px ", "K7M-4PX")]
    [InlineData("ABC", "ABC")]
    public void Code_is_shown_in_two_groups(string code, string expected)
        => PairingService.FormatCode(code).Should().Be(expected);

    [Fact]
    public void Code_alphabet_matches_the_server_one()
    {
        // kiosk_pairing_new_code (LAB-242) : sans 0/O, 1/I/L ni U.
        PairingService.CodeAlphabet.Should().Be("23456789ABCDEFGHJKMNPQRSTVWXYZ");
        PairingService.CodeAlphabet.Should().NotContainAny("0", "O", "1", "I", "L", "U");
    }

    [Theory]
    [InlineData("https://photobooth.exemple.fr/associer", "K7M4PX", "https://photobooth.exemple.fr/associer?code=K7M4PX")]
    [InlineData("http://localhost:5173/associer", "k7m4px", "http://localhost:5173/associer?code=K7M4PX")]
    [InlineData("https://exemple.fr/associer?src=borne", "K7M4PX", "https://exemple.fr/associer?src=borne&code=K7M4PX")]
    public void Qr_link_opens_the_pairing_page_with_the_code(string pairingUrl, string code, string expected)
        => PairingService.BuildPairingUrl(pairingUrl, code).Should().Be(expected);

    [Theory]
    [InlineData("https://photobooth.exemple.fr/associer", "photobooth.exemple.fr/associer")]
    [InlineData("https://photobooth.exemple.fr/associer/", "photobooth.exemple.fr/associer")]
    [InlineData("http://localhost:5173/associer", "localhost:5173/associer")]
    public void Address_to_type_has_no_scheme(string pairingUrl, string expected)
        => PairingService.DisplayUrl(pairingUrl).Should().Be(expected);

    [Fact]
    public void Poll_result_never_prints_the_secret()
    {
        var result = new PairingPollResult(PairingStatus.Approved, Secret: "secret-tres-long", Label: "Borne 1", OrgName: "Studio");

        result.ToString().Should().NotContain("secret-tres-long");
    }
}

/// <summary>LAB-244 : appels kiosk_pairing_start, kiosk_pairing_poll et kiosk_get_event. Réponses HTTP simulées.</summary>
public class PairingRpcTests
{
    private static readonly Guid PairingId = Guid.Parse("3c2b1a00-1111-4222-8333-944455556666");
    private static readonly Guid LicenseId = Guid.Parse("4d3c2b1a-1111-4222-8333-944455556666");
    private static readonly Guid OrgId     = Guid.Parse("7a6b5c4d-2222-4333-8444-955566667777");
    private static readonly string Hash = new('a', 64);

    [Fact]
    public void Start_body_uses_exactly_the_sql_argument_names()
    {
        var body = JObject.Parse(SupabaseService.BuildPairingStartBody("MACHINE-1", "PC-SALON", "1.0.30", Hash));

        body.Properties().Select(p => p.Name).Should().BeEquivalentTo(
            "p_machine_id", "p_machine_name", "p_app_version", "p_device_key_hash");
        body["p_machine_id"]!.Value<string>().Should().Be("MACHINE-1");
        body["p_machine_name"]!.Value<string>().Should().Be("PC-SALON");
        body["p_app_version"]!.Value<string>().Should().Be("1.0.30");
        body["p_device_key_hash"]!.Value<string>().Should().Be(Hash);
    }

    [Fact]
    public void Start_body_respects_the_server_lengths()
    {
        var body = JObject.Parse(SupabaseService.BuildPairingStartBody("MACHINE-1", new string('n', 300), new string('v', 80), Hash));

        body["p_machine_name"]!.Value<string>().Should().HaveLength(200);
        body["p_app_version"]!.Value<string>().Should().HaveLength(50);
    }

    [Fact]
    public void Get_event_body_sends_the_machine_and_its_secret()
    {
        var body = JObject.Parse(SupabaseService.BuildGetEventBody("TUQNA5", "MACHINE-1", "s3cret"));

        body.Properties().Select(p => p.Name).Should().BeEquivalentTo("p_code", "p_machine_id", "p_secret");
        body["p_code"]!.Value<string>().Should().Be("TUQNA5");
        body["p_secret"]!.Value<string>().Should().Be("s3cret");
    }

    [Fact]
    public void Start_response_is_read_without_converting_the_date()
    {
        var code = SupabaseService.ParsePairingStart(
            $$"""{"pairing_id":"{{PairingId}}","code":"k7m4px","expires_at":"2026-11-05T10:20:00.123+00:00"}""");

        code.PairingId.Should().Be(PairingId);
        code.Code.Should().Be("K7M4PX");
        code.ExpiresAt.Should().Be(new DateTimeOffset(2026, 11, 5, 10, 20, 0, 123, TimeSpan.Zero));
    }

    [Theory]
    [InlineData("""{"code":"K7M4PX","expires_at":"2026-11-05T10:20:00Z"}""")]
    [InlineData("""{"pairing_id":"3c2b1a00-1111-4222-8333-944455556666","expires_at":"2026-11-05T10:20:00Z"}""")]
    [InlineData("""{"pairing_id":"3c2b1a00-1111-4222-8333-944455556666","code":"K7M4PX"}""")]
    public void Incomplete_start_response_is_an_error(string body)
    {
        var act = () => SupabaseService.ParsePairingStart(body);

        act.Should().Throw<InvalidDataException>();
    }

    [Theory]
    [InlineData("""{"status":"pending","expires_at":"2026-11-05T10:20:00Z"}""", PairingStatus.Pending)]
    [InlineData("""{"status":"expired","expires_at":"2026-11-05T10:20:00Z"}""", PairingStatus.Expired)]
    [InlineData("""{"status":"delivered"}""", PairingStatus.Delivered)]
    [InlineData("""{"status":"cancelled"}""", PairingStatus.Cancelled)]
    [InlineData("""{"status":"not_found"}""", PairingStatus.NotFound)]
    [InlineData("""{"status":"invalid_key"}""", PairingStatus.InvalidKey)]
    [InlineData("""{"status":"nouveau_statut"}""", PairingStatus.Unknown)]
    public void Poll_statuses_are_mapped(string body, PairingStatus expected)
    {
        var result = SupabaseService.ParsePairingPoll(body);

        result.Status.Should().Be(expected);
        result.Secret.Should().BeNull();
    }

    [Fact]
    public void Approved_poll_carries_the_secret_and_the_account()
    {
        var result = SupabaseService.ParsePairingPoll(
            $$"""{"status":"approved","secret":"s3cret","license_id":"{{LicenseId}}","label":" Borne salon ","org_name":"Studio Lumière","org_id":"{{OrgId}}"}""");

        result.Should().Be(new PairingPollResult(PairingStatus.Approved, "s3cret", LicenseId, "Borne salon", "Studio Lumière", OrgId));
    }

    [Theory]
    [InlineData("""{"status":"approved"}""")]
    [InlineData("""{"status":"approved","secret":""}""")]
    [InlineData("""{"status":"approved","secret":null}""")]
    [InlineData("""{"status":"approved","secret":42}""")]
    public void Approved_poll_without_secret_has_no_secret(string body)
        => SupabaseService.ParsePairingPoll(body).Secret.Should().BeNull();

    [Fact]
    public async Task Start_calls_kiosk_pairing_start_and_reads_the_code()
    {
        var handler = new StubHandler(() => Json(HttpStatusCode.OK,
            $$"""{"pairing_id":"{{PairingId}}","code":"K7M4PX","expires_at":"2026-11-05T10:20:00Z"}"""));

        var code = await NewSupabase(handler).StartPairingAsync("PC-SALON", "1.0.30", Hash, TestContext.Current.CancellationToken);

        code.Code.Should().Be("K7M4PX");
        handler.LastUrl.Should().Be("https://projet.supabase.co/rest/v1/rpc/kiosk_pairing_start");
        JObject.Parse(handler.LastBody!)["p_machine_id"]!.Value<string>().Should().Be("MACHINE-1");
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, "")]
    [InlineData(HttpStatusCode.BadRequest, """{"code":"PT429","message":"trop de demandes"}""")]
    public async Task Start_reports_the_rate_limit(HttpStatusCode status, string body)
    {
        var handler = new StubHandler(() => Json(status, body));

        var act = () => NewSupabase(handler).StartPairingAsync("PC-SALON", "1.0.30", Hash, TestContext.Current.CancellationToken);

        await act.Should().ThrowAsync<PairingRateLimitedException>();
    }

    [Fact]
    public async Task Poll_calls_kiosk_pairing_poll_with_the_key()
    {
        var handler = new StubHandler(() => Json(HttpStatusCode.OK, """{"status":"pending","expires_at":"2026-11-05T10:20:00Z"}"""));

        var result = await NewSupabase(handler).PollPairingAsync(PairingId, new string('b', 64), TestContext.Current.CancellationToken);

        result.Status.Should().Be(PairingStatus.Pending);
        handler.LastUrl.Should().Be("https://projet.supabase.co/rest/v1/rpc/kiosk_pairing_poll");
        var body = JObject.Parse(handler.LastBody!);
        body.Properties().Select(p => p.Name).Should().BeEquivalentTo("p_pairing_id", "p_device_key");
        body["p_pairing_id"]!.Value<string>().Should().Be(PairingId.ToString());
        body["p_device_key"]!.Value<string>().Should().Be(new string('b', 64));
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task Get_event_reports_a_refused_license(HttpStatusCode status)
    {
        var handler = new StubHandler(() => Json(status, """{"code":"42501","message":"licence kiosk invalide"}"""));

        var act = () => NewSupabase(handler).GetEventByCodeAsync("TUQNA5", TestContext.Current.CancellationToken);

        await act.Should().ThrowAsync<KioskLicenseRefusedException>();
        JObject.Parse(handler.LastBody!)["p_secret"]!.Value<string>().Should().Be("s3cret");
    }

    [Fact]
    public async Task Get_event_returns_null_for_a_code_of_another_account()
    {
        var handler = new StubHandler(() => Json(HttpStatusCode.OK, "null"));

        (await NewSupabase(handler).GetEventByCodeAsync("TUQNA5", TestContext.Current.CancellationToken)).Should().BeNull();
    }

    [Fact]
    public async Task Get_event_server_error_is_not_a_refused_license()
    {
        var handler = new StubHandler(() => Json(HttpStatusCode.InternalServerError, """{"code":"XX000","message":"boom"}"""));

        var act = () => NewSupabase(handler).GetEventByCodeAsync("TUQNA5", TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<Exception>()).Which.Should().NotBeOfType<KioskLicenseRefusedException>();
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body)
        => new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static SupabaseService NewSupabase(HttpMessageHandler handler)
    {
        var credentials = new Mock<IKioskCredentials>();
        credentials.SetupGet(c => c.MachineId).Returns("MACHINE-1");
        credentials.SetupGet(c => c.Secret).Returns("s3cret");
        var settings = new AppSettings { Supabase = new SupabaseSettings { Url = "https://projet.supabase.co/", AnonKey = "anon-key" } };
        var scopes = new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();
        return new SupabaseService(settings, credentials.Object, scopes, handler);
    }

    private sealed class StubHandler(Func<HttpResponseMessage> response) : HttpMessageHandler
    {
        public string? LastUrl { get; private set; }
        public string? LastBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastUrl = request.RequestUri!.AbsoluteUri;
            LastBody = request.Content == null ? null : await request.Content.ReadAsStringAsync(ct);
            return response();
        }
    }
}
