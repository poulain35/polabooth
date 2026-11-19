using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using PolaKiosk.Models.LocalDb;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// Base neuve créée par EnsureCreated (seule création depuis LAB-401) : toutes les tables et colonnes que
/// l'ancien rattrapage au démarrage ajoutait sont là.
/// </summary>
public class LocalDbSchemaTests
{
    public static TheoryData<string, string[]> Tables => new()
    {
        { "Events",         ["Id", "Name", "AccessCode", "FormConfigJson", "SyncedAt", "StartDate", "EndDate"] },
        { "Templates",      ["Id", "EventId", "Name", "Format", "CanvasJson", "ThumbnailPath", "SortOrder"] },
        { "Sessions",       ["Id", "EventId", "CapturedAt", "PhotoPath", "CompositePath", "Uploaded", "TemplateId",
                             "MediaType", "VideoPath", "PosterPath", "DurationMs", "Width", "Height", "UploadRejected"] },
        { "PrintLogs",      ["Id", "EventId", "SessionId", "CompositeUrl", "Copies", "MachineId", "PrintedAt", "Synced"] },
        { "KioskLogs",      ["Id", "MachineId", "Level", "Context", "Message", "StackTrace", "AppVersion",
                             "OccurredAt", "Synced", "EventId", "SessionId"] },
        { "GuestResponses", ["Id", "EventId", "PayloadProtected", "MarketingConsent", "AnsweredAt", "SessionIds",
                             "Attempts", "LastError"] },
        { "PhotoConsents",  ["Id", "EventId", "SessionId", "AccessCode", "ConsentText", "ConsentedAt", "Attempts",
                             "LastError"] },
    };

    [Theory]
    [MemberData(nameof(Tables))]
    public async Task New_database_has_every_column(string table, string[] columns)
    {
        using var testDb = new TestDb();
        await using var db = testDb.NewContext();

        var actual = await db.Database
            .SqlQuery<string>($"SELECT name AS \"Value\" FROM pragma_table_info({table})")
            .ToListAsync(TestContext.Current.CancellationToken);

        actual.Should().Contain(columns);
    }

    [Fact]
    public async Task New_database_has_every_table()
    {
        using var testDb = new TestDb();
        await using var db = testDb.NewContext();

        var tables = await db.Database
            .SqlQuery<string>($"SELECT name AS \"Value\" FROM sqlite_master WHERE type = 'table'")
            .ToListAsync(TestContext.Current.CancellationToken);

        tables.Should().Contain(["Events", "Templates", "Sessions", "PrintCounts", "PrintLogs", "KioskLogs",
            "GuestResponses", "PhotoConsents"]);
    }

    [Fact]
    public async Task A_new_database_needs_no_upgrade()
    {
        using var testDb = new TestDb();
        await using var db = testDb.NewContext();

        (await LocalDbSchema.UpgradeAsync(db)).Should().Be(0);
    }

    // Table Sessions d'une borne en service avant LAB-237 (création EF Core de la version 1.0.25).
    private const string OldSessionsTable = """
        CREATE TABLE "Sessions" (
            "Id" TEXT NOT NULL CONSTRAINT "PK_Sessions" PRIMARY KEY,
            "EventId" TEXT NOT NULL,
            "CapturedAt" TEXT NOT NULL,
            "PhotoPath" TEXT NOT NULL,
            "CompositePath" TEXT NULL,
            "Uploaded" INTEGER NOT NULL,
            "TemplateId" TEXT NULL
        );
        """;

    [Fact]
    public async Task An_existing_database_gets_the_animation_columns_and_keeps_its_sessions()
    {
        var ct = TestContext.Current.CancellationToken;
        using var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await db.Database.ExecuteSqlRawAsync(OldSessionsTable, ct);
        var id = Guid.NewGuid();
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"Sessions\" VALUES ({0}, {1}, '2026-11-18 21:00:00', 'p.jpg', 'c.jpg', 0, NULL)",
            [id.ToString().ToUpperInvariant(), Guid.NewGuid().ToString().ToUpperInvariant()], ct);

        // Démarrage : EnsureCreated (tables manquantes seulement) puis la mise à niveau.
        await db.Database.EnsureCreatedAsync(ct);
        (await LocalDbSchema.UpgradeAsync(db)).Should().Be(LocalDbSchema.AddedColumns.Length);
        (await LocalDbSchema.UpgradeAsync(db)).Should().Be(0, "deuxième démarrage : rien à refaire");

        var columns = await db.Database
            .SqlQuery<string>($"SELECT name AS \"Value\" FROM pragma_table_info('Sessions')")
            .ToListAsync(ct);
        var model = db.Model.FindEntityType(typeof(SessionEntity))!.GetProperties().Select(p => p.GetColumnName());
        columns.Should().BeEquivalentTo(model, "même colonnes qu'une base neuve");

        var session = await db.Sessions.AsNoTracking().SingleAsync(ct);
        session.Id.Should().Be(id);
        session.MediaType.Should().Be(SessionMediaType.Photo, "une ancienne séance est une photo");
        session.VideoPath.Should().BeNull();
        session.UploadRejected.Should().BeFalse();

        // Une séance animée s'enregistre dans la base mise à niveau.
        db.Sessions.Add(new SessionEntity
        {
            Id = Guid.NewGuid(), EventId = Guid.NewGuid(), CapturedAt = DateTime.UtcNow, PhotoPath = "p.jpg",
            CompositePath = "c.jpg", MediaType = SessionMediaType.Gif, VideoPath = "clip.mp4", PosterPath = "poster.jpg",
            DurationMs = 6000, Width = 720, Height = 1080,
        });
        await db.SaveChangesAsync(ct);
        (await db.Sessions.CountAsync(s => s.MediaType == SessionMediaType.Gif, ct)).Should().Be(1);
    }
}
