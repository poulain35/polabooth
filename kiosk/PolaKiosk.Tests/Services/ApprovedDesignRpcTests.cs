using System.Net;
using System.Text;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// LAB-246 : design approuvé lu par la RPC kiosk_get_approved_design (licence de la borne), plus par
/// rest/v1/client_designs. Réponses HTTP simulées.
/// </summary>
public class ApprovedDesignRpcTests
{
    private static readonly Guid EventId = PolaFixture.EventId;

    [Fact]
    public void Body_uses_exactly_the_sql_argument_names()
    {
        var body = JObject.Parse(SupabaseService.BuildApprovedDesignBody("MACHINE-1", "s3cret", EventId));

        body.Properties().Select(p => p.Name).Should().BeEquivalentTo("p_machine_id", "p_secret", "p_event_id");
        body["p_machine_id"]!.Value<string>().Should().Be("MACHINE-1");
        body["p_secret"]!.Value<string>().Should().Be("s3cret");
        body["p_event_id"]!.Value<string>().Should().Be(EventId.ToString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("""{"format":"portrait"}""")]
    [InlineData("""{"id":null}""")]
    public void Parse_returns_null_without_an_approved_design(string body)
        => SupabaseService.ParseApprovedDesignRpcResponse(body).Should().BeNull();

    [Fact]
    public void Parse_reads_the_design_like_the_pola_file()
    {
        var design = SupabaseService.ParseApprovedDesignRpcResponse(PolaFixture.Design().ToString())!;

        design.Should().BeEquivalentTo(SupabaseService.ParseApprovedDesign(PolaFixture.Design()));
        design.Id.Should().Be(PolaFixture.DesignId);
        design.Format.Should().Be("stripV");
        design.ThumbnailUrl.Should().Be(PolaFixture.DesignPngUrl);
        CompositeService.ParsePhotoZones(design.CanvasJson).Should().Equal(new PhotoZone(20, 30, 160, 120));
    }

    [Fact]
    public void Parse_keeps_dates_of_the_canvas_as_written()
    {
        const string body = """
        { "id": "6f1d2c3b-1111-4222-8333-944455556666", "format": "portrait", "final_png_url": null,
          "canvas_json": { "objects": [ { "type": "textbox", "text": "2026-11-05T10:00:00+00:00" } ] } }
        """;

        var design = SupabaseService.ParseApprovedDesignRpcResponse(body)!;

        design.CanvasJson.Should().Contain("2026-11-05T10:00:00+00:00");
        design.ThumbnailUrl.Should().BeNull();
    }

    [Fact]
    public async Task Calls_the_rpc_with_the_kiosk_license()
    {
        var handler = new StubHandler(() => Json(HttpStatusCode.OK, PolaFixture.Design().ToString()));

        var design = await NewSupabase(handler).GetApprovedDesignAsync(EventId, TestContext.Current.CancellationToken);

        design!.Id.Should().Be(PolaFixture.DesignId);
        handler.LastMethod.Should().Be(HttpMethod.Post);
        handler.LastUrl.Should().Be("https://projet.supabase.co/rest/v1/rpc/kiosk_get_approved_design");
        var body = JObject.Parse(handler.LastBody!);
        body["p_machine_id"]!.Value<string>().Should().Be("MACHINE-1");
        body["p_secret"]!.Value<string>().Should().Be("s3cret");
        body["p_event_id"]!.Value<string>().Should().Be(EventId.ToString());
    }

    [Fact]
    public async Task Returns_null_without_an_approved_design()
    {
        var handler = new StubHandler(() => Json(HttpStatusCode.OK, "null"));

        (await NewSupabase(handler).GetApprovedDesignAsync(EventId, TestContext.Current.CancellationToken))
            .Should().BeNull();
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task Reports_a_refused_license(HttpStatusCode status)
    {
        var handler = new StubHandler(() => Json(status, """{"code":"42501","message":"licence de la borne invalide"}"""));

        var act = () => NewSupabase(handler).GetApprovedDesignAsync(EventId, TestContext.Current.CancellationToken);

        await act.Should().ThrowAsync<KioskLicenseRefusedException>();
    }

    [Fact]
    public async Task Other_server_errors_are_raised()
    {
        var handler = new StubHandler(() => Json(HttpStatusCode.InternalServerError, """{"code":"XX000","message":"boom"}"""));

        var act = () => NewSupabase(handler).GetApprovedDesignAsync(EventId, TestContext.Current.CancellationToken);

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
