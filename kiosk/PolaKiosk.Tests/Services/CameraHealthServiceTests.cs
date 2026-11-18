using System.IO;
using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-263 : état partagé de l'appareil photo (accueil, prise de vue, battement de cœur).</summary>
public sealed class CameraHealthServiceTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private readonly Mock<IKioskLogService> _log = new();
    private DateTime _now = new(2026, 11, 12, 20, 0, 0, DateTimeKind.Utc);

    private sealed class FakeCheck : ICameraPresenceCheck
    {
        public Func<CancellationToken, Task<bool>> Answer { get; set; } = _ => Task.FromResult(true);
        public int Calls { get; private set; }

        public Task<bool> IsPresentAsync(CancellationToken cancellationToken)
        {
            Calls++;
            return Answer(cancellationToken);
        }
    }

    private CameraHealthService NewService(FakeCheck check, TimeSpan? timeout = null)
        => new(check, _log.Object, timeout, () => _now);

    private void VerifyAbsentLogs(int times)
        => _log.Verify(l => l.LogErrorAsync("camera", It.IsAny<string>(), It.IsAny<string?>()), Times.Exactly(times));

    [Fact]
    public void State_is_unknown_until_a_check_succeeds()
    {
        var health = NewService(new FakeCheck());

        health.Status.Should().Be(CameraHealth.Unknown);
        health.HeartbeatValue.Should().BeNull();
    }

    [Fact]
    public async Task Check_sets_present_or_absent_and_the_heartbeat_value()
    {
        var check = new FakeCheck();
        var health = NewService(check);

        (await health.CheckNowAsync(Ct)).Should().Be(CameraHealth.Present);
        health.HeartbeatValue.Should().Be("ok");

        check.Answer = _ => Task.FromResult(false);
        (await health.CheckNowAsync(Ct)).Should().Be(CameraHealth.Absent);
        health.HeartbeatValue.Should().Be("disconnected");
    }

    [Fact]
    public async Task One_error_log_per_transition_to_absent_not_per_check()
    {
        var check = new FakeCheck { Answer = _ => Task.FromResult(false) };
        var health = NewService(check);

        await health.CheckNowAsync(Ct);
        await health.CheckNowAsync(Ct);
        await health.CheckNowAsync(Ct);
        VerifyAbsentLogs(1);

        check.Answer = _ => Task.FromResult(true);
        await health.CheckNowAsync(Ct);
        _log.Verify(l => l.LogInfoAsync("camera", It.IsAny<string>()), Times.Once);

        check.Answer = _ => Task.FromResult(false);
        await health.CheckNowAsync(Ct);
        VerifyAbsentLogs(2);
    }

    [Fact]
    public async Task A_check_that_times_out_or_fails_keeps_the_previous_state()
    {
        var check = new FakeCheck();
        var health = NewService(check, timeout: TimeSpan.FromMilliseconds(50));
        await health.CheckNowAsync(Ct);

        check.Answer = ct => Task.Delay(Timeout.Infinite, ct).ContinueWith(_ => false);
        (await health.CheckNowAsync(Ct)).Should().Be(CameraHealth.Present);

        check.Answer = _ => throw new DllNotFoundException("EDSDK.dll");
        (await health.CheckNowAsync(Ct)).Should().Be(CameraHealth.Present);
        VerifyAbsentLogs(0);
    }

    [Fact]
    public async Task Caller_cancellation_is_not_swallowed()
    {
        var health = NewService(new FakeCheck { Answer = ct => Task.Delay(Timeout.Infinite, ct).ContinueWith(_ => true, ct) });
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(20));

        var act = () => health.CheckNowAsync(cts.Token);

        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task Reported_absence_wins_over_the_camera_list_for_30_seconds()
    {
        var check = new FakeCheck(); // l'appareil est encore listé…
        var health = NewService(check);
        await health.CheckNowAsync(Ct);

        health.ReportAbsent(); // … mais la prise de vue n'a pas pu l'ouvrir
        health.Status.Should().Be(CameraHealth.Absent);
        VerifyAbsentLogs(1);

        _now += TimeSpan.FromSeconds(29);
        (await health.CheckNowAsync(Ct)).Should().Be(CameraHealth.Absent);

        _now += TimeSpan.FromSeconds(2);
        (await health.CheckNowAsync(Ct)).Should().Be(CameraHealth.Present);
    }

    [Fact]
    public void Heartbeat_values_match_the_sql_check()
    {
        CameraHealthService.ToHeartbeatValue(CameraHealth.Present).Should().Be("ok");
        CameraHealthService.ToHeartbeatValue(CameraHealth.Absent).Should().Be("disconnected");
        CameraHealthService.ToHeartbeatValue(CameraHealth.Unknown).Should().BeNull();
    }

    // ── Détection Canon (EdsGetCameraList derrière une interface) ──────────────

    [Fact]
    public async Task Canon_without_the_sdk_is_absent_without_any_edsdk_call()
    {
        var list = new Mock<ICanonCameraList>(MockBehavior.Strict);

        (await new CanonPresenceCheck(list.Object, () => false).IsPresentAsync(Ct))
            .Should().BeFalse();
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(2, true)]
    public async Task Canon_is_present_when_edsdk_lists_a_camera(int count, bool expected)
    {
        var list = new Mock<ICanonCameraList>();
        list.Setup(l => l.CountCamerasAsync()).ReturnsAsync(count);

        (await new CanonPresenceCheck(list.Object, () => true).IsPresentAsync(Ct))
            .Should().Be(expected);
    }

    [Fact]
    public void The_check_follows_the_camera_chosen_at_startup()
    {
        CameraPresence.For(new MockCameraService()).Should().BeOfType<AlwaysPresentCheck>();
        var webcam = new WebcamCameraService();
        CameraPresence.For(webcam).Should().BeSameAs(webcam);
    }

    [Fact]
    public async Task The_deferred_check_builds_the_camera_check_only_when_used()
    {
        var built = 0;
        var deferred = new DeferredPresenceCheck(() => { built++; return new AlwaysPresentCheck(); });
        built.Should().Be(0);

        (await deferred.IsPresentAsync(Ct)).Should().BeTrue();
        await deferred.IsPresentAsync(Ct);
        built.Should().Be(1);
    }

    // ── Textes et réglages ──────────────────────────────────────────────────────

    [Fact]
    public void Technical_problem_text_names_the_company_and_its_phone()
    {
        TechnicalProblem.Text("Studio Exemple", "06 12 34 56 78").Should().Be(
            "L'appareil photo n'est pas branché. La borne ne peut pas prendre de photo pour le moment. "
            + "Contactez Studio Exemple au 06 12 34 56 78.");
        TechnicalProblem.Text("Studio Exemple", null).Should().EndWith(" Contactez votre loueur.");
        TechnicalProblem.Text(" ", "") .Should().EndWith(" Contactez votre loueur.");
        TechnicalProblem.Text(null, "06 12 34 56 78").Should().EndWith(" Contactez votre loueur au 06 12 34 56 78.");
    }

    [Theory]
    [InlineData(1920, 1080, true, "")]
    [InlineData(1280, 720, true, "")]
    [InlineData(640, 480, true, "Webcam en basse définition : 640x480")]
    [InlineData(1280, 600, true, "Webcam en basse définition : 1280x600")]
    [InlineData(640, 480, false, "")] // Canon : pas d'avertissement webcam
    public void Low_definition_warning_below_720p_for_webcams(int w, int h, bool isWebcam, string expected)
        => CameraTest.LowDefinitionWarning(w, h, isWebcam).Should().Be(expected);

    [Fact]
    public async Task The_camera_model_is_logged_once_per_launch_then_when_it_comes_back()
    {
        var check = new FakeCheck();
        var model = "Canon EOS R100";
        var health = new CameraHealthService(check, _log.Object, null, () => _now, () => model);

        await health.CheckNowAsync(Ct);
        await health.CheckNowAsync(Ct); // toujours là : rien de plus
        _log.Verify(l => l.LogInfoAsync("camera", "Caméra détectée : Canon EOS R100."), Times.Once);

        check.Answer = _ => Task.FromResult(false);
        await health.CheckNowAsync(Ct);
        check.Answer = _ => Task.FromResult(true);
        model = "Canon EOS R50";
        await health.CheckNowAsync(Ct);
        _log.Verify(l => l.LogInfoAsync("camera", "Appareil photo de nouveau détecté : Canon EOS R50."), Times.Once);
        _log.Verify(l => l.LogInfoAsync("camera", It.IsAny<string>()), Times.Exactly(2));
    }

    [Fact]
    public async Task An_unreadable_model_never_blocks_the_detection()
    {
        var health = new CameraHealthService(new FakeCheck(), _log.Object, null, () => _now,
            () => throw new InvalidOperationException("EDSDK"));

        (await health.CheckNowAsync(Ct)).Should().Be(CameraHealth.Present);
        _log.Verify(l => l.LogInfoAsync("camera", "Caméra détectée : modèle inconnu."), Times.Once);
    }

    [Fact]
    public void Each_camera_source_is_named_in_the_logs()
    {
        CameraPresence.Describe(new MockCameraService()).Should().Be("caméra simulée");
        CameraPresence.Describe(new EdsdkCameraService()).Should().Be("Canon (modèle non lu)");
    }

    [Fact]
    public void Webcam_size_is_read_from_machine_settings_in_camel_case_with_a_1080p_default()
    {
        using var dir = new TempDir();
        new MachineSettingsService(dir.Path).Current.WebcamWidthOrDefault.Should().Be(1920);
        new MachineSettingsService(dir.Path).Current.WebcamHeightOrDefault.Should().Be(1080);

        File.WriteAllText(Path.Combine(dir.Path, "machine-settings.json"),
            """{ "webcamWidth": 1280, "webcamHeight": 720 }""");

        var settings = new MachineSettingsService(dir.Path).Current;
        settings.WebcamWidthOrDefault.Should().Be(1280);
        settings.WebcamHeightOrDefault.Should().Be(720);
    }
}
