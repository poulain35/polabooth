using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using PolaKiosk.Models.LocalDb;

namespace PolaKiosk.Tests.Services;

/// <summary>Base d'une borne déjà installée : les nouvelles colonnes s'ajoutent sans perte (LAB-251).</summary>
public class LocalDbColumnsTests
{
    [Fact]
    public async Task Adds_the_event_dates_to_an_existing_database_and_keeps_its_rows()
    {
        using var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        using (var create = connection.CreateCommand())
        {
            // Table Events d'avant LAB-251, avec un événement déjà chargé.
            create.CommandText = """
                CREATE TABLE "Events" ("Id" TEXT NOT NULL PRIMARY KEY, "Name" TEXT NOT NULL,
                  "AccessCode" TEXT NOT NULL, "FormConfigJson" TEXT NOT NULL, "SyncedAt" TEXT NOT NULL);
                INSERT INTO "Events" VALUES ('6F1D2C3B-1111-4222-8333-944455556666', 'Mariage', 'ABC123', '{}', '2026-11-01 10:00:00');
                """;
            create.ExecuteNonQuery();
        }
        using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);

        await LocalDbColumns.EnsureAsync(db);
        await LocalDbColumns.EnsureAsync(db); // relancé à chaque démarrage : sans effet la 2e fois

        var ev = await db.Events.SingleAsync(TestContext.Current.CancellationToken);
        ev.Name.Should().Be("Mariage");
        ev.StartDate.Should().BeNull();

        ev.StartDate = new DateTimeOffset(2026, 6, 14, 16, 0, 0, TimeSpan.FromHours(2));
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        db.ChangeTracker.Clear();
        (await db.Events.SingleAsync(TestContext.Current.CancellationToken)).StartDate
            .Should().Be(new DateTimeOffset(2026, 6, 14, 14, 0, 0, TimeSpan.Zero));
    }

    [Fact]
    public async Task Does_nothing_on_a_new_database()
    {
        using var testDb = new TestDb();
        using var db = testDb.NewContext();

        await LocalDbColumns.EnsureAsync(db);

        db.Events.Add(new EventEntity { Id = Guid.NewGuid(), EndDate = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);
    }
}
