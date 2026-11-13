using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Nettoyage du PC : dossiers d'événements terminés, garde-fous et lignes SQLite.</summary>
public sealed class EventCleanupServiceTests : IDisposable
{
    private const int Retention = EventCleanupService.DefaultRetentionDays;

    // Fichiers écrits maintenant : « maintenant » est avancé pour vieillir l'événement.
    private static readonly DateTime Later = DateTime.UtcNow.AddDays(Retention + 5);

    private readonly TempDir _dir = new();
    private readonly TestDb _db = new();
    private readonly SessionPathService _paths;

    public EventCleanupServiceTests()
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

    private string Root => _paths.GetEventsRoot();
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task CleanAsync_deletes_an_old_fully_sent_event_with_its_sessions_and_print_counts()
    {
        var ev = Guid.NewGuid();
        var dir = await CreateEventAsync("Mariage", ev, uploaded: true);
        var otherSession = await AddSessionElsewhereAsync();

        using var ctx = _db.NewContext();
        var report = await EventCleanupService.CleanAsync(ctx, Root, activeEventId: null, Retention, Later, null);

        report.Deleted.Should().Be(1);
        report.FreedBytes.Should().Be(2048 + 1024 + 128);
        Directory.Exists(dir).Should().BeFalse();
        Directory.Exists(Root).Should().BeTrue();

        using var check = _db.NewContext();
        (await check.Sessions.Select(s => s.Id).ToListAsync(Ct)).Should().Equal(otherSession);
        (await check.PrintCounts.Select(p => p.SessionId).ToListAsync(Ct)).Should().Equal(otherSession);
        // Le plafond d'impressions par événement reste en place.
        (await check.PrintLogs.CountAsync(p => p.EventId == ev, Ct)).Should().Be(1);
    }

    [Fact]
    public async Task CleanAsync_keeps_an_event_with_a_session_not_yet_sent_and_logs_it()
    {
        var dir = await CreateEventAsync("Anniversaire", Guid.NewGuid(), uploaded: false);
        var log = new Mock<IKioskLogService>();

        using var ctx = _db.NewContext();
        var report = await EventCleanupService.CleanAsync(ctx, Root, null, Retention, Later, log.Object);

        report.Deleted.Should().Be(0);
        report.KeptUnsent.Should().Be(1);
        Directory.Exists(dir).Should().BeTrue();
        log.Verify(l => l.LogWarningAsync("cleanup", It.Is<string>(m => m.Contains("pas encore envoyée"))), Times.Once);
        using var check = _db.NewContext();
        (await check.Sessions.CountAsync(Ct)).Should().Be(1);
    }

    [Fact]
    public async Task CleanAsync_never_deletes_the_active_event()
    {
        var ev = Guid.NewGuid();
        var dir = await CreateEventAsync("Salon", ev, uploaded: true);

        using var ctx = _db.NewContext();
        var report = await EventCleanupService.CleanAsync(ctx, Root, ev, Retention, Later, null);

        report.Deleted.Should().Be(0);
        Directory.Exists(dir).Should().BeTrue();
    }

    [Fact]
    public async Task CleanAsync_keeps_an_event_finished_less_than_the_retention_delay_ago()
    {
        var dir = await CreateEventAsync("Recent", Guid.NewGuid(), uploaded: true);

        using var ctx = _db.NewContext();
        var report = await EventCleanupService.CleanAsync(ctx, Root, null, Retention,
            DateTime.UtcNow.AddDays(Retention - 1), null);

        report.Deleted.Should().Be(0);
        Directory.Exists(dir).Should().BeTrue();
    }

    [Fact]
    public async Task CleanAsync_counts_a_recent_sync_as_activity()
    {
        var ev = Guid.NewGuid();
        var dir = await CreateEventAsync("Repris", ev, uploaded: true);
        using (var ctx = _db.NewContext())
        {
            ctx.Events.Add(new EventEntity { Id = ev, Name = "Repris", SyncedAt = Later.AddDays(-2) });
            await ctx.SaveChangesAsync(Ct);
        }

        using var clean = _db.NewContext();
        var report = await EventCleanupService.CleanAsync(clean, Root, null, Retention, Later, null);

        report.Deleted.Should().Be(0);
        Directory.Exists(dir).Should().BeTrue();
    }

    [Fact]
    public async Task CleanAsync_leaves_folders_not_created_by_the_kiosk()
    {
        var foreign = Path.Combine(Root, "Mes documents");
        Directory.CreateDirectory(foreign);
        await File.WriteAllTextAsync(Path.Combine(foreign, "a.txt"), "x", Ct);

        using var ctx = _db.NewContext();
        var report = await EventCleanupService.CleanAsync(ctx, Root, null, Retention, Later, null);

        report.Deleted.Should().Be(0);
        Directory.Exists(foreign).Should().BeTrue();
    }

    [Fact]
    public async Task CleanAsync_does_nothing_without_an_events_folder()
    {
        using var ctx = _db.NewContext();
        var report = await EventCleanupService.CleanAsync(ctx, Root, null, Retention, Later, null);

        report.Should().Be(new EventCleanupReport(0, 0, 0));
        Directory.Exists(_dir.Path).Should().BeTrue();
    }

    [Fact]
    public void IsEventDirectory_only_accepts_a_direct_child_of_the_events_root()
    {
        var root = Root;
        var eventDir = Path.Combine(root, "Mariage_0123abcd");
        Directory.CreateDirectory(Path.Combine(eventDir, "composites"));
        Directory.CreateDirectory(Path.Combine(_dir.Path, "Mariage_0123abcd"));

        EventCleanupService.IsEventDirectory(root, eventDir).Should().BeTrue();
        EventCleanupService.IsEventDirectory(root, eventDir + Path.DirectorySeparatorChar).Should().BeTrue();

        EventCleanupService.IsEventDirectory(root, root).Should().BeFalse();
        EventCleanupService.IsEventDirectory(root, _dir.Path).Should().BeFalse();
        EventCleanupService.IsEventDirectory(root, Path.Combine(eventDir, "composites")).Should().BeFalse();
        EventCleanupService.IsEventDirectory(root, Path.Combine(root, "..", "Mariage_0123abcd")).Should().BeFalse();
        EventCleanupService.IsEventDirectory(root, Path.Combine(eventDir, "..", "..")).Should().BeFalse();
        EventCleanupService.IsEventDirectory(root, Path.Combine(root, "Mariage")).Should().BeFalse();
    }

    [Fact]
    public void DeleteEventDirectory_refuses_anything_outside_the_events_root()
    {
        var outside = Path.Combine(_dir.Path, "Mariage_0123abcd");
        Directory.CreateDirectory(outside);

        var act = () => EventCleanupService.DeleteEventDirectory(Root, outside);

        act.Should().Throw<InvalidOperationException>();
        Directory.Exists(outside).Should().BeTrue();
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(30, 30)]
    [InlineData(1000, 365)]
    public void ClampRetentionDays_keeps_a_sane_delay(int days, int expected)
        => EventCleanupService.ClampRetentionDays(days).Should().Be(expected);

    [Fact]
    public void RetentionDays_defaults_to_30_days()
    {
        EventCleanupService.RetentionDays(new MachineSettings()).Should().Be(30);
        EventCleanupService.RetentionDays(new MachineSettings { EventRetentionDays = 7 }).Should().Be(7);
    }

    /// <summary>Dossier d'événement réel (original + montage + vignette) et sa séance en base.</summary>
    private async Task<string> CreateEventAsync(string name, Guid eventId, bool uploaded)
    {
        _paths.EnsureDirectoriesExist(name, eventId);
        var original  = Path.Combine(_paths.GetOriginalsDirectory(name, eventId), "photo.jpg");
        var composite = Path.Combine(_paths.GetCompositesDirectory(name, eventId), "montage.jpg");
        await File.WriteAllBytesAsync(original, new byte[2048], Ct);
        await File.WriteAllBytesAsync(composite, new byte[1024], Ct);
        AtomicFile.WriteAllBytes(CompositeThumbnail.PathFor(composite), new byte[128]);

        using var ctx = _db.NewContext();
        var session = new SessionEntity
        {
            Id = Guid.NewGuid(), EventId = eventId, CapturedAt = DateTime.UtcNow,
            PhotoPath = original, CompositePath = composite, Uploaded = uploaded,
        };
        ctx.Sessions.Add(session);
        ctx.PrintCounts.Add(new PrintCountEntity { SessionId = session.Id, Count = 1 });
        ctx.PrintLogs.Add(new PrintLogEntity { EventId = eventId, SessionId = session.Id });
        await ctx.SaveChangesAsync(Ct);
        return _paths.GetEventDirectory(name, eventId);
    }

    /// <summary>Séance d'un autre événement, dont le dossier n'existe pas sur ce PC.</summary>
    private async Task<Guid> AddSessionElsewhereAsync()
    {
        var eventId = Guid.NewGuid();
        using var ctx = _db.NewContext();
        var session = new SessionEntity
        {
            Id = Guid.NewGuid(), EventId = eventId, CapturedAt = DateTime.UtcNow, Uploaded = true,
            PhotoPath = Path.Combine(_paths.GetOriginalsDirectory("Ailleurs", eventId), "x.jpg"),
        };
        ctx.Sessions.Add(session);
        ctx.PrintCounts.Add(new PrintCountEntity { SessionId = session.Id, Count = 2 });
        await ctx.SaveChangesAsync(Ct);
        return session.Id;
    }
}
