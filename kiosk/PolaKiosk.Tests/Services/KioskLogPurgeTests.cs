using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class KioskLogPurgeTests
{
    [Fact]
    public async Task PurgeOldLogsAsync_removes_old_sent_logs_and_anything_beyond_the_maximum()
    {
        using var db = new TestDb();
        var now = new DateTime(2026, 11, 3, 12, 0, 0, DateTimeKind.Utc);
        using (var ctx = db.NewContext())
        {
            ctx.KioskLogs.AddRange(
                Log("recent-envoye",    now.AddDays(-2),  synced: true),
                Log("ancien-envoye",    now.AddDays(-31), synced: true),
                Log("ancien-en-attente", now.AddDays(-31), synced: false),
                Log("trop-ancien",      now.AddDays(-91), synced: false));
            await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        using var purge = db.NewContext();
        var removed = await KioskLogService.PurgeOldLogsAsync(purge, now);

        removed.Should().Be(2);
        using var check = db.NewContext();
        (await check.KioskLogs.Select(l => l.Message).ToListAsync(TestContext.Current.CancellationToken))
            .Should().BeEquivalentTo("recent-envoye", "ancien-en-attente");
    }

    private static KioskLogEntity Log(string message, DateTime occurredAt, bool synced) => new()
    {
        Level = "info",
        Message = message,
        OccurredAt = occurredAt,
        Synced = synced,
    };
}
