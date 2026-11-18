using FluentAssertions;
using Microsoft.EntityFrameworkCore;

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
        { "Sessions",       ["Id", "EventId", "CapturedAt", "PhotoPath", "CompositePath", "Uploaded", "TemplateId"] },
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
}
