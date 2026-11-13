using System.Net;
using System.Text;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-278 : appel de kiosk_record_logs (corps, réponses 2xx, codes d'erreur). Réponses HTTP simulées.</summary>
public class KioskLogRpcTests
{
    private static readonly Guid LogId = Guid.Parse("0a0b0c0d-1111-4222-8333-944455556666");

    private static KioskLogRecord Record() => new(
        Id:            LogId,
        Level:         "error",
        Context:       "camera",
        Message:       "Appareil photo absent",
        StackTrace:    "at PolaKiosk.Services.CameraHealthService",
        AppVersion:    "1.0.16",
        OccurredAtUtc: new DateTime(2026, 11, 13, 21, 10, 5, 123, DateTimeKind.Utc));

    private static JObject Parse(string json)
        => JsonConvert.DeserializeObject<JObject>(json, new JsonSerializerSettings { DateParseHandling = DateParseHandling.None })!;

    [Fact]
    public void Body_uses_exactly_the_sql_argument_names_and_row_fields()
    {
        var body = Parse(SupabaseService.BuildRecordLogsBody([Record()], "MACHINE-1", "s3cret"));

        body.Properties().Select(p => p.Name).Should().Equal("p_machine_id", "p_secret", "p_logs");
        body["p_machine_id"]!.Value<string>().Should().Be("MACHINE-1");
        body["p_secret"]!.Value<string>().Should().Be("s3cret");

        var logs = body["p_logs"].Should().BeOfType<JArray>().Subject;
        var row = logs.Should().ContainSingle().Subject.Should().BeOfType<JObject>().Subject;
        // machine_id jamais dans les lignes : le serveur prend p_machine_id.
        row.Properties().Select(p => p.Name).Should().Equal(
            "id", "level", "context", "message", "stack_trace", "app_version", "occurred_at");
        row["id"]!.Value<string>().Should().Be(LogId.ToString());
        row["level"]!.Value<string>().Should().Be("error");
        row["context"]!.Value<string>().Should().Be("camera");
        row["message"]!.Value<string>().Should().Be("Appareil photo absent");
        row["stack_trace"]!.Value<string>().Should().Be("at PolaKiosk.Services.CameraHealthService");
        row["app_version"]!.Value<string>().Should().Be("1.0.16");
        row["occurred_at"]!.Value<string>().Should().Be("2026-11-13T21:10:05.123Z");
    }

    [Fact]
    public void Missing_optional_fields_are_sent_as_null()
    {
        var bare = Record() with { Context = null, StackTrace = null, AppVersion = null };

        var row = (JObject)Parse(SupabaseService.BuildRecordLogsBody([bare], "MACHINE-1", "s3cret"))["p_logs"]![0]!;

        row["context"]!.Type.Should().Be(JTokenType.Null);
        row["stack_trace"]!.Type.Should().Be(JTokenType.Null);
        row["app_version"]!.Type.Should().Be(JTokenType.Null);
    }

    [Theory]
    [InlineData("1")]
    [InlineData("0")] // lot de doublons : rien d'inséré, mais reçu
    [InlineData("")]
    public async Task Any_2xx_accepts_the_batch(string body)
    {
        var handler = new StubHandler { Response = () => Json(HttpStatusCode.OK, body) };

        (await NewSupabase(handler).RecordLogsAsync([Record()], TestContext.Current.CancellationToken))
            .Should().Be(KioskLogSendResult.Ok);
        handler.LastUrl.Should().Be("https://projet.supabase.co/rest/v1/rpc/kiosk_record_logs");
        handler.LastMethod.Should().Be(HttpMethod.Post);
        Parse(handler.LastBody!)["p_secret"]!.Value<string>().Should().Be("s3cret");
    }

    [Fact]
    public async Task Refusals_are_returned_with_their_code_only()
    {
        var handler = new StubHandler();
        var supabase = NewSupabase(handler);
        var ct = TestContext.Current.CancellationToken;

        handler.Response = () => Json(HttpStatusCode.Forbidden,
            """{"code":"42501","message":"kiosk_record_logs : licence kiosk invalide ou inactive"}""");
        var refused = await supabase.RecordLogsAsync([Record()], ct);
        refused.Should().Be(KioskLogSendResult.Rejected(KioskLogSendResult.LicenseRefusedCode));
        refused.ErrorCode.Should().NotContain("licence");

        handler.Response = () => Json(HttpStatusCode.TooManyRequests, """{"code":"PT429","message":"trop de journaux"}""");
        (await supabase.RecordLogsAsync([Record()], ct))
            .Should().Be(KioskLogSendResult.Rejected(KioskLogSendResult.RateLimitedCode));

        handler.Response = () => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        (await supabase.RecordLogsAsync([Record()], ct)).Should().Be(KioskLogSendResult.Rejected("HTTP 503"));
    }

    [Fact]
    public async Task Network_error_is_raised_to_the_caller()
    {
        var handler = new StubHandler { Response = () => throw new HttpRequestException("coupure") };

        await FluentActions.Awaiting(() => NewSupabase(handler).RecordLogsAsync([Record()], TestContext.Current.CancellationToken))
            .Should().ThrowAsync<HttpRequestException>();
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

    private sealed class StubHandler : HttpMessageHandler
    {
        public Func<HttpResponseMessage> Response { get; set; } = () => new HttpResponseMessage(HttpStatusCode.OK);
        public string? LastUrl { get; private set; }
        public HttpMethod? LastMethod { get; private set; }
        public string? LastBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastUrl = request.RequestUri!.AbsoluteUri;
            LastMethod = request.Method;
            LastBody = request.Content == null ? null : await request.Content.ReadAsStringAsync(ct);
            return Response();
        }
    }
}
