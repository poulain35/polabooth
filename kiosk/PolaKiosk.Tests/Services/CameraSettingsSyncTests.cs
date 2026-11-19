using System.Net.Http;
using FluentAssertions;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models;
using PolaKiosk.Services;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// LAB-428 : réglages de l'appareil photo demandés depuis le SaaS (appliqués seulement sur un écran sûr,
/// le dernier réglage gagne, confirmation renvoyée après une coupure) et rapport de l'appareil envoyé
/// dans le battement de cœur.
/// </summary>
public sealed class CameraSettingsSyncTests
{
    private const string RequestedAt = "2026-11-19T10:00:00.123456+00:00";
    private static readonly DateTimeOffset RequestedAtValue = DateTimeOffset.Parse(RequestedAt);
    private static readonly CameraExposureValues Asked = new() { Tv = 0x6B, Iso = 0x50 };

    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly Mock<IMachineSettingsService> _machine = new();
    private readonly Mock<INavigationService> _navigation = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly FakeCamera _camera = new();
    private readonly FakeClock _clock = new(new DateTimeOffset(2026, 11, 19, 12, 0, 0, TimeSpan.Zero));
    private readonly CameraSettingsSyncService _sync;
    private Type? _view = typeof(HomeView);
    private MachineSettings _settings = new();

    public CameraSettingsSyncTests()
    {
        _navigation.SetupGet(n => n.CurrentViewType).Returns(() => _view);
        _machine.SetupGet(m => m.Current).Returns(() => _settings);
        _supabase.Setup(s => s.GetCameraRequestAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CameraSettingsRequest(Asked, RequestedAt));
        _supabase.Setup(s => s.AckCameraRequestAsync(It.IsAny<string>(), It.IsAny<string>(),
            It.IsAny<CameraExposureValues?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _log.Setup(l => l.LogInfoAsync(It.IsAny<string>(), It.IsAny<string>())).Returns(Task.CompletedTask);
        _log.Setup(l => l.LogWarningAsync(It.IsAny<string>(), It.IsAny<string>())).Returns(Task.CompletedTask);
        _sync = new CameraSettingsSyncService(_supabase.Object, () => _camera, _machine.Object, _navigation.Object,
            _log.Object, _clock);
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private void VerifyAck(string status, Times times)
        => _supabase.Verify(s => s.AckCameraRequestAsync(RequestedAt, status, It.IsAny<CameraExposureValues?>(),
            It.IsAny<string?>(), It.IsAny<CancellationToken>()), times);

    private string? AckError()
        => _supabase.Invocations.Where(i => i.Method.Name == nameof(ISupabaseService.AckCameraRequestAsync))
            .Select(i => (string?)i.Arguments[3]).Last();

    // ── Demande du SaaS ───────────────────────────────────────────────────────

    [Fact]
    public async Task Nothing_to_apply_without_a_request()
    {
        _supabase.Setup(s => s.GetCameraRequestAsync(It.IsAny<CancellationToken>())).ReturnsAsync((CameraSettingsRequest?)null);

        await _sync.PollAsync(Ct);

        _sync.HasPending.Should().BeFalse();
        (await _sync.TryApplyAsync(Ct)).Should().BeFalse();
        _camera.Applied.Should().BeEmpty();
    }

    [Fact]
    public async Task Applies_on_home_then_confirms_with_the_values_obtained()
    {
        _camera.ApplyResult = State(new CameraExposureValues { Tv = 0x6B, Av = 0x30, Iso = 0x50 });

        await _sync.PollAsync(Ct);
        (await _sync.TryApplyAsync(Ct)).Should().BeTrue();

        _camera.Applied.Should().ContainSingle().Which.Should().Be((Asked, RequestedAtValue));
        _supabase.Verify(s => s.AckCameraRequestAsync(RequestedAt, "applied",
            It.Is<CameraExposureValues?>(v => v!.Av == 0x30 && v.Tv == 0x6B), null, It.IsAny<CancellationToken>()), Times.Once);
        _sync.HasPending.Should().BeFalse();
        JObject.Parse(_sync.ReportForHeartbeat()!)["values"]!["av"]!.Value<int>().Should().Be(0x30);
    }

    [Fact]
    public async Task Waits_for_a_safe_screen_during_a_guest_session()
    {
        _view = typeof(LiveView);

        await _sync.PollAsync(Ct);
        (await _sync.TryApplyAsync(Ct)).Should().BeFalse();

        _camera.Applied.Should().BeEmpty();
        _sync.HasPending.Should().BeTrue();
        VerifyAck("applied", Times.Never());
        VerifyAck("refused", Times.Never());

        _view = typeof(HomeView);
        (await _sync.TryApplyAsync(Ct)).Should().BeTrue();
        _camera.Applied.Should().ContainSingle();
    }

    [Fact]
    public async Task A_later_setting_made_on_the_kiosk_wins()
    {
        _settings = _settings with
        {
            CameraExposure = new SavedCameraExposure { Values = new CameraExposureValues { Tv = 0x60 }, ChangedAt = RequestedAtValue.AddMinutes(5) },
        };

        await _sync.PollAsync(Ct);
        await _sync.TryApplyAsync(Ct);

        _camera.Applied.Should().BeEmpty();
        VerifyAck("refused", Times.Once());
        AckError().Should().StartWith("Remplacé par un réglage fait sur la borne");
    }

    [Fact]
    public async Task An_older_setting_made_on_the_kiosk_does_not_block_the_request()
    {
        _settings = _settings with
        {
            CameraExposure = new SavedCameraExposure { Values = new CameraExposureValues { Tv = 0x60 }, ChangedAt = RequestedAtValue.AddMinutes(-5) },
        };

        await _sync.PollAsync(Ct);
        await _sync.TryApplyAsync(Ct);

        _camera.Applied.Should().ContainSingle();
        VerifyAck("applied", Times.Once());
    }

    [Fact]
    public async Task Refusal_by_the_camera_is_confirmed_with_its_reason_and_the_state_read()
    {
        _camera.ApplyError = new CameraExposureException("Mettez la molette de l'appareil sur M.",
            State(new CameraExposureValues { Tv = 0x60 }, mode: "Av"));

        await _sync.PollAsync(Ct);
        await _sync.TryApplyAsync(Ct);

        VerifyAck("refused", Times.Once());
        AckError().Should().Be("Mettez la molette de l'appareil sur M.");
        _sync.HasPending.Should().BeFalse();
        JObject.Parse(_sync.ReportForHeartbeat()!)["mode"]!.ToString().Should().Be("Av");
    }

    [Fact]
    public async Task Webcam_refuses_the_request()
    {
        _camera.Supports = false;

        await _sync.PollAsync(Ct);
        await _sync.TryApplyAsync(Ct);

        _camera.Applied.Should().BeEmpty();
        VerifyAck("refused", Times.Once());
        AckError().Should().Contain("Canon");
    }

    [Fact]
    public async Task Camera_absent_refuses_the_request()
    {
        _camera.ApplyResult = null;

        await _sync.PollAsync(Ct);
        await _sync.TryApplyAsync(Ct);

        AckError().Should().Be("Appareil photo non connecté.");
    }

    [Fact]
    public async Task Unreadable_request_date_is_refused_without_touching_the_camera()
    {
        _supabase.Setup(s => s.GetCameraRequestAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CameraSettingsRequest(Asked, "pas une date"));

        await _sync.PollAsync(Ct);
        await _sync.TryApplyAsync(Ct);

        _camera.Applied.Should().BeEmpty();
        _supabase.Verify(s => s.AckCameraRequestAsync("pas une date", "refused", null, "Demande illisible par la borne.",
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Lost_confirmation_is_resent_before_the_next_read()
    {
        _camera.ApplyResult = State(Asked);
        _supabase.SetupSequence(s => s.AckCameraRequestAsync(It.IsAny<string>(), It.IsAny<string>(),
                It.IsAny<CameraExposureValues?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("réseau coupé"))
            .ReturnsAsync(true);

        await _sync.PollAsync(Ct);
        (await _sync.TryApplyAsync(Ct)).Should().BeTrue(); // confirmation perdue, pas d'exception
        _supabase.Setup(s => s.GetCameraRequestAsync(It.IsAny<CancellationToken>())).ReturnsAsync((CameraSettingsRequest?)null);

        await _sync.PollAsync(Ct);

        VerifyAck("applied", Times.Exactly(2));
        _camera.Applied.Should().ContainSingle(); // jamais réappliquée
        await _sync.PollAsync(Ct);
        VerifyAck("applied", Times.Exactly(2)); // une seule fois renvoyée
    }

    [Fact]
    public async Task Refused_license_clears_the_request()
    {
        await _sync.PollAsync(Ct);
        _supabase.Setup(s => s.GetCameraRequestAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new KioskLicenseRefusedException());

        await _sync.PollAsync(Ct);

        _sync.HasPending.Should().BeFalse();
    }

    [Fact]
    public async Task Network_error_on_read_is_thrown_and_keeps_the_request()
    {
        await _sync.PollAsync(Ct);
        _supabase.Setup(s => s.GetCameraRequestAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("réseau coupé"));

        await FluentActions.Awaiting(() => _sync.PollAsync(Ct)).Should().ThrowAsync<HttpRequestException>();
        _sync.HasPending.Should().BeTrue();
    }

    // ── Rapport de l'appareil ─────────────────────────────────────────────────

    [Fact]
    public async Task Webcam_is_reported_as_unsupported_without_reading_it()
    {
        _camera.Supports = false;

        await _sync.RefreshReportIfDueAsync(Ct);

        var report = JObject.Parse(_sync.ReportForHeartbeat()!);
        report["supported"]!.Value<bool>().Should().BeFalse();
        report["model"]!.ToString().Should().Be("inconnu");
        _camera.Reads.Should().Be(0);
    }

    [Fact]
    public async Task Camera_is_read_on_a_safe_screen_only()
    {
        _view = typeof(LiveView);
        await _sync.RefreshReportIfDueAsync(Ct);
        _camera.Reads.Should().Be(0);

        _view = typeof(HomeView);
        await _sync.RefreshReportIfDueAsync(Ct);
        _camera.Reads.Should().Be(1);
        JObject.Parse(_sync.ReportForHeartbeat()!)["model"]!.ToString().Should().Be("Canon EOS R100");
    }

    [Fact]
    public async Task Camera_is_read_again_after_30_minutes_or_when_it_signals_a_change()
    {
        await _sync.RefreshReportIfDueAsync(Ct);
        _clock.Advance(TimeSpan.FromMinutes(10));
        await _sync.RefreshReportIfDueAsync(Ct);
        _camera.Reads.Should().Be(1);

        _camera.RaiseOptionsChanged(); // molette tournée
        await _sync.RefreshReportIfDueAsync(Ct);
        _camera.Reads.Should().Be(2);

        _clock.Advance(CameraSettingsSyncService.ReportMaxAge);
        await _sync.RefreshReportIfDueAsync(Ct);
        _camera.Reads.Should().Be(3);
    }

    [Fact]
    public async Task Absent_camera_is_tried_again_every_5_minutes()
    {
        _camera.ReadError = new CameraExposureException("Appareil photo non connecté.", null);

        await _sync.RefreshReportIfDueAsync(Ct);
        await _sync.RefreshReportIfDueAsync(Ct);
        _camera.Reads.Should().Be(1);
        _sync.ReportForHeartbeat().Should().BeNull();

        _clock.Advance(CameraSettingsSyncService.ReadRetryInterval);
        await _sync.RefreshReportIfDueAsync(Ct);
        _camera.Reads.Should().Be(2);
    }

    [Fact]
    public async Task Report_is_sent_again_only_when_it_changes_or_after_30_minutes()
    {
        await _sync.RefreshReportIfDueAsync(Ct);
        var first = _sync.ReportForHeartbeat()!;
        _sync.MarkReportSent(first);

        _clock.Advance(TimeSpan.FromMinutes(1));
        _camera.RaiseOptionsChanged();
        await _sync.RefreshReportIfDueAsync(Ct); // relu, identique sauf l'heure
        _sync.ReportForHeartbeat().Should().BeNull();

        _camera.ReadResult = State(new CameraExposureValues { Tv = 0x70 });
        _camera.RaiseOptionsChanged();
        await _sync.RefreshReportIfDueAsync(Ct);
        var changed = _sync.ReportForHeartbeat();
        changed.Should().NotBeNull();
        _sync.MarkReportSent(changed!);
        _sync.ReportForHeartbeat().Should().BeNull();

        _clock.Advance(CameraSettingsSyncService.ReportMaxAge);
        _sync.ReportForHeartbeat().Should().NotBeNull();
    }

    // ── Fabriques et doublures ────────────────────────────────────────────────

    private CameraExposureState State(CameraExposureValues values, string mode = "M") => new()
    {
        Model    = "Canon EOS R100",
        Mode     = mode,
        Settable = mode == "M",
        Values   = values,
        Options  = new() { [CameraExposureKeys.Tv] = [new CameraOption(0x6B, "1/125"), new CameraOption(0x70, "1/160")] },
        At       = _clock.GetUtcNow(),
    };

    private sealed class FakeCamera : ICameraService
    {
        public bool Supports { get; set; } = true;
        public CameraExposureState? ReadResult { get; set; }
        public CameraExposureException? ReadError { get; set; }
        public CameraExposureState? ApplyResult { get; set; }
        public CameraExposureException? ApplyError { get; set; }
        public int Reads { get; private set; }
        public List<(CameraExposureValues Values, DateTimeOffset ChangedAt)> Applied { get; } = [];

        public FakeCamera()
        {
            ReadResult = new CameraExposureState
            {
                Model = "Canon EOS R100", Mode = "M", Settable = true,
                Values = new CameraExposureValues { Tv = 0x6B }, At = DateTimeOffset.UnixEpoch,
            };
            ApplyResult = ReadResult;
        }

        public bool SupportsExposureSettings => Supports;
        public bool IsConnected => true;
        public event EventHandler? ExposureOptionsChanged;
        public void RaiseOptionsChanged() => ExposureOptionsChanged?.Invoke(this, EventArgs.Empty);

        public Task<CameraExposureState?> ReadExposureNowAsync()
        {
            Reads++;
            if (ReadError != null) throw ReadError;
            return Task.FromResult(ReadResult);
        }

        public Task<CameraExposureState?> ApplyExposureNowAsync(CameraExposureValues values, DateTimeOffset changedAt)
        {
            if (ApplyError != null) throw ApplyError;
            Applied.Add((values, changedAt));
            return Task.FromResult(ApplyResult);
        }

        public Task<CameraExposureState?> ReadExposureAsync() => throw new NotSupportedException("session ouverte seulement");
        public Task<CameraExposureState?> ApplyExposureAsync(CameraExposureValues values) => throw new NotSupportedException();
        public Task InitializeAsync() => Task.CompletedTask;
        public Task StartLiveViewAsync(Action<byte[]> frameCallback) => Task.CompletedTask;
        public Task StopLiveViewAsync() => Task.CompletedTask;
        public Task<string> CaptureAsync(string outputDirectory) => throw new NotSupportedException();
        public Task ShutdownAsync() => Task.CompletedTask;
    }

    private sealed class FakeClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;
        public void Advance(TimeSpan by) => _now += by;
        public override DateTimeOffset GetUtcNow() => _now;
    }
}

/// <summary>LAB-428 : contenu du rapport de l'appareil et des RPC de demande et de confirmation.</summary>
public sealed class CameraReportTests
{
    private static readonly DateTimeOffset At = new(2026, 11, 19, 10, 0, 0, TimeSpan.FromHours(1));

    private static CameraExposureState State(int optionCount = 2) => new()
    {
        Model    = "Canon EOS R100",
        Mode     = "M",
        Settable = true,
        Values   = new CameraExposureValues { Tv = 0x6B, Av = 0x30, Iso = 0x50, Wb = 9, Kelvin = 5200 },
        Options  = new()
        {
            [CameraExposureKeys.Tv] = Enumerable.Range(0, optionCount).Select(i => new CameraOption(i, $"1/{i + 1}")).ToList(),
        },
        At = At,
    };

    [Fact]
    public void Report_has_the_contract_keys_and_one_option_list_per_setting()
    {
        var report = CameraReport.FromState(State());

        report.Properties().Select(p => p.Name).Should().BeEquivalentTo("model", "mode", "settable", "values", "options", "at");
        report["values"]!.ToObject<Dictionary<string, int>>().Should().BeEquivalentTo(new Dictionary<string, int>
        {
            ["tv"] = 0x6B, ["av"] = 0x30, ["iso"] = 0x50, ["wb"] = 9, ["kelvin"] = 5200,
        });
        ((JObject)report["options"]!).Properties().Select(p => p.Name).Should().BeEquivalentTo(CameraExposureKeys.All);
        report["options"]!["tv"]![1]!["label"]!.ToString().Should().Be("1/2");
        ((JArray)report["options"]!["av"]!).Count.Should().Be(0);
        report["at"]!.ToString().Should().Be("2026-11-19T09:00:00Z");
    }

    [Fact]
    public void Oversized_report_drops_the_option_lists_but_keeps_the_values()
    {
        var report = CameraReport.FromState(State(optionCount: 3000));

        System.Text.Encoding.UTF8.GetByteCount(report.ToString(Newtonsoft.Json.Formatting.None))
            .Should().BeLessThanOrEqualTo(CameraReport.MaxBytes);
        ((JObject)report["options"]!).Count.Should().Be(0);
        report["values"]!["tv"]!.Value<int>().Should().Be(0x6B);
    }

    [Fact]
    public void Unsupported_camera_report()
    {
        var report = CameraReport.Unsupported("webcam", At);

        report["supported"]!.Value<bool>().Should().BeFalse();
        report["model"]!.ToString().Should().Be("webcam");
        report["at"]!.ToString().Should().Be("2026-11-19T09:00:00Z");
    }

    [Fact]
    public void Values_omit_the_settings_left_unchanged()
        => CameraReport.Values(new CameraExposureValues { Iso = 0x50 }).Properties().Select(p => p.Name)
            .Should().Equal("iso");

    [Fact]
    public void Fingerprint_ignores_the_reading_time()
    {
        var first = CameraReport.FromState(State());
        var later = CameraReport.FromState(State());
        later["at"] = "2026-11-19T11:00:00Z";

        CameraReport.Fingerprint(later).Should().Be(CameraReport.Fingerprint(first));
        later["mode"] = "Av";
        CameraReport.Fingerprint(later).Should().NotBe(CameraReport.Fingerprint(first));
    }

    // ── RPC kiosk_ack_camera_request et kiosk_get_camera_request ─────────────

    [Fact]
    public void Ack_body_uses_the_rpc_argument_names_and_keeps_requested_at_as_is()
    {
        var json = SupabaseRpcBodies.BuildCameraAckBody("MACHINE-1", "s3cret",
            "2026-11-19T10:00:00.123456+00:00", "applied", new CameraExposureValues { Tv = 0x6B, Iso = 0x50 }, null);
        var body = JObject.Parse(json);

        body.Properties().Select(p => p.Name).Should().BeEquivalentTo(
            "p_machine_id", "p_secret", "p_requested_at", "p_status", "p_values", "p_error");
        json.Should().Contain("\"p_requested_at\":\"2026-11-19T10:00:00.123456+00:00\"");
        ((JObject)body["p_values"]!).Properties().Select(p => p.Name).Should().BeEquivalentTo("tv", "iso");
        body["p_error"]!.Type.Should().Be(JTokenType.Null);
    }

    [Fact]
    public void Refused_ack_sends_no_values_and_a_shortened_reason()
    {
        var body = JObject.Parse(SupabaseRpcBodies.BuildCameraAckBody("MACHINE-1", "s3cret", "t", "refused", null,
            new string('x', 800)));

        body["p_values"]!.Type.Should().Be(JTokenType.Null);
        body["p_error"]!.ToString().Should().HaveLength(500);
    }

    [Theory]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("""{"values":{"tv":107}}""")]
    [InlineData("""{"values":{"tv":107},"requested_at":"  "}""")]
    public void No_request_without_an_object_and_its_date(string body)
        => SupabaseRpcResponses.ParseCameraRequestResponse(body).Should().BeNull();

    [Fact]
    public void Request_reads_integer_codes_and_ignores_the_others()
    {
        var request = SupabaseRpcResponses.ParseCameraRequestResponse(
            """{"values":{"tv":107,"av":"48","iso":80.5,"wb":99999999999,"kelvin":5200},"requested_at":"2026-11-19T10:00:00.123456+00:00"}""");

        request.Should().NotBeNull();
        request!.RequestedAt.Should().Be("2026-11-19T10:00:00.123456+00:00");
        request.Values.Should().Be(new CameraExposureValues { Tv = 107, Kelvin = 5200 });
    }

    [Fact]
    public void Request_without_values_changes_nothing()
        => SupabaseRpcResponses.ParseCameraRequestResponse("""{"requested_at":"2026-11-19T10:00:00Z"}""")!
            .Values.Should().Be(new CameraExposureValues());
}
