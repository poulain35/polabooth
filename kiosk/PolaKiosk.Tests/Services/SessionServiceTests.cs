using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Moq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class SessionServiceTests : IDisposable
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");

    private readonly TestDb _db = new();
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "polakiosk-tests-" + Guid.NewGuid().ToString("N"));
    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly Mock<IKioskLogService> _log = new();

    public SessionServiceTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        _db.Dispose();
        try { Directory.Delete(_dir, recursive: true); } catch { /* nettoyage d'un dossier temporaire */ }
    }

    private SessionService NewService() => new(_db.NewContext(), _supabase.Object, _log.Object, NewPaths());

    private SessionPathService NewPaths()
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = Path.Combine(_dir, "data");
        return new SessionPathService(settings);
    }

    private string NewComposite(string name = "photo.jpg")
    {
        var path = Path.Combine(_dir, name);
        File.WriteAllBytes(path, [0xFF, 0xD8, 0xFF, 0xD9]);
        return path;
    }

    [Fact]
    public async Task RecordSessionAsync_saves_a_pending_session_after_the_montage()
    {
        var composite = NewComposite();

        var id = await NewService().RecordSessionAsync(Guid.NewGuid(), EventId, DateTime.UtcNow, Path.Combine(_dir, "raw.jpg"), composite);

        using var ctx = _db.NewContext();
        var session = await ctx.Sessions.SingleAsync(TestContext.Current.CancellationToken);
        session.Id.Should().Be(id);
        session.EventId.Should().Be(EventId);
        session.CompositePath.Should().Be(composite);
        session.Uploaded.Should().BeFalse();
        ShareInfoFile.Read(composite)!.SessionId.Should().Be(id);
    }

    [Fact]
    public async Task The_frame_of_the_session_is_kept_for_the_gallery()
    {
        var frameId = Guid.NewGuid();
        var withFrame = await NewService().RecordSessionAsync(Guid.NewGuid(), EventId, DateTime.UtcNow,
            NewComposite("a.jpg"), NewComposite("a.jpg"), templateId: frameId);
        var withoutFrame = await NewService().RecordSessionAsync(Guid.NewGuid(), EventId, DateTime.UtcNow,
            NewComposite("b.jpg"), NewComposite("b.jpg"));

        (await NewService().GetSessionTemplateIdAsync(withFrame)).Should().Be(frameId);
        (await NewService().GetSessionTemplateIdAsync(withoutFrame)).Should().BeNull("photo brute ou sans cadre");
        (await NewService().GetSessionTemplateIdAsync(Guid.NewGuid())).Should().BeNull("séance inconnue");
    }

    [Fact]
    public async Task UploadPendingSessionsAsync_sends_pending_session_then_marks_it_uploaded()
    {
        var composite = NewComposite();
        var id = await NewService().RecordSessionAsync(Guid.NewGuid(), EventId, DateTime.UtcNow, composite, composite);
        var photoId = Guid.NewGuid();
        _supabase.Setup(s => s.UploadPhotoAsync(id, EventId, composite, It.IsAny<DateTime>()))
                 .ReturnsAsync(("https://cdn.example/photo.jpg", photoId));

        var sent = await NewService().UploadPendingSessionsAsync();

        sent.Should().Be(1);
        using (var ctx = _db.NewContext())
            (await ctx.Sessions.SingleAsync(TestContext.Current.CancellationToken)).Uploaded.Should().BeTrue();
        ShareInfoFile.Read(composite).Should().Be(new ShareInfo(id, "https://cdn.example/photo.jpg", photoId));

        // Déjà envoyée : pas de second envoi (pas de doublon dans la galerie)
        (await NewService().UploadPendingSessionsAsync()).Should().Be(0);
        _supabase.Verify(s => s.UploadPhotoAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<DateTime>()), Times.Once);
    }

    [Fact]
    public async Task UploadPendingSessionsAsync_keeps_session_pending_when_upload_fails()
    {
        var composite = NewComposite();
        await NewService().RecordSessionAsync(Guid.NewGuid(), EventId, DateTime.UtcNow, composite, composite);
        _supabase.Setup(s => s.UploadPhotoAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<DateTime>()))
                 .ThrowsAsync(new HttpRequestException("réseau coupé"));

        var sent = await NewService().UploadPendingSessionsAsync();

        sent.Should().Be(0);
        using var ctx = _db.NewContext();
        (await ctx.Sessions.SingleAsync(TestContext.Current.CancellationToken)).Uploaded.Should().BeFalse();
        ShareInfoFile.Read(composite)!.IsShared.Should().BeFalse();
        _log.Verify(l => l.LogWarningAsync("photo_upload", It.Is<string>(m => m.Contains("réseau coupé"))), Times.Once);
    }

    [Fact]
    public async Task UploadPendingSessionsAsync_skips_sessions_whose_montage_is_gone()
    {
        var composite = NewComposite();
        await NewService().RecordSessionAsync(Guid.NewGuid(), EventId, DateTime.UtcNow, composite, composite);
        File.Delete(composite);

        (await NewService().UploadPendingSessionsAsync()).Should().Be(0);

        _supabase.Verify(s => s.UploadPhotoAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<DateTime>()), Times.Never);
        _log.Verify(l => l.LogWarningAsync(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task UploadSessionAsync_reuses_url_when_composite_was_already_shared()
    {
        var composite = NewComposite();
        var id = await NewService().RecordSessionAsync(Guid.NewGuid(), EventId, DateTime.UtcNow, composite, composite);
        var photoId = Guid.NewGuid();
        ShareInfoFile.Write(composite, new ShareInfo(id, "https://cdn.example/deja.jpg", photoId));

        var result = await NewService().UploadSessionAsync(id);

        result.Should().Be(("https://cdn.example/deja.jpg", photoId));
        _supabase.Verify(s => s.UploadPhotoAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<DateTime>()), Times.Never);
        using var ctx = _db.NewContext();
        (await ctx.Sessions.SingleAsync(TestContext.Current.CancellationToken)).Uploaded.Should().BeTrue();
    }

    [Fact]
    public async Task Gallery_reopen_gets_the_same_session_id_as_first_display()
    {
        var composite = NewComposite();
        var firstDisplayId = await NewService().RecordSessionAsync(Guid.NewGuid(), EventId, DateTime.UtcNow, composite, composite);

        (await NewService().ResolveSessionIdAsync(composite)).Should().Be(firstDisplayId);

        // Même sans le fichier compagnon, la base retrouve la séance par son montage
        File.Delete(ShareInfoFile.PathFor(composite));
        (await NewService().ResolveSessionIdAsync(composite)).Should().Be(firstDisplayId);
    }

    [Fact]
    public async Task Gallery_reopen_of_a_photo_without_session_is_stable_and_counted_once()
    {
        // Montage sans ligne de séance (enregistrement raté), déjà partagé, fichier compagnon sans séance
        var composite = NewComposite();
        File.WriteAllText(ShareInfoFile.PathFor(composite),
            """{"url":"https://cdn.example/ancienne.jpg","photoId":"0a0b0c0d-1111-4222-8333-944455556666"}""");

        var first = await NewService().ResolveSessionIdAsync(composite);
        await NewService().AttachCompositeAsync(first, EventId, composite);
        var second = await NewService().ResolveSessionIdAsync(composite);
        await NewService().AttachCompositeAsync(second, EventId, composite);

        second.Should().Be(first);
        first.Should().NotBe(Guid.Empty);
        using var ctx = _db.NewContext();
        var session = await ctx.Sessions.SingleAsync(TestContext.Current.CancellationToken);
        session.Id.Should().Be(first);
        session.Uploaded.Should().BeTrue("la photo avait déjà été envoyée");
        ShareInfoFile.Read(composite)!.Url.Should().Be("https://cdn.example/ancienne.jpg");
    }

    [Fact]
    public async Task AttachCompositeAsync_switches_pending_session_to_the_effect_version()
    {
        var composite = NewComposite();
        var withEffect = NewComposite("photo_bw.jpg");
        var id = await NewService().RecordSessionAsync(Guid.NewGuid(), EventId, DateTime.UtcNow, composite, composite);

        await NewService().AttachCompositeAsync(id, EventId, withEffect);

        using var ctx = _db.NewContext();
        (await ctx.Sessions.SingleAsync(TestContext.Current.CancellationToken)).CompositePath.Should().Be(withEffect);
        (await NewService().ResolveSessionIdAsync(withEffect)).Should().Be(id);
    }
}
