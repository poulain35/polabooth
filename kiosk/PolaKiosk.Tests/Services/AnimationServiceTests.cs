using System.ComponentModel;
using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using SkiaSharp;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// AnimationService (LAB-234) avec un faux ffmpeg : contrôle des encodeurs, choix h264_mf puis
/// libopenh264, encodage, échecs propres (jamais d'exception), délai maximal, annulation, journal.
/// </summary>
public sealed class AnimationServiceTests : IDisposable
{
    private readonly TempDir _dir = new();
    private readonly FakeFfmpegRunner _ffmpeg = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly List<SKBitmap> _frames = [];

    public void Dispose()
    {
        foreach (var f in _frames) f.Dispose();
        _dir.Dispose();
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private AnimationService NewService() => new(_ffmpeg, _log.Object, TimeSpan.FromSeconds(5));

    private AnimationRequest Request(int count = 4, int width = 1200, int height = 1800)
    {
        for (var i = 0; i < count; i++)
        {
            var bmp = new SKBitmap(width, height);
            bmp.Erase(new SKColor((byte)(40 * i), 120, 200));
            _frames.Add(bmp);
        }
        return new AnimationRequest(_frames, _dir.File("session"));
    }

    private string Video => Path.Combine(_dir.File("session"), AnimationService.VideoFileName);
    private string Poster => Path.Combine(_dir.File("session"), AnimationService.PosterFileName);

    private void ExpectNoFiles()
    {
        File.Exists(Video).Should().BeFalse();
        File.Exists(Video + ".part").Should().BeFalse();
        File.Exists(Poster).Should().BeFalse();
    }

    // ── Contrôle des encodeurs ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Status_prefers_h264_mf_when_both_encoders_work()
    {
        var status = await NewService().GetEncoderStatusAsync(ct: Ct);

        status.State.Should().Be(AnimationEncoderState.Ready);
        status.Encoders.Should().Equal("h264_mf", "libopenh264");
        status.FfmpegVersion.Should().Be("n9.0.2-test");
        status.Label.Should().Be("Animations : prêtes (h264_mf)");
        _log.Verify(l => l.LogInfoAsync(AnimationService.LogContext, It.Is<string>(m => m.Contains("prêtes (h264_mf)"))), Times.Once);
    }

    [Fact]
    public async Task Status_falls_back_to_libopenh264_when_h264_mf_fails_its_trial()
    {
        _ffmpeg.BrokenProbes.Add("h264_mf");

        var status = await NewService().GetEncoderStatusAsync(ct: Ct);

        status.IsReady.Should().BeTrue();
        status.Encoders.Should().Equal("libopenh264");
        status.Label.Should().Be("Animations : prêtes (libopenh264)");
        status.Detail.Should().Contain("h264_mf");
    }

    [Fact]
    public async Task Status_says_ffmpeg_is_missing_without_starting_anything()
    {
        _ffmpeg.IsAvailable = false;

        var status = await NewService().GetEncoderStatusAsync(ct: Ct);

        status.State.Should().Be(AnimationEncoderState.FfmpegMissing);
        status.Label.Should().Be("Animations : ffmpeg absent");
        _ffmpeg.Calls.Should().BeEmpty();
        _log.Verify(l => l.LogWarningOncePerDayAsync(AnimationService.LogContext, It.Is<string>(m => m.Contains("ffmpeg absent"))), Times.Once);
    }

    [Fact]
    public async Task Status_says_the_encoder_is_missing_when_ffmpeg_has_no_lgpl_h264_encoder()
    {
        _ffmpeg.ListOutput = FakeFfmpegRunner.EncoderList("h264_nvenc", "mpeg4");

        var status = await NewService().GetEncoderStatusAsync(ct: Ct);

        status.State.Should().Be(AnimationEncoderState.NoEncoder);
        status.Label.Should().Be("Animations : encodeur H.264 absent");
        _ffmpeg.Calls.Should().HaveCount(1, "aucun essai d'encodeur sans encodeur listé");
    }

    [Fact]
    public async Task Status_says_the_encoder_is_missing_when_every_trial_fails()
    {
        _ffmpeg.BrokenProbes.UnionWith(["h264_mf", "libopenh264"]);

        var status = await NewService().GetEncoderStatusAsync(ct: Ct);

        status.State.Should().Be(AnimationEncoderState.NoEncoder);
        status.Detail.Should().Contain("Error while opening encoder h264_mf");
    }

    [Theory]
    [InlineData("--enable-gpl")]
    [InlineData("--enable-nonfree")]
    public async Task Status_refuses_a_gpl_or_nonfree_build(string flag)
    {
        _ffmpeg.ListBanner = FakeFfmpegRunner.Banner.Replace("--enable-version3", $"--enable-version3 {flag}");

        var status = await NewService().GetEncoderStatusAsync(ct: Ct);

        status.State.Should().Be(AnimationEncoderState.LicenseRefused);
        status.IsReady.Should().BeFalse();
    }

    [Fact]
    public async Task Status_is_checked_once_then_again_on_request()
    {
        var service = NewService();

        await service.GetEncoderStatusAsync(ct: Ct);
        await service.GetEncoderStatusAsync(ct: Ct);
        _ffmpeg.ListCalls.Should().Be(1);

        await service.GetEncoderStatusAsync(refresh: true, Ct);
        _ffmpeg.ListCalls.Should().Be(2);
    }

    [Fact]
    public async Task Status_reports_a_probe_failure_instead_of_throwing()
    {
        _ffmpeg.StartError = new Win32Exception("Accès refusé.");

        var status = await NewService().GetEncoderStatusAsync(ct: Ct);

        status.State.Should().Be(AnimationEncoderState.ProbeFailed);
        status.Detail.Should().Be("Accès refusé.");
    }

    // ── Encodage ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Encode_writes_a_loopable_mp4_and_a_poster_with_h264_mf()
    {
        var result = await NewService().EncodeAsync(Request(), Ct);

        result.Success.Should().BeTrue(result.Error);
        result.Encoder.Should().Be("h264_mf");
        (result.Width, result.Height).Should().Be((720, 1080));
        result.DurationMs.Should().Be(6000, "4 images × 0,5 s, répétées 3 fois");
        result.VideoPath.Should().Be(Video);
        result.PosterPath.Should().Be(Poster);
        File.Exists(Video).Should().BeTrue();
        File.Exists(Video + ".part").Should().BeFalse();
        using (var poster = SKBitmap.Decode(Poster))
            (poster.Width, poster.Height).Should().Be((720, 1080));

        var args = _ffmpeg.EncodeCalls.Single();
        string After(string flag) => args[args.ToList().IndexOf(flag) + 1];
        After("-f").Should().Be("rawvideo");
        After("-video_size").Should().Be("720x1080");
        After("-framerate").Should().Be("1000/500");
        After("-i").Should().Be("pipe:0");
        After("-c:v").Should().Be("h264_mf");
        args.Should().ContainInOrder("-c:v", "h264_mf", "-b:v", "4M", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4");
        args[^1].Should().Be(Video + ".part");
        _ffmpeg.Processes.Last().BytesWritten.Should().Be(4L * 3 * 720 * 1080 * 4);
        _log.Verify(l => l.LogInfoAsync(AnimationService.LogContext, It.Is<string>(m => m.StartsWith("Animation encodée"))), Times.Once);
    }

    [Theory]
    [InlineData(2, 2)]   // image du milieu (LAB-237)
    [InlineData(0, 0)]
    [InlineData(9, 0)]   // hors bornes : la première
    [InlineData(-1, 0)]
    public async Task The_poster_is_the_requested_frame(int index, int expectedFrame)
    {
        var request = Request() with { PosterFrameIndex = index };

        var result = await NewService().EncodeAsync(request, Ct);

        result.Success.Should().BeTrue(result.Error);
        using var poster = SKBitmap.Decode(Poster);
        var pixel = poster.GetPixel(poster.Width / 2, poster.Height / 2);
        ((int)pixel.Red).Should().BeCloseTo(40 * expectedFrame, 6);
    }

    [Fact]
    public async Task Encode_uses_libopenh264_when_h264_mf_is_unusable()
    {
        _ffmpeg.BrokenProbes.Add("h264_mf");

        var result = await NewService().EncodeAsync(Request(), Ct);

        result.Success.Should().BeTrue();
        result.Encoder.Should().Be("libopenh264");
        _ffmpeg.EncodeCalls.Should().ContainSingle();
    }

    [Fact]
    public async Task Encode_retries_with_the_next_encoder_after_a_failure()
    {
        _ffmpeg.Encodes["h264_mf"] = () => new FakeFfmpegProcess { ExitCode = 1, Error = "[h264_mf] MFT failed\n" };

        var result = await NewService().EncodeAsync(Request(), Ct);

        result.Success.Should().BeTrue();
        result.Encoder.Should().Be("libopenh264");
        _log.Verify(l => l.LogWarningAsync(AnimationService.LogContext, It.Is<string>(m => m.Contains("MFT failed"))), Times.Once);
    }

    [Fact]
    public async Task Encode_failure_returns_a_clean_result_logs_the_error_and_leaves_no_file()
    {
        _ffmpeg.BrokenProbes.Add("libopenh264");
        _ffmpeg.Encodes["h264_mf"] = () => new FakeFfmpegProcess { ExitCode = 1, Error = "line 1\n[h264_mf] Error encoding frame\n" };

        var result = await NewService().EncodeAsync(Request(), Ct);

        result.Success.Should().BeFalse();
        result.Failure.Should().Be(AnimationFailure.Failed);
        result.Error.Should().Contain("Error encoding frame");
        ExpectNoFiles();
        _log.Verify(l => l.LogErrorAsync(AnimationService.LogContext, It.Is<string>(m => m.Contains("Error encoding frame")), null), Times.Once);
    }

    [Fact]
    public async Task Encode_handles_ffmpeg_closing_its_input()
    {
        _ffmpeg.BrokenProbes.Add("libopenh264");
        _ffmpeg.Encodes["h264_mf"] = () => new FakeFfmpegProcess { ExitCode = 1, BrokenInput = true, Error = "Invalid argument\n" };

        var result = await NewService().EncodeAsync(Request(), Ct);

        result.Failure.Should().Be(AnimationFailure.Failed);
        result.Error.Should().Contain("Invalid argument");
    }

    [Fact]
    public async Task Encode_without_any_video_file_is_a_failure()
    {
        _ffmpeg.BrokenProbes.Add("libopenh264");
        _ffmpeg.Encodes["h264_mf"] = () => new FakeFfmpegProcess { WritesOutput = false };

        var result = await NewService().EncodeAsync(Request(), Ct);

        result.Failure.Should().Be(AnimationFailure.Failed);
        result.Error.Should().Contain("aucune vidéo produite");
        ExpectNoFiles();
    }

    [Fact]
    public async Task Encode_stops_ffmpeg_after_the_maximum_time()
    {
        _ffmpeg.Encodes["h264_mf"] = () => new FakeFfmpegProcess { Hang = true };

        var result = await NewService().EncodeAsync(Request() with { Timeout = TimeSpan.FromMilliseconds(200) }, Ct);

        result.Failure.Should().Be(AnimationFailure.Timeout);
        _ffmpeg.Processes.Last().Killed.Should().BeTrue();
        _ffmpeg.EncodeCalls.Should().ContainSingle("pas de nouvel essai après un délai dépassé");
        ExpectNoFiles();
        _log.Verify(l => l.LogErrorAsync(AnimationService.LogContext, It.Is<string>(m => m.Contains("Timeout")), null), Times.Once);
    }

    [Fact]
    public async Task Encode_can_be_canceled()
    {
        _ffmpeg.Encodes["h264_mf"] = () => new FakeFfmpegProcess { Hang = true };
        var service = NewService();
        await service.GetEncoderStatusAsync(ct: Ct);
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));

        var result = await service.EncodeAsync(Request(), cts.Token);

        result.Failure.Should().Be(AnimationFailure.Canceled);
        _ffmpeg.Processes.Last().Killed.Should().BeTrue();
        ExpectNoFiles();
    }

    [Fact]
    public async Task Encode_reports_a_missing_encoder_so_the_caller_keeps_the_photo()
    {
        _ffmpeg.IsAvailable = false;

        var result = await NewService().EncodeAsync(Request(), Ct);

        result.Failure.Should().Be(AnimationFailure.EncoderMissing);
        result.Error.Should().Contain("ffmpeg absent");
        _ffmpeg.Calls.Should().BeEmpty();
        ExpectNoFiles();
    }

    [Fact]
    public async Task Encode_never_throws_when_ffmpeg_cannot_start()
    {
        var service = NewService();
        await service.GetEncoderStatusAsync(ct: Ct);
        _ffmpeg.StartError = new Win32Exception("Le fichier est introuvable.");

        var result = await service.EncodeAsync(Request(), Ct);

        result.Failure.Should().Be(AnimationFailure.Failed);
        result.Error.Should().Contain("introuvable");
        ExpectNoFiles();
    }

    [Fact]
    public async Task Encode_without_frames_is_a_failure()
    {
        var result = await NewService().EncodeAsync(new AnimationRequest([], _dir.File("session")), Ct);

        result.Failure.Should().Be(AnimationFailure.Failed);
        _ffmpeg.Calls.Should().BeEmpty();
    }

    [Fact]
    public async Task Encode_fits_frames_of_another_size_into_the_clip()
    {
        var request = Request(count: 2);
        using var other = new SKBitmap(1800, 1200);
        var frames = request.Frames.Append(other).ToList();

        var result = await NewService().EncodeAsync(request with { Frames = frames }, Ct);

        result.Success.Should().BeTrue();
        result.DurationMs.Should().Be(6000);
        _ffmpeg.Processes.Last().BytesWritten.Should().Be(3L * 4 * 720 * 1080 * 4, "3 images × 4 passages à 720×1080");
    }

    // ── Calculs ───────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(1200, 1800, 720, 1080)]   // portrait
    [InlineData(1800, 1200, 1080, 720)]   // paysage
    [InlineData(600, 1800, 360, 1080)]    // bandelette verticale
    [InlineData(1800, 600, 1080, 360)]    // bandelette horizontale
    [InlineData(500, 700, 500, 700)]      // jamais agrandi
    [InlineData(1001, 1501, 720, 1080)]   // côtés pairs
    [InlineData(333, 3, 332, 2)]
    public void Clip_size_keeps_the_long_side_under_the_limit_with_even_sides(int w, int h, int ew, int eh)
    {
        var (cw, ch) = AnimationService.ClipSize(w, h, 1080);

        (cw, ch).Should().Be((ew, eh));
        (cw % 2, ch % 2).Should().Be((0, 0));
    }

    [Theory]
    [InlineData(4, 500, 6000, 3)]
    [InlineData(10, 500, 6000, 1)]
    [InlineData(60, 100, 6000, 1)]
    [InlineData(1, 500, 6000, 12)]
    public void Repeats_approach_the_target_duration(int frames, int frameMs, int targetMs, int expected)
        => AnimationService.Repeats(frames, TimeSpan.FromMilliseconds(frameMs), TimeSpan.FromMilliseconds(targetMs))
            .Should().Be(expected);

    [Fact]
    public void Encoder_list_parsing_ignores_the_legend()
    {
        var names = AnimationService.ParseEncoders(FakeFfmpegRunner.EncoderList("h264_mf"));

        names.Should().BeEquivalentTo(["h264_mf"], "seules les lignes vidéo après « ------ » comptent");
    }
}
