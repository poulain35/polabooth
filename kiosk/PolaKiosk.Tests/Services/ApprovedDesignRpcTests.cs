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
        var body = JObject.Parse(SupabaseRpcBodies.BuildApprovedDesignBody("MACHINE-1", "s3cret", EventId));

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
        => ApprovedDesignReader.ParseApprovedDesignRpcResponse(body).Should().BeNull();

    [Fact]
    public void Parse_reads_the_design_like_the_pola_file()
    {
        var design = ApprovedDesignReader.ParseApprovedDesignRpcResponse(PolaFixture.Design().ToString())!;

        design.Should().BeEquivalentTo(ApprovedDesignReader.ParseApprovedDesign(PolaFixture.Design()));
        design.Id.Should().Be(PolaFixture.DesignId);
        design.Format.Should().Be("stripV");
        design.ThumbnailUrl.Should().Be(PolaFixture.DesignPngUrl);
        CompositeService.ParsePhotoZones(design.CanvasJson).Should().Equal(new PhotoZone(20, 30, 160, 120));
    }

    [Fact]
    public void Parse_reads_the_validated_home_design_of_the_client()
    {
        var design = ApprovedDesignReader.ParseApprovedDesignRpcResponse(PolaFixture.DesignWithHome().ToString())!;

        design.HomeDesign.Should().Be(new Models.Supabase.HomeDesignDto(PolaFixture.HomeDesignId, PolaFixture.HomeDesignPngUrl));
        design.Id.Should().Be(PolaFixture.DesignId, "le modèle photo reste celui de la racine");
        ApprovedDesignReader.ParseApprovedDesignRpcResponse(PolaFixture.Design().ToString())!.HomeDesign.Should().BeNull();
    }

    [Theory]
    [InlineData("null")]
    [InlineData("\"https://cdn.example/home.png\"")]
    [InlineData("""{"final_png_url":"https://cdn.example/home.png"}""")]
    [InlineData("""{"id":"pas-un-guid","final_png_url":"https://cdn.example/home.png"}""")]
    [InlineData("""{"id":"00000000-0000-0000-0000-000000000000","final_png_url":"https://cdn.example/home.png"}""")]
    [InlineData("""{"id":42,"final_png_url":"https://cdn.example/home.png"}""")]
    [InlineData("""{"id":"1b2c3d4e-3333-4444-8555-b66677778888"}""")]
    [InlineData("""{"id":"1b2c3d4e-3333-4444-8555-b66677778888","final_png_url":null}""")]
    [InlineData("""{"id":"1b2c3d4e-3333-4444-8555-b66677778888","final_png_url":"  "}""")]
    [InlineData("""{"id":"1b2c3d4e-3333-4444-8555-b66677778888","final_png_url":12}""")]
    public void An_unreadable_home_design_is_ignored_but_the_print_design_is_kept(string homeDesign)
    {
        var body = PolaFixture.Design();
        body["home_design"] = JToken.Parse(homeDesign);

        var design = ApprovedDesignReader.ParseApprovedDesignRpcResponse(body.ToString())!;

        design.Id.Should().Be(PolaFixture.DesignId);
        design.HomeDesign.Should().BeNull();
    }

    // ── Choix du cadre (LAB-315) ──────────────────────────────────────────────

    [Fact]
    public void Parse_reads_the_label_and_the_other_frames_in_their_order()
    {
        var design = ApprovedDesignReader.ParseApprovedDesignRpcResponse(PolaFixture.DesignWithFrames().ToString())!;

        design.Id.Should().Be(PolaFixture.DesignId);
        design.Name.Should().Be(PolaFixture.DesignLabel);
        design.Frames.Select(f => f.Id).Should().Equal(PolaFixture.StripFrameId, PolaFixture.LandscapeFrameId);
        design.Frames.Select(f => f.Name).Should().Equal(PolaFixture.StripFrameLabel, "Cadre 3");
        design.Frames.Select(f => f.Format).Should().Equal("stripV", "landscape");
        design.Frames.Select(f => f.ThumbnailUrl).Should().Equal(PolaFixture.StripFramePngUrl, PolaFixture.LandscapeFramePngUrl);
        CompositeService.ParsePhotoZones(design.Frames[0].CanvasJson).Should().Equal(new PhotoZone(20, 30, 160, 120));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_design_without_label_is_named_after_its_slot(string? label)
    {
        var body = PolaFixture.Design();
        body["label"] = label;

        ApprovedDesignReader.ParseApprovedDesign(body).Name.Should().Be("Cadre 1");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("\"frames\"")]
    public void Without_frames_only_the_main_design_is_kept(string? frames)
    {
        var body = PolaFixture.Design();
        if (frames != null) body["frames"] = JToken.Parse(frames);

        var design = ApprovedDesignReader.ParseApprovedDesignRpcResponse(body.ToString())!;

        design.Id.Should().Be(PolaFixture.DesignId);
        design.Frames.Should().BeEmpty();
    }

    // Un cadre illisible est écarté, le cadre suivant et le design principal restent.
    [Theory]
    [InlineData("null")]
    [InlineData("42")]
    [InlineData("\"https://cdn.example/f.png\"")]
    [InlineData("""{"final_png_url":"https://cdn.example/f.png"}""")]
    [InlineData("""{"id":"pas-un-guid","final_png_url":"https://cdn.example/f.png"}""")]
    [InlineData("""{"id":42,"final_png_url":"https://cdn.example/f.png"}""")]
    [InlineData("""{"id":"00000000-0000-0000-0000-000000000000","final_png_url":"https://cdn.example/f.png"}""")]
    [InlineData("""{"id":"0a9b8c7d-2222-4333-8444-a55566667777","final_png_url":"https://cdn.example/f.png"}""")] // design principal
    [InlineData("""{"id":"3c4d5e6f-5555-4666-8777-d88899990000","final_png_url":"https://cdn.example/f.png"}""")] // doublon
    [InlineData("""{"id":"5e6f7081-7777-4888-8999-faaa0000bbbb"}""")]
    [InlineData("""{"id":"5e6f7081-7777-4888-8999-faaa0000bbbb","final_png_url":null}""")]
    [InlineData("""{"id":"5e6f7081-7777-4888-8999-faaa0000bbbb","final_png_url":"  "}""")]
    [InlineData("""{"id":"5e6f7081-7777-4888-8999-faaa0000bbbb","final_png_url":12}""")]
    public void An_unreadable_frame_is_ignored(string frame)
    {
        var body = PolaFixture.Design();
        body["frames"] = new JArray(PolaFixture.Frames()[0], JToken.Parse(frame), PolaFixture.Frames()[1]);

        var design = ApprovedDesignReader.ParseApprovedDesignRpcResponse(body.ToString())!;

        design.Id.Should().Be(PolaFixture.DesignId);
        design.Frames.Select(f => f.Id).Should().Equal(PolaFixture.StripFrameId, PolaFixture.LandscapeFrameId);
    }

    [Fact]
    public void At_most_three_other_frames_are_kept()
    {
        var ids = Enumerable.Range(0, 5).Select(_ => Guid.NewGuid()).ToList();
        var body = PolaFixture.Design();
        body["frames"] = new JArray(ids.Select((id, i) =>
            PolaFixture.Frame(id, i + 2, null, "portrait", $"https://cdn.example/frames/{i}.png")));

        var design = ApprovedDesignReader.ParseApprovedDesign(body);

        design.Frames.Select(f => f.Id).Should().Equal(ids.Take(3), "4 cadres au plus avec le design principal");
        design.Frames.Select(f => f.Name).Should().Equal("Cadre 2", "Cadre 3", "Cadre 4");
    }

    [Fact]
    public void Parse_keeps_dates_of_the_canvas_as_written()
    {
        const string body = """
        { "id": "6f1d2c3b-1111-4222-8333-944455556666", "format": "portrait", "final_png_url": null,
          "canvas_json": { "objects": [ { "type": "textbox", "text": "2026-11-05T10:00:00+00:00" } ] } }
        """;

        var design = ApprovedDesignReader.ParseApprovedDesignRpcResponse(body)!;

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
