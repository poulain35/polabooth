using System.Net;
using System.Net.Http;
using System.Text;
using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// Open core K2 : lecture de https://<saas>/kiosk-config.json (réponses HTTP simulées).
public class KioskConfigClientTests
{
    private const string Origin = "https://photobooth.mon-entreprise.fr";
    private const string ValidJson = """{ "supabaseUrl": "https://abc.supabase.co", "supabaseAnonKey": "cle-anon" }""";

    [Fact]
    public async Task Valid_config_is_returned_and_read_at_the_root()
    {
        var handler = new StubHandler(_ => Respond(HttpStatusCode.OK, ValidJson));
        using var client = new KioskConfigClient(handler);

        var config = await client.FetchAsync(Origin, TestContext.Current.CancellationToken);

        config.Should().Be(new SaasConfig("https://abc.supabase.co", "cle-anon"));
        handler.Requests.Should().ContainSingle()
            .Which.Should().Be("GET https://photobooth.mon-entreprise.fr/kiosk-config.json");
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.NoContent)]
    public async Task Non_200_answer_is_a_failure(HttpStatusCode status)
    {
        using var client = new KioskConfigClient(new StubHandler(_ => Respond(status, ValidJson)));

        (await client.FetchAsync(Origin, TestContext.Current.CancellationToken)).Should().BeNull();
    }

    [Theory]
    [InlineData("<!doctype html><html><body>SaaS</body></html>")]
    [InlineData("{ pas du json")]
    [InlineData("""{ "supabaseUrl": "https://abc.supabase.co" }""")]
    public async Task Invalid_or_incomplete_json_is_a_failure(string body)
    {
        using var client = new KioskConfigClient(new StubHandler(_ => Respond(HttpStatusCode.OK, body)));

        (await client.FetchAsync(Origin, TestContext.Current.CancellationToken)).Should().BeNull();
    }

    [Fact]
    public async Task Network_error_is_a_failure()
    {
        using var client = new KioskConfigClient(new StubHandler(_ => throw new HttpRequestException("DNS")));

        (await client.FetchAsync(Origin, TestContext.Current.CancellationToken)).Should().BeNull();
    }

    [Fact]
    public async Task Requested_cancellation_is_propagated()
    {
        using var client = new KioskConfigClient(new StubHandler(_ => Respond(HttpStatusCode.OK, ValidJson)));
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var act = () => client.FetchAsync(Origin, cts.Token);

        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    private static HttpResponseMessage Respond(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<string> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            Requests.Add($"{request.Method} {request.RequestUri}");
            return Task.FromResult(respond(request));
        }
    }
}
