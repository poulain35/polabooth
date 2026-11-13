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

/// <summary>LAB-223 : appel de kiosk_record_photo_consent (corps, codes d'erreur). Réponses HTTP simulées.</summary>
public class PhotoConsentRpcTests
{
    private static readonly Guid ConsentId = Guid.Parse("0a0b0c0d-1111-4222-8333-944455556666");
    private static readonly Guid EventId   = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private static readonly Guid SessionId = Guid.Parse("1b2c3d4e-1111-4222-8333-944455556666");

    private static PhotoConsentRecord Record() => new(
        Id:             ConsentId,
        EventId:        EventId,
        AccessCode:     "TUQNA5",
        SessionId:      SessionId,
        ConsentedAtUtc: new DateTime(2026, 11, 4, 18, 30, 5, 123, DateTimeKind.Utc),
        ConsentText:    "J'accepte que ma photo soit prise.");

    private static JObject Parse(string json)
        => JsonConvert.DeserializeObject<JObject>(json, new JsonSerializerSettings { DateParseHandling = DateParseHandling.None })!;

    [Fact]
    public void Body_uses_exactly_the_sql_argument_names()
    {
        var body = Parse(SupabaseService.BuildPhotoConsentBody(Record(), "MACHINE-1", "s3cret"));

        body.Properties().Select(p => p.Name).Should().BeEquivalentTo(
            "p_code", "p_event_id", "p_machine_id", "p_secret", "p_consent_id", "p_session_id",
            "p_consented_at", "p_consent_text");
        body["p_code"]!.Value<string>().Should().Be("TUQNA5");
        body["p_event_id"]!.Value<string>().Should().Be(EventId.ToString());
        body["p_machine_id"]!.Value<string>().Should().Be("MACHINE-1");
        body["p_secret"]!.Value<string>().Should().Be("s3cret");
        body["p_consent_id"]!.Value<string>().Should().Be(ConsentId.ToString());
        body["p_session_id"]!.Value<string>().Should().Be(SessionId.ToString());
        body["p_consented_at"]!.Value<string>().Should().Be("2026-11-04T18:30:05.123Z");
        body["p_consent_text"]!.Value<string>().Should().Be("J'accepte que ma photo soit prise.");
    }

    [Fact]
    public void Empty_consent_text_is_sent_as_is()
    {
        var body = Parse(SupabaseService.BuildPhotoConsentBody(Record() with { ConsentText = "" }, "MACHINE-1", "s3cret"));

        body["p_consent_text"]!.Value<string>().Should().BeEmpty();
    }

    [Fact]
    public async Task Accepted_and_refused_consents_are_told_apart()
    {
        var handler = new StubHandler();
        var supabase = NewSupabase(handler);

        handler.Response = () => new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent($"\"{ConsentId}\"", Encoding.UTF8, "application/json") };
        (await supabase.RecordPhotoConsentAsync(Record(), TestContext.Current.CancellationToken))
            .Should().Be(PhotoConsentSendResult.Ok);
        handler.LastUrl.Should().Be("https://projet.supabase.co/rest/v1/rpc/kiosk_record_photo_consent");

        handler.Response = () => new HttpResponseMessage(HttpStatusCode.BadRequest)
            { Content = new StringContent("""{"code":"22023","message":"kiosk_record_photo_consent : consentement invalide"}""") };
        (await supabase.RecordPhotoConsentAsync(Record(), TestContext.Current.CancellationToken))
            .Should().Be(PhotoConsentSendResult.Rejected("22023"));

        handler.Response = () => new HttpResponseMessage(HttpStatusCode.BadRequest)
            { Content = new StringContent("""{"code":"P0001","message":"kiosk_record_photo_consent : licence kiosk invalide ou inactive"}""") };
        var refused = await supabase.RecordPhotoConsentAsync(Record(), TestContext.Current.CancellationToken);
        refused.Should().Be(PhotoConsentSendResult.Rejected("P0001"));
        refused.ErrorCode.Should().NotContain("licence");

        handler.Response = () => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        (await supabase.RecordPhotoConsentAsync(Record(), TestContext.Current.CancellationToken))
            .Should().Be(PhotoConsentSendResult.Rejected("HTTP 503"));
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
