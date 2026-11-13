using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Photo en attente du questionnaire obligatoire (LAB-222) : validation, abandon, reprise au démarrage.</summary>
public sealed class SessionServicePendingTests : IDisposable
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private const string EventName = "Mariage";

    private readonly TestDb _db = new();
    private readonly TempDir _dir = new();
    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly SessionPathService _paths;
    private readonly Guid _sessionId = Guid.NewGuid();

    public SessionServicePendingTests()
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

    private string EventDir => _paths.GetEventDirectory(EventName, EventId);

    // Poses et montage pris en mode obligatoire, dans pending\{sessionId}\.
    private (string Photo, string Composite) NewPendingCapture()
    {
        _paths.EnsurePendingDirectoriesExist(_sessionId);
        var photo = Path.Combine(_paths.GetPendingOriginalsDirectory(_sessionId), "IMG_0001.jpg");
        var composite = Path.Combine(_paths.GetPendingCompositesDirectory(_sessionId), "composite_1.jpg");
        var thumb = Path.Combine(_paths.GetPendingCompositesDirectory(_sessionId), "thumbs", "composite_1.jpg");
        Directory.CreateDirectory(Path.GetDirectoryName(thumb)!);
        foreach (var file in new[] { photo, composite, thumb })
            File.WriteAllBytes(file, [0xFF, 0xD8, 0xFF, 0xD9]);
        return (photo, composite);
    }

    private async Task<int> SessionCountAsync()
    {
        using var ctx = _db.NewContext();
        return await ctx.Sessions.CountAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task Pending_photo_is_invisible_to_the_gallery_and_the_upload_loop()
    {
        NewPendingCapture();
        _paths.EnsureDirectoriesExist(EventName, EventId);

        _paths.GetCompositeFiles(EventName, EventId).Should().BeEmpty();
        (await NewService().UploadPendingSessionsAsync()).Should().Be(0);
        (await SessionCountAsync()).Should().Be(0);
        _supabase.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Commit_records_the_session_with_final_paths_and_moves_the_files()
    {
        var (photo, composite) = NewPendingCapture();
        var staged = 0;

        var displayed = await NewService().CommitPendingSessionAsync(_sessionId, EventId, EventName, DateTime.UtcNow, photo, composite,
            db =>
            {
                staged++;
                // Ce que LAB-225 ajoutera (la réponse) part dans le même SaveChanges que la séance.
                db.Sessions.Add(new SessionEntity { Id = Guid.NewGuid(), EventId = EventId, PhotoPath = "autre.jpg" });
            });

        var finalComposite = Path.Combine(EventDir, "composites", "composite_1.jpg");
        var finalPhoto = Path.Combine(EventDir, "originals", "IMG_0001.jpg");
        displayed.Should().Be(finalComposite);
        File.Exists(finalComposite).Should().BeTrue();
        File.Exists(finalPhoto).Should().BeTrue();
        File.Exists(Path.Combine(EventDir, "composites", "thumbs", "composite_1.jpg")).Should().BeTrue();
        Directory.Exists(_paths.GetPendingDirectory(_sessionId)).Should().BeFalse();
        _paths.GetCompositeFiles(EventName, EventId).Should().ContainSingle().Which.Should().Be(finalComposite);

        staged.Should().Be(1);
        (await SessionCountAsync()).Should().Be(2);
        using var ctx = _db.NewContext();
        var session = await ctx.Sessions.SingleAsync(s => s.Id == _sessionId, TestContext.Current.CancellationToken);
        session.PhotoPath.Should().Be(finalPhoto);
        session.CompositePath.Should().Be(finalComposite);
        session.Uploaded.Should().BeFalse();
        ShareInfoFile.Read(finalComposite)!.SessionId.Should().Be(_sessionId);
    }

    [Fact]
    public async Task Discard_deletes_the_pending_directory()
    {
        NewPendingCapture();

        NewService().DiscardPendingSession(_sessionId).Should().BeTrue();

        Directory.Exists(_paths.GetPendingDirectory(_sessionId)).Should().BeFalse();
        NewService().DiscardPendingSession(Guid.NewGuid()).Should().BeTrue(); // rien à supprimer
        (await SessionCountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Startup_cleanup_deletes_a_journey_never_validated()
    {
        NewPendingCapture();
        Directory.CreateDirectory(Path.Combine(_paths.GetPendingRoot(), "pas-un-guid"));

        var result = await NewService().CleanupPendingAsync();

        result.Should().Be(new PendingCleanupResult(Completed: 0, Discarded: 2, Failed: 0));
        Directory.GetDirectories(_paths.GetPendingRoot()).Should().BeEmpty();
        (await SessionCountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Startup_cleanup_finishes_the_move_of_a_validated_session()
    {
        var (photo, composite) = NewPendingCapture();
        var finalPhoto = Path.Combine(EventDir, "originals", "IMG_0001.jpg");
        var finalComposite = Path.Combine(EventDir, "composites", "composite_1.jpg");
        // Coupure juste après le SaveChanges : séance enregistrée, fichiers encore en attente.
        using (var ctx = _db.NewContext())
        {
            ctx.Sessions.Add(new SessionEntity
            {
                Id = _sessionId, EventId = EventId, CapturedAt = DateTime.UtcNow,
                PhotoPath = finalPhoto, CompositePath = finalComposite,
            });
            await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        var result = await NewService().CleanupPendingAsync();

        result.Should().Be(new PendingCleanupResult(Completed: 1, Discarded: 0, Failed: 0));
        File.Exists(finalPhoto).Should().BeTrue();
        File.Exists(finalComposite).Should().BeTrue();
        File.Exists(photo).Should().BeFalse();
        File.Exists(composite).Should().BeFalse();
        Directory.Exists(_paths.GetPendingDirectory(_sessionId)).Should().BeFalse();
        ShareInfoFile.Read(finalComposite)!.SessionId.Should().Be(_sessionId);
    }

    [Fact]
    public async Task Startup_cleanup_without_pending_root_does_nothing()
        => (await NewService().CleanupPendingAsync()).Should().Be(new PendingCleanupResult(0, 0, 0));
}
