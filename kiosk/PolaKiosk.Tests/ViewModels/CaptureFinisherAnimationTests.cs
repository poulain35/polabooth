using FluentAssertions;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;
using SkiaSharp;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Fin de la prise de vue d'un GIF (LAB-237) : montage imprimé, animation, repli en photo.</summary>
public sealed class CaptureFinisherAnimationTests : IDisposable
{
    private static readonly Guid EventId = Guid.NewGuid();
    private readonly Guid _sessionId = Guid.NewGuid();
    private readonly TempDir _dir = new();
    private readonly Mock<ISyncService> _sync = new();
    private readonly Mock<ICompositeService> _composite = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly Mock<ISessionService> _sessions = new();
    private readonly Mock<INetworkMonitorService> _network = new();
    private readonly Mock<IAnimationService> _animation = new();
    private readonly List<SKBitmap> _frames = [];
    private readonly TemplateEntity _template;
    private readonly string _compositesDir;
    private readonly string _compositePath;
    private AnimationRequest? _request;

    public CaptureFinisherAnimationTests()
    {
        _compositesDir = Path.Combine(_dir.Path, "event", "composites");
        Directory.CreateDirectory(_compositesDir);
        _compositePath = Path.Combine(_compositesDir, "composite.jpg");
        var png = _dir.File("cadre.png");
        File.WriteAllText(png, "png");
        _template = new TemplateEntity { Id = Guid.NewGuid(), EventId = EventId, Format = "portrait", ThumbnailPath = png };

        _composite.Setup(c => c.GetPhotoZonesAsync(_template.Id, It.IsAny<string>()))
                  .ReturnsAsync([new PhotoZone(0, 0, 400, 600)]);
        _composite.Setup(c => c.CreateCompositeAsync(It.IsAny<IReadOnlyList<string>>(), png, It.IsAny<IReadOnlyList<PhotoZone>>(),
                      "portrait", _compositesDir, It.IsAny<int?>()))
                  .ReturnsAsync(_compositePath);
        _composite.Setup(c => c.CreateAnimationFramesAsync(It.IsAny<IReadOnlyList<string>>(), png,
                      It.IsAny<IReadOnlyList<PhotoZone>>(), "portrait", CaptureFinisher.AnimationLongSide))
                  .ReturnsAsync((IReadOnlyList<string> photos, string? _, IReadOnlyList<PhotoZone> _, string _, int _) =>
                  {
                      foreach (var _ in photos) _frames.Add(new SKBitmap(4, 6));
                      return _frames.ToList();
                  });
        _animation.Setup(a => a.EncodeAsync(It.IsAny<AnimationRequest>(), It.IsAny<CancellationToken>()))
                  .ReturnsAsync((AnimationRequest r, CancellationToken _) =>
                  {
                      _request = r;
                      Directory.CreateDirectory(r.OutputDirectory);
                      var video  = Path.Combine(r.OutputDirectory, AnimationService.VideoFileName);
                      var poster = Path.Combine(r.OutputDirectory, AnimationService.PosterFileName);
                      File.WriteAllText(video, "mp4");
                      File.WriteAllText(poster, "jpg");
                      return new AnimationResult(AnimationFailure.None, video, poster, 6000, 720, 1080, "h264_mf");
                  });
    }

    public void Dispose()
    {
        foreach (var f in _frames) f.Dispose();
        _dir.Dispose();
    }

    private CaptureFinisher Finisher(IAnimationService? animation)
        => new(_sync.Object, _composite.Object, _log.Object, _sessions.Object, _network.Object, null, animation);

    private CaptureContext Context(CaptureFormat format, int photos = 4, KioskConfig? config = null) => new(
        SessionId:           _sessionId,
        CapturedAtUtc:       DateTime.UtcNow,
        EventId:             EventId,
        EventName:           "Mariage",
        Config:              config,
        Template:            _template,
        TemplateFormat:      "portrait",
        PhotoPaths:          Enumerable.Range(1, photos).Select(i => _dir.File($"p{i}.jpg")).ToList(),
        CompositesDirectory: _compositesDir,
        IsPending:           false,
        EarlyUpload:         false,
        AccessCode:          "ABC123",
        PrinterName:         "DNP",
        Format:              format);

    [Fact]
    public async Task A_gif_gives_the_printed_montage_and_a_looping_clip_with_the_middle_poster()
    {
        var result = await Finisher(_animation.Object).FinishCaptureAsync(Context(CaptureFormat.Gif, photos: 4), TestContext.Current.CancellationToken);

        result.CompositePath.Should().Be(_compositePath, "l'impression reste le montage des photos");
        result.Animation.Should().NotBeNull();
        result.AnimationUnavailable.Should().BeFalse();
        _request!.Frames.Should().HaveCount(4);
        _request.PosterFrameIndex.Should().Be(2, "affiche = image du milieu");
        _request.MaxLongSide.Should().Be(1080);
        _request.OutputDirectory.Should().Be(SessionAnimation.DirectoryFor(_compositesDir, _sessionId));
        var next = result.NextParameters.Should().BeOfType<ResultParameters>().Subject;
        next.VideoPath.Should().Be(result.Animation!.VideoPath);
        next.CompositePath.Should().Be(_compositePath);
        next.AnimationUnavailable.Should().BeFalse();
        _frames.Should().OnlyContain(f => f.Handle == IntPtr.Zero, "les images sont libérées après l'encodage");
        _sessions.Verify(s => s.RecordSessionAsync(_sessionId, EventId, It.IsAny<DateTime>(), It.IsAny<string>(), _compositePath,
            It.IsAny<Action<AppDbContext>?>(), _template.Id, result.Animation), Times.Once);
        _log.Verify(l => l.LogInfoAsync(AnimationService.LogContext, It.Is<string>(m => m.StartsWith("Animation prête"))), Times.Once);
    }

    [Fact]
    public async Task A_failed_encoding_keeps_the_session_as_a_photo()
    {
        _animation.Setup(a => a.EncodeAsync(It.IsAny<AnimationRequest>(), It.IsAny<CancellationToken>()))
                  .ReturnsAsync(AnimationResult_Failed());

        var result = await Finisher(_animation.Object).FinishCaptureAsync(Context(CaptureFormat.Gif), TestContext.Current.CancellationToken);

        result.Animation.Should().BeNull();
        result.AnimationUnavailable.Should().BeTrue();
        result.CompositePath.Should().Be(_compositePath);
        var next = result.NextParameters.Should().BeOfType<ResultParameters>().Subject;
        next.VideoPath.Should().BeNull();
        next.AnimationUnavailable.Should().BeTrue();
        _sessions.Verify(s => s.RecordSessionAsync(_sessionId, EventId, It.IsAny<DateTime>(), It.IsAny<string>(), _compositePath,
            It.IsAny<Action<AppDbContext>?>(), _template.Id, null), Times.Once);
    }

    private static AnimationResult AnimationResult_Failed() => new(AnimationFailure.Failed, Error: "ffmpeg a échoué");

    [Fact]
    public async Task Frames_that_cannot_be_prepared_are_logged_and_the_session_stays_a_photo()
    {
        _composite.Setup(c => c.CreateAnimationFramesAsync(It.IsAny<IReadOnlyList<string>>(), It.IsAny<string?>(),
                      It.IsAny<IReadOnlyList<PhotoZone>>(), It.IsAny<string>(), It.IsAny<int>()))
                  .ThrowsAsync(new InvalidOperationException("photo illisible"));

        var result = await Finisher(_animation.Object).FinishCaptureAsync(Context(CaptureFormat.Gif), TestContext.Current.CancellationToken);

        result.AnimationUnavailable.Should().BeTrue();
        _animation.Verify(a => a.EncodeAsync(It.IsAny<AnimationRequest>(), It.IsAny<CancellationToken>()), Times.Never);
        _log.Verify(l => l.LogErrorAsync(AnimationService.LogContext, It.Is<string>(m => m.Contains("photo illisible")), It.IsAny<string?>()), Times.Once);
    }

    [Fact]
    public async Task Without_encoder_service_the_gif_is_a_photo()
    {
        var result = await Finisher(null).FinishCaptureAsync(Context(CaptureFormat.Gif), TestContext.Current.CancellationToken);

        result.AnimationUnavailable.Should().BeTrue();
        _log.Verify(l => l.LogWarningAsync(AnimationService.LogContext, It.IsAny<string>()), Times.Once);
    }

    [Fact]
    public async Task A_photo_session_never_builds_an_animation()
    {
        var result = await Finisher(_animation.Object).FinishCaptureAsync(Context(CaptureFormat.Photo, photos: 1), TestContext.Current.CancellationToken);

        result.Animation.Should().BeNull();
        result.AnimationUnavailable.Should().BeFalse();
        _composite.Verify(c => c.CreateAnimationFramesAsync(It.IsAny<IReadOnlyList<string>>(), It.IsAny<string?>(),
            It.IsAny<IReadOnlyList<PhotoZone>>(), It.IsAny<string>(), It.IsAny<int>()), Times.Never);
        ((ResultParameters)result.NextParameters).VideoPath.Should().BeNull();
    }

    [Fact]
    public void A_gif_never_goes_through_the_effect_choice()
    {
        var cfg = new KioskConfig { Effects = new EffectsConfig { EnabledEffects = ["none", "bw"], UserCanChoose = true } };

        CaptureResult.UserChoosesEffect(cfg, CaptureFormat.Photo).Should().BeTrue();
        CaptureResult.UserChoosesEffect(cfg, CaptureFormat.Gif).Should().BeFalse();
    }

    [Fact]
    public async Task A_validated_pending_gif_follows_its_animation_to_the_event_folder()
    {
        var result = await Finisher(_animation.Object).FinishCaptureAsync(Context(CaptureFormat.Gif), TestContext.Current.CancellationToken);
        // Validation du questionnaire : montage et animation déplacés dans un autre dossier d'événement.
        var movedComposites = Path.Combine(_dir.Path, "moved", "composites");
        var movedAnim = SessionAnimation.DirectoryFor(movedComposites, _sessionId);
        Directory.CreateDirectory(movedAnim);
        File.WriteAllText(Path.Combine(movedAnim, AnimationService.VideoFileName), "mp4");
        var movedComposite = Path.Combine(movedComposites, "composite.jpg");

        var moved = result.WithCompositePath(movedComposite);

        moved.Animation!.VideoPath.Should().Be(Path.Combine(movedAnim, AnimationService.VideoFileName));
        moved.Animation.PosterPath.Should().Be(Path.Combine(movedAnim, AnimationService.PosterFileName));
        var next = (ResultParameters)moved.NextParameters;
        next.CompositePath.Should().Be(movedComposite);
        next.VideoPath.Should().Be(moved.Animation.VideoPath);
    }
}
