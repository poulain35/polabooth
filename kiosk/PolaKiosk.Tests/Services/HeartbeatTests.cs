using System.Net;
using System.Text;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-231 : le battement de cœur annonce le nombre d'envois en attente (p_pending_uploads).</summary>
public sealed class HeartbeatTests : IDisposable
{
    private const string SupabaseUrl = "https://projet.supabase.co";
    private readonly TempDir _dir = new();
    private readonly CapturingHandler _http = new();
    private readonly ServiceProvider _services = new ServiceCollection().BuildServiceProvider();

    public void Dispose()
    {
        _services.Dispose();
        _dir.Dispose();
    }

    [Fact]
    public void Body_uses_kiosk_heartbeat_argument_names()
    {
        var body = JObject.Parse(LicenseService.BuildHeartbeatBody("MACHINE-1", "s3cret", "1.0.20", "ready", "DNP", 4));

        body.Properties().Select(p => p.Name).Should().BeEquivalentTo(
            "p_machine_id", "p_secret", "p_app_version", "p_printer_status", "p_printer_name", "p_pending_uploads",
            "p_camera_status", "p_camera_report");
        body["p_pending_uploads"]!.Value<int>().Should().Be(4);
        body["p_app_version"]!.ToString().Should().Be("1.0.20");
    }

    [Fact]
    public void Unknown_count_is_sent_as_null_not_zero()
    {
        var body = JObject.Parse(LicenseService.BuildHeartbeatBody("MACHINE-1", "s3cret", "1.0.20", "ready", "DNP", null));

        body["p_pending_uploads"]!.Type.Should().Be(JTokenType.Null);
    }

    [Fact]
    public async Task Heartbeat_sends_the_pending_uploads_count()
    {
        var counter = new Mock<IPendingUploadsCounter>();
        counter.Setup(c => c.CountAsync()).ReturnsAsync(7);

        await NewLicense(counter.Object).SendHeartbeatAsync();

        var call = _http.Calls.Should().ContainSingle().Subject;
        call.Uri.Should().Be(SupabaseUrl + "/rest/v1/rpc/kiosk_heartbeat");
        JObject.Parse(call.Body)["p_pending_uploads"]!.Value<int>().Should().Be(7);
    }

    // ── LAB-263 : état de l'appareil photo (p_camera_status) ──────────────────

    [Theory]
    [InlineData(CameraHealth.Present, "ok")]
    [InlineData(CameraHealth.Absent, "disconnected")]
    public async Task Heartbeat_sends_the_camera_status(CameraHealth status, string expected)
    {
        var health = new Mock<ICameraHealthService>();
        health.SetupGet(h => h.HeartbeatValue).Returns(CameraHealthService.ToHeartbeatValue(status));

        await NewLicense(Mock.Of<IPendingUploadsCounter>(), health.Object).SendHeartbeatAsync();

        JObject.Parse(_http.Calls.Single().Body)["p_camera_status"]!.ToString().Should().Be(expected);
    }

    [Fact]
    public async Task Unknown_camera_status_is_sent_as_null()
    {
        var health = new Mock<ICameraHealthService>();
        health.SetupGet(h => h.HeartbeatValue).Returns((string?)null);

        await NewLicense(Mock.Of<IPendingUploadsCounter>(), health.Object).SendHeartbeatAsync();
        await NewLicense(Mock.Of<IPendingUploadsCounter>()).SendHeartbeatAsync(); // sans service : inconnu aussi

        _http.Calls.Should().HaveCount(2);
        _http.Calls.Should().AllSatisfy(c => JObject.Parse(c.Body)["p_camera_status"]!.Type.Should().Be(JTokenType.Null));
    }

    // ── LAB-428 : rapport des réglages de l'appareil (p_camera_report) ─────────

    [Fact]
    public void Camera_report_is_sent_as_an_object_and_null_without_one()
    {
        var withReport = JObject.Parse(LicenseService.BuildHeartbeatBody("MACHINE-1", "s3cret", "1.0.20", "ready", "DNP", 0,
            cameraReportJson: """{"model":"Canon EOS R100","mode":"M"}"""));
        var without = JObject.Parse(LicenseService.BuildHeartbeatBody("MACHINE-1", "s3cret", "1.0.20", "ready", "DNP", 0));

        withReport["p_camera_report"]!.Type.Should().Be(JTokenType.Object);
        withReport["p_camera_report"]!["mode"]!.ToString().Should().Be("M");
        without["p_camera_report"]!.Type.Should().Be(JTokenType.Null);
    }

    [Fact]
    public async Task Heartbeat_sends_the_camera_report_and_marks_it_sent()
    {
        const string report = """{"model":"Canon EOS R100","mode":"M","at":"2026-11-19T10:00:00Z"}""";
        var sync = new Mock<ICameraSettingsSync>();
        sync.Setup(s => s.ReportForHeartbeat()).Returns(report);

        await NewLicense(Mock.Of<IPendingUploadsCounter>(), cameraSync: sync.Object).SendHeartbeatAsync();

        JObject.Parse(_http.Calls.Single().Body)["p_camera_report"]!["model"]!.ToString().Should().Be("Canon EOS R100");
        sync.Verify(s => s.MarkReportSent(report), Times.Once);
    }

    [Fact]
    public async Task Refused_heartbeat_does_not_mark_the_camera_report_sent()
    {
        _http.Status = HttpStatusCode.InternalServerError;
        var sync = new Mock<ICameraSettingsSync>();
        sync.Setup(s => s.ReportForHeartbeat()).Returns("""{"model":"Canon EOS R100"}""");

        await NewLicense(Mock.Of<IPendingUploadsCounter>(), cameraSync: sync.Object).SendHeartbeatAsync();

        sync.Verify(s => s.MarkReportSent(It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task Unchanged_camera_report_is_not_resent()
    {
        var sync = new Mock<ICameraSettingsSync>();
        sync.Setup(s => s.ReportForHeartbeat()).Returns((string?)null);

        await NewLicense(Mock.Of<IPendingUploadsCounter>(), cameraSync: sync.Object).SendHeartbeatAsync();

        JObject.Parse(_http.Calls.Single().Body)["p_camera_report"]!.Type.Should().Be(JTokenType.Null);
        sync.Verify(s => s.MarkReportSent(It.IsAny<string>()), Times.Never);
    }

    private LicenseService NewLicense(IPendingUploadsCounter counter, ICameraHealthService? cameraHealth = null,
        ICameraSettingsSync? cameraSync = null)
    {
        var credentials = new Mock<IKioskCredentials>();
        credentials.SetupGet(c => c.MachineId).Returns("MACHINE-1");
        credentials.SetupGet(c => c.Secret).Returns("s3cret");
        var settings = new AppSettings { Supabase = new SupabaseSettings { Url = SupabaseUrl, AnonKey = "anon-key" } };
        settings.Kiosk.PrinterName = "Imprimante absente du poste de test";
        var supabase = new SupabaseService(settings, credentials.Object,
            _services.GetRequiredService<IServiceScopeFactory>(), _http);
        return new LicenseService(supabase, settings, credentials.Object, new Mock<IAdminPinService>().Object,
            counter, _dir.Path, cameraHealth, cameraSync);
    }

    private sealed record Call(string Uri, string Body);

    private sealed class CapturingHandler : HttpMessageHandler
    {
        public List<Call> Calls { get; } = [];
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content == null ? "" : await request.Content.ReadAsStringAsync(ct);
            Calls.Add(new Call(request.RequestUri!.AbsoluteUri, body));
            return new HttpResponseMessage(Status)
            {
                Content = new StringContent("", Encoding.UTF8, "application/json"),
            };
        }
    }
}
