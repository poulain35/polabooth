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

/// <summary>LAB-230 : appel de kiosk_record_print (corps, réponse true, codes d'erreur). Réponses HTTP simulées.</summary>
public class PrintLogRpcTests
{
    private static readonly Guid PrintId   = Guid.Parse("0a0b0c0d-1111-4222-8333-944455556666");
    private static readonly Guid EventId   = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private static readonly Guid SessionId = Guid.Parse("1b2c3d4e-1111-4222-8333-944455556666");

    private static PrintLogRecord Record() => new(
        Id:           PrintId,
        EventId:      EventId,
        AccessCode:   "TUQNA5",
        SessionId:    SessionId,
        Copies:       2,
        PrintedAtUtc: new DateTime(2026, 11, 4, 21, 10, 5, 123, DateTimeKind.Utc));

    private static JObject Parse(string json)
        => JsonConvert.DeserializeObject<JObject>(json, new JsonSerializerSettings { DateParseHandling = DateParseHandling.None })!;

    [Fact]
    public void Body_uses_exactly_the_sql_argument_names()
    {
        var body = Parse(SupabaseService.BuildRecordPrintBody(Record(), "MACHINE-1", "s3cret"));

        body.Properties().Select(p => p.Name).Should().Equal(
            "p_code", "p_event_id", "p_id", "p_session_id", "p_copies", "p_printed_at", "p_machine_id", "p_secret");
        body["p_code"]!.Value<string>().Should().Be("TUQNA5");
        body["p_event_id"]!.Value<string>().Should().Be(EventId.ToString());
        body["p_id"]!.Value<string>().Should().Be(PrintId.ToString());
        body["p_session_id"]!.Value<string>().Should().Be(SessionId.ToString());
        body["p_copies"]!.Type.Should().Be(JTokenType.Integer);
        body["p_copies"]!.Value<int>().Should().Be(2);
        body["p_printed_at"]!.Value<string>().Should().Be("2026-11-04T21:10:05.123Z");
        body["p_machine_id"]!.Value<string>().Should().Be("MACHINE-1");
        body["p_secret"]!.Value<string>().Should().Be("s3cret");
    }

    [Fact]
    public void Printed_at_read_back_from_sqlite_without_kind_is_sent_as_utc()
    {
        var local = Record() with { PrintedAtUtc = new DateTime(2026, 11, 4, 21, 10, 5, DateTimeKind.Unspecified) };

        Parse(SupabaseService.BuildRecordPrintBody(local, "MACHINE-1", "s3cret"))["p_printed_at"]!
            .Value<string>().Should().Be("2026-11-04T21:10:05.000Z");
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData(" true\n", true)]
    [InlineData("false", false)]
    [InlineData("null", false)]
    [InlineData("\"true\"", false)]
    [InlineData("", false)]
    [InlineData("<html>", false)]
    public void Only_a_json_true_is_an_acknowledgement(string body, bool expected)
        => SupabaseService.IsTrueRpcResponse(body).Should().Be(expected);

    [Fact]
    public async Task Accepted_and_refused_prints_are_told_apart()
    {
        var handler = new StubHandler();
        var supabase = NewSupabase(handler);
        var ct = TestContext.Current.CancellationToken;

        handler.Response = () => Json(HttpStatusCode.OK, "true");
        (await supabase.RecordPrintAsync(Record(), ct)).Should().Be(PrintLogSendResult.Ok);
        handler.LastUrl.Should().Be("https://projet.supabase.co/rest/v1/rpc/kiosk_record_print");
        handler.LastMethod.Should().Be(HttpMethod.Post);
        Parse(handler.LastBody!)["p_id"]!.Value<string>().Should().Be(PrintId.ToString());

        handler.Response = () => Json(HttpStatusCode.OK, "false");
        (await supabase.RecordPrintAsync(Record(), ct))
            .Should().Be(PrintLogSendResult.Rejected(PrintLogSendResult.UnexpectedBodyCode));

        handler.Response = () => Json(HttpStatusCode.BadRequest,
            """{"code":"P0001","message":"kiosk_record_print : licence kiosk invalide ou inactive"}""");
        var refused = await supabase.RecordPrintAsync(Record(), ct);
        refused.Should().Be(PrintLogSendResult.Rejected("P0001"));
        refused.ErrorCode.Should().NotContain("licence");

        // L'ancien INSERT direct renvoyait 409 sur un doublon : la RPC n'en renvoie plus, mais un
        // 409 reste un refus (ligne gardée), jamais un succès implicite.
        handler.Response = () => new HttpResponseMessage(HttpStatusCode.Conflict);
        (await supabase.RecordPrintAsync(Record(), ct)).Should().Be(PrintLogSendResult.Rejected("HTTP 409"));

        handler.Response = () => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        (await supabase.RecordPrintAsync(Record(), ct)).Should().Be(PrintLogSendResult.Rejected("HTTP 503"));
    }

    [Fact]
    public async Task Network_error_is_raised_to_the_queue()
    {
        var handler = new StubHandler { Response = () => throw new HttpRequestException("coupure") };

        await FluentActions.Awaiting(() => NewSupabase(handler).RecordPrintAsync(Record(), TestContext.Current.CancellationToken))
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
