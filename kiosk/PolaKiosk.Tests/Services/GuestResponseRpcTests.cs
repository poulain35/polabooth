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

/// <summary>LAB-225 : appel de kiosk_record_guest_response (corps, codes d'erreur). Réponses HTTP simulées.</summary>
public class GuestResponseRpcTests
{
    private static readonly Guid ResponseId = Guid.Parse("0a0b0c0d-1111-4222-8333-944455556666");
    private static readonly Guid EventId    = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private static readonly Guid SessionId  = Guid.Parse("1b2c3d4e-1111-4222-8333-944455556666");

    private static GuestResponseRecord Record() => new(
        Id:               ResponseId,
        EventId:          EventId,
        AccessCode:       "TUQNA5",
        AnsweredAtUtc:    new DateTime(2026, 11, 4, 18, 30, 5, 123, DateTimeKind.Unspecified),
        Answers:          JObject.Parse("""{"email":"jean@gmail.com","date":"2026-11-04","gouts":["Rock"],"newsletter":true}"""),
        Questions:        JArray.Parse("""[{"id":"email","label":"Votre e-mail","type":"email"}]"""),
        MarketingConsent: true,
        ConsentText:      "J'accepte d'être recontacté.",
        NoticeHash:       new string('a', 64),
        SessionIds:       [SessionId]);

    private static JObject Parse(string json)
        => JsonConvert.DeserializeObject<JObject>(json, new JsonSerializerSettings { DateParseHandling = DateParseHandling.None })!;

    [Fact]
    public void Body_uses_exactly_the_sql_argument_names()
    {
        var body = Parse(SupabaseRpcBodies.BuildGuestResponseBody(Record(), "MACHINE-1", "s3cret"));

        body.Properties().Select(p => p.Name).Should().BeEquivalentTo(
            "p_code", "p_event_id", "p_machine_id", "p_secret", "p_response_id", "p_answered_at", "p_answers",
            "p_questions", "p_marketing_consent", "p_consent_text", "p_notice_hash", "p_session_ids");
        body["p_code"]!.Value<string>().Should().Be("TUQNA5");
        body["p_event_id"]!.Value<string>().Should().Be(EventId.ToString());
        body["p_machine_id"]!.Value<string>().Should().Be("MACHINE-1");
        body["p_secret"]!.Value<string>().Should().Be("s3cret");
        body["p_response_id"]!.Value<string>().Should().Be(ResponseId.ToString());
        body["p_answered_at"]!.Value<string>().Should().Be("2026-11-04T18:30:05.123Z");
        body["p_answers"]!.Type.Should().Be(JTokenType.Object);
        body["p_answers"]!["date"]!.Value<string>().Should().Be("2026-11-04");
        body["p_answers"]!["newsletter"]!.Value<bool>().Should().BeTrue();
        body["p_questions"]!.Type.Should().Be(JTokenType.Array);
        body["p_marketing_consent"]!.Value<bool>().Should().BeTrue();
        body["p_consent_text"]!.Value<string>().Should().Be("J'accepte d'être recontacté.");
        body["p_notice_hash"]!.Value<string>().Should().HaveLength(64);
        body["p_session_ids"]!.ToObject<string[]>().Should().Equal(SessionId.ToString());
    }

    [Theory]
    [InlineData("""{"code":"22023","message":"reponse invalide jean@gmail.com"}""", "22023")]
    [InlineData("""{"code":"P0001","message":"licence kiosk invalide ou inactive"}""", "P0001")]
    [InlineData("""{"code":"PGRST202","message":"Could not find the function"}""", "PGRST202")]
    [InlineData("""{"code":"jean@gmail.com"}""", "HTTP 400")]
    [InlineData("""{"message":"sans code"}""", "HTTP 400")]
    [InlineData("<html>Bad Gateway</html>", "HTTP 400")]
    [InlineData("", "HTTP 400")]
    public void Error_code_never_carries_the_server_message(string body, string expected)
        => SupabaseRpcResponses.ParseRpcErrorCode(HttpStatusCode.BadRequest, body).Should().Be(expected);

    [Fact]
    public async Task Accepted_and_refused_responses_are_told_apart()
    {
        var handler = new StubHandler();
        var supabase = NewSupabase(handler);

        handler.Response = () => new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent($"\"{ResponseId}\"", Encoding.UTF8, "application/json") };
        (await supabase.RecordGuestResponseAsync(Record(), TestContext.Current.CancellationToken))
            .Should().Be(GuestResponseSendResult.Ok);
        handler.LastUrl.Should().Be("https://projet.supabase.co/rest/v1/rpc/kiosk_record_guest_response");

        handler.Response = () => new HttpResponseMessage(HttpStatusCode.BadRequest)
            { Content = new StringContent("""{"code":"22023","message":"reponse invalide"}""") };
        (await supabase.RecordGuestResponseAsync(Record(), TestContext.Current.CancellationToken))
            .Should().Be(GuestResponseSendResult.Rejected("22023"));

        handler.Response = () => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        (await supabase.RecordGuestResponseAsync(Record(), TestContext.Current.CancellationToken))
            .Should().Be(GuestResponseSendResult.Rejected("HTTP 503"));
    }

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

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastUrl = request.RequestUri!.AbsoluteUri;
            return Task.FromResult(Response());
        }
    }
}
