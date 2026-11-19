using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// Séances GIF (LAB-237) : enregistrement de l'animation, validation du questionnaire, ordre de la file
/// d'envoi (photos d'abord), séance refusée, verrou par séance.
/// </summary>
public sealed class SessionServiceAnimationTests : IDisposable
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private const string EventName = "Mariage";

    private readonly TestDb _db = new();
    private readonly TempDir _dir = new();
    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly SessionPathService _paths;

    public SessionServiceAnimationTests()
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dir.Path;
        _paths = new SessionPathService(settings);
    }

    public void Dispose()
    {
        _db.Dispose();
        _dir.Dispose();
    }

    private SessionService NewService() => new(_db.NewContext(), _supabase.Object, _log.Object, _paths);

    private string NewFile(string relative)
    {
        var path = _dir.File(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, [0xFF, 0xD8, 0xFF, 0xD9]);
        return path;
    }

    private AnimationClip NewClip(Guid sessionId)
        => new(NewFile($"animations/{sessionId}/clip.mp4"), NewFile($"animations/{sessionId}/poster.jpg"), 6000, 720, 1080);

    private async Task<Guid> RecordAsync(DateTime takenAt, bool gif)
    {
        var sessionId = Guid.NewGuid();
        var composite = NewFile($"composites/{sessionId}.jpg");
        return await NewService().RecordSessionAsync(sessionId, EventId, takenAt, composite, composite,
            animation: gif ? NewClip(sessionId) : null);
    }

    [Fact]
    public async Task A_gif_session_keeps_its_clip_poster_duration_and_size()
    {
        var id = await RecordAsync(DateTime.UtcNow, gif: true);

        using var ctx = _db.NewContext();
        var session = await ctx.Sessions.SingleAsync(TestContext.Current.CancellationToken);
        session.Id.Should().Be(id);
        session.MediaType.Should().Be(SessionMediaType.Gif);
        session.VideoPath.Should().Be(_dir.File($"animations/{id}/clip.mp4"));
        session.PosterPath.Should().Be(_dir.File($"animations/{id}/poster.jpg"));
        (session.DurationMs, session.Width, session.Height).Should().Be((6000, 720, 1080));
    }

    [Fact]
    public async Task A_photo_session_has_no_animation()
    {
        await RecordAsync(DateTime.UtcNow, gif: false);

        using var ctx = _db.NewContext();
        var session = await ctx.Sessions.SingleAsync(TestContext.Current.CancellationToken);
        session.MediaType.Should().Be(SessionMediaType.Photo);
        session.VideoPath.Should().BeNull();
        session.PosterPath.Should().BeNull();
        session.DurationMs.Should().BeNull();
        session.Width.Should().BeNull();
    }

    [Fact]
    public async Task Validating_the_questionnaire_moves_the_animation_with_the_session()
    {
        var sessionId = Guid.NewGuid();
        _paths.EnsurePendingDirectoriesExist(sessionId);
        var photo = Path.Combine(_paths.GetPendingOriginalsDirectory(sessionId), "IMG_0001.jpg");
        var composite = Path.Combine(_paths.GetPendingCompositesDirectory(sessionId), "composite_1.jpg");
        var animationDir = SessionAnimation.DirectoryFor(_paths.GetPendingCompositesDirectory(sessionId), sessionId);
        Directory.CreateDirectory(animationDir);
        var clip = new AnimationClip(Path.Combine(animationDir, "clip.mp4"), Path.Combine(animationDir, "poster.jpg"), 4000, 720, 1080);
        foreach (var file in new[] { photo, composite, clip.VideoPath, clip.PosterPath })
            File.WriteAllBytes(file, [0xFF, 0xD8, 0xFF, 0xD9]);

        var displayed = await NewService().CommitPendingSessionAsync(sessionId, EventId, EventName, DateTime.UtcNow,
            photo, composite, animation: clip);

        var eventDir = _paths.GetEventDirectory(EventName, EventId);
        var finalDir = Path.Combine(eventDir, SessionAnimation.DirectoryName, sessionId.ToString("D"));
        using var ctx = _db.NewContext();
        var session = await ctx.Sessions.SingleAsync(TestContext.Current.CancellationToken);
        session.MediaType.Should().Be(SessionMediaType.Gif);
        session.VideoPath.Should().Be(Path.Combine(finalDir, "clip.mp4"));
        session.PosterPath.Should().Be(Path.Combine(finalDir, "poster.jpg"));
        File.Exists(session.VideoPath).Should().BeTrue();
        File.Exists(session.PosterPath).Should().BeTrue();
        SessionAnimation.FindForComposite(displayed)!.VideoPath.Should().Be(session.VideoPath, "la galerie la retrouve");
    }

    [Fact]
    public async Task Photos_are_sent_before_animations_each_oldest_first()
    {
        var start = new DateTime(2026, 11, 19, 20, 0, 0, DateTimeKind.Utc);
        var gif1   = await RecordAsync(start, gif: true);
        var photo1 = await RecordAsync(start.AddMinutes(1), gif: false);
        var gif2   = await RecordAsync(start.AddMinutes(2), gif: true);
        var photo2 = await RecordAsync(start.AddMinutes(3), gif: false);

        using var ctx = _db.NewContext();
        (await SessionService.LoadPendingIdsAsync(ctx)).Should().Equal(photo1, photo2, gif1, gif2);
    }

    [Fact]
    public async Task A_rejected_session_leaves_the_queue()
    {
        var rejected = await RecordAsync(DateTime.UtcNow, gif: true);
        var kept = await RecordAsync(DateTime.UtcNow, gif: false);
        using (var ctx = _db.NewContext())
            await ctx.Sessions.Where(s => s.Id == rejected)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.UploadRejected, true), TestContext.Current.CancellationToken);

        using (var ctx = _db.NewContext())
            (await SessionService.LoadPendingIdsAsync(ctx)).Should().Equal(kept);
    }

    [Fact]
    public async Task A_gif_session_sends_its_animation_and_a_photo_session_its_montage()
    {
        var gif = await RecordAsync(DateTime.UtcNow, gif: true);
        var photo = await RecordAsync(DateTime.UtcNow, gif: false);
        _supabase.Setup(s => s.UploadAnimationAsync(gif, EventId, It.IsAny<AnimationClip>(), It.IsAny<DateTime>()))
                 .ReturnsAsync(("https://cdn.example/clip.mp4", Guid.NewGuid()));
        _supabase.Setup(s => s.UploadPhotoAsync(photo, EventId, It.IsAny<string>(), It.IsAny<DateTime>()))
                 .ReturnsAsync(("https://cdn.example/photo.jpg", Guid.NewGuid()));

        (await NewService().UploadPendingSessionsAsync()).Should().Be(2);

        _supabase.Verify(s => s.UploadAnimationAsync(gif, EventId,
            It.Is<AnimationClip>(c => c.VideoPath.EndsWith("clip.mp4") && c.PosterPath.EndsWith("poster.jpg")
                                      && c.DurationMs == 6000 && c.Width == 720 && c.Height == 1080),
            It.IsAny<DateTime>()), Times.Once);
        _supabase.Verify(s => s.UploadPhotoAsync(gif, It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<DateTime>()), Times.Never);
        _supabase.Verify(s => s.UploadAnimationAsync(photo, It.IsAny<Guid>(), It.IsAny<AnimationClip>(), It.IsAny<DateTime>()), Times.Never);
    }

    [Fact]
    public async Task A_gif_session_without_its_poster_sends_the_montage()
    {
        var gif = await RecordAsync(DateTime.UtcNow, gif: true);
        File.Delete(_dir.File($"animations/{gif}/poster.jpg"));
        _supabase.Setup(s => s.UploadPhotoAsync(gif, EventId, It.IsAny<string>(), It.IsAny<DateTime>()))
                 .ReturnsAsync(("https://cdn.example/photo.jpg", Guid.NewGuid()));

        (await NewService().UploadPendingSessionsAsync()).Should().Be(1);

        _supabase.Verify(s => s.UploadAnimationAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<AnimationClip>(), It.IsAny<DateTime>()), Times.Never);
    }

    [Fact]
    public async Task A_slow_clip_upload_does_not_hold_the_next_guest_but_holds_its_own_session()
    {
        var ct = TestContext.Current.CancellationToken;
        var gif = await RecordAsync(DateTime.UtcNow, gif: true);
        var photo = await RecordAsync(DateTime.UtcNow, gif: false);
        var slowClip = new TaskCompletionSource<(string, Guid)>(TaskCreationOptions.RunContinuationsAsynchronously);
        _supabase.Setup(s => s.UploadAnimationAsync(gif, EventId, It.IsAny<AnimationClip>(), It.IsAny<DateTime>()))
                 .Returns(slowClip.Task);
        _supabase.Setup(s => s.UploadPhotoAsync(photo, EventId, It.IsAny<string>(), It.IsAny<DateTime>()))
                 .ReturnsAsync(("https://cdn.example/photo.jpg", Guid.NewGuid()));

        // Clip en cours d'envoi en fond (4G faible).
        var background = NewService().UploadSessionAsync(gif);
        // QR de l'invité suivant : pas d'attente.
        var next = NewService().UploadSessionAsync(photo);
        (await Task.WhenAny(next, Task.Delay(TimeSpan.FromSeconds(5), ct))).Should().BeSameAs(next);
        (await next).PublicUrl.Should().Be("https://cdn.example/photo.jpg");

        // Même séance rouverte pendant l'envoi : elle attend puis reprend le lien, sans second envoi.
        var reopened = NewService().UploadSessionAsync(gif);
        await Task.Delay(100, ct);
        reopened.IsCompleted.Should().BeFalse();
        var photoId = Guid.NewGuid();
        slowClip.SetResult(("https://cdn.example/clip.mp4", photoId));

        (await background).Should().Be(("https://cdn.example/clip.mp4", photoId));
        (await reopened).Should().Be(("https://cdn.example/clip.mp4", photoId));
        _supabase.Verify(s => s.UploadAnimationAsync(gif, It.IsAny<Guid>(), It.IsAny<AnimationClip>(), It.IsAny<DateTime>()), Times.Once);
    }
}
