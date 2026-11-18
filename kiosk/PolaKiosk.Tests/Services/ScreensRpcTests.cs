using System.Net;
using System.Text;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-297 : écrans composés lus par la RPC kiosk_get_screens (licence de la borne). Réponses HTTP simulées.</summary>
public class ScreensRpcTests
{
    private static readonly Guid EventId = PolaFixture.EventId;

    [Fact]
    public void Body_uses_exactly_the_sql_argument_names()
    {
        var body = JObject.Parse(SupabaseRpcBodies.BuildScreensBody("MACHINE-1", "s3cret", EventId));

        body.Properties().Select(p => p.Name).Should().BeEquivalentTo("p_event_id", "p_machine_id", "p_secret");
        body["p_machine_id"]!.Value<string>().Should().Be("MACHINE-1");
        body["p_secret"]!.Value<string>().Should().Be("s3cret");
        body["p_event_id"]!.Value<string>().Should().Be(EventId.ToString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("""{"home":null,"result":null}""")]
    [InlineData("""{"home":"x","result":42}""")]
    public void Nothing_published_gives_two_nulls(string body)
    {
        var screens = SupabaseRpcResponses.ParseScreensRpcResponse(body);

        screens.Home.Should().BeNull();
        screens.Result.Should().BeNull();
    }

    [Fact]
    public void Each_published_plan_is_kept_as_is()
    {
        var screens = SupabaseRpcResponses.ParseScreensRpcResponse(
            """{"home":null,"result":{"version":7,"kind":"result","background":"https://cdn.example/bg.png","published_at":"2026-11-15T10:00:00Z"}}""");

        screens.Home.Should().BeNull();
        screens.For(ScreenLayout.KindResult)!["version"]!.Value<int>().Should().Be(7);
        screens.Result!["published_at"]!.Type.Should().Be(JTokenType.String, "les dates restent du texte");
    }

    [Fact]
    public async Task Calls_the_rpc_with_the_kiosk_license()
    {
        var handler = new StubHandler(() => Json(HttpStatusCode.OK, """{"home":{"version":1},"result":null}"""));

        var screens = await NewSupabase(handler).GetScreensAsync(EventId, TestContext.Current.CancellationToken);

        screens.Home!["version"]!.Value<int>().Should().Be(1);
        handler.LastMethod.Should().Be(HttpMethod.Post);
        handler.LastUrl.Should().Be("https://projet.supabase.co/rest/v1/rpc/kiosk_get_screens");
        var body = JObject.Parse(handler.LastBody!);
        body["p_machine_id"]!.Value<string>().Should().Be("MACHINE-1");
        body["p_secret"]!.Value<string>().Should().Be("s3cret");
        body["p_event_id"]!.Value<string>().Should().Be(EventId.ToString());
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task Reports_a_refused_license(HttpStatusCode status)
    {
        var handler = new StubHandler(() => Json(status, """{"code":"42501","message":"licence de la borne invalide"}"""));

        var act = () => NewSupabase(handler).GetScreensAsync(EventId, TestContext.Current.CancellationToken);

        await act.Should().ThrowAsync<KioskLicenseRefusedException>();
    }

    [Fact]
    public async Task Other_server_errors_are_raised()
    {
        var handler = new StubHandler(() => Json(HttpStatusCode.InternalServerError, """{"code":"XX000","message":"boom"}"""));

        var act = () => NewSupabase(handler).GetScreensAsync(EventId, TestContext.Current.CancellationToken);

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
        public HttpMethod? LastMethod { get; private set; }
        public string? LastUrl { get; private set; }
        public string? LastBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastMethod = request.Method;
            LastUrl = request.RequestUri!.AbsoluteUri;
            LastBody = request.Content == null ? null : await request.Content.ReadAsStringAsync(ct);
            return response();
        }
    }
}
