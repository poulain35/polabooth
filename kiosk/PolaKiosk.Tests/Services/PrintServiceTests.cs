using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Moq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class PrintServiceTests
{
    [Theory]
    [InlineData(true,  false, false, false, false, "offline")]
    [InlineData(false, true,  false, false, false, "offline")]
    [InlineData(false, false, true,  false, false, "paper_jam")]
    [InlineData(false, false, false, true,  false, "paper_out")]
    [InlineData(false, false, false, false, true,  "error")]
    [InlineData(false, false, false, false, false, "ready")]
    public void ClassifyPrinterStatus_maps_each_flag(
        bool offline, bool notAvailable, bool jam, bool outOfPaper, bool error, string expected)
    {
        PrintService.ClassifyPrinterStatus(offline, notAvailable, jam, outOfPaper, error)
            .Should().Be(expected);
    }

    [Fact]
    public void ClassifyPrinterStatus_offline_has_highest_priority()
    {
        // Hors ligne prime sur tous les autres défauts simultanés
        PrintService.ClassifyPrinterStatus(offline: true, notAvailable: false, jam: true, outOfPaper: true, error: true)
            .Should().Be("offline");
    }

    [Fact]
    public void ClassifyPrinterStatus_jam_beats_paper_out_and_error()
    {
        PrintService.ClassifyPrinterStatus(offline: false, notAvailable: false, jam: true, outOfPaper: true, error: true)
            .Should().Be("paper_jam");
    }

    private static readonly Guid EventA = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private static readonly Guid EventB = Guid.Parse("0a0b0c0d-1111-4222-8333-944455556666");

    [Fact]
    public async Task GetEventPrintCountAsync_counts_every_print_of_the_event()
    {
        using var db = new TestDb();
        var session1 = Guid.NewGuid();
        var session2 = Guid.NewGuid();
        var print = new PrintService(db.NewContext(), Mock.Of<IPrintLogSyncService>());

        await print.RecordPrintAsync(session1, EventA, copies: 2);
        await print.RecordPrintAsync(session1, EventA, copies: 1);
        await print.RecordPrintAsync(session2, EventA, copies: 1);
        await print.RecordPrintAsync(Guid.NewGuid(), EventB, copies: 5);

        var fresh = new PrintService(db.NewContext(), Mock.Of<IPrintLogSyncService>());
        (await fresh.GetEventPrintCountAsync(EventA)).Should().Be(4);
        (await fresh.GetEventPrintCountAsync(EventB)).Should().Be(5);
        (await fresh.GetSessionPrintCountAsync(session1)).Should().Be(3);

        using var ctx = db.NewContext();
        (await ctx.PrintLogs.CountAsync(l => l.EventId == EventA && !l.Synced, TestContext.Current.CancellationToken)).Should().Be(3);
    }

    [Fact]
    public async Task CanPrintAsync_blocks_beyond_max_prints_per_event()
    {
        using var db = new TestDb();
        var print = new PrintService(db.NewContext(), Mock.Of<IPrintLogSyncService>());
        var newSession = Guid.NewGuid();

        await print.RecordPrintAsync(Guid.NewGuid(), EventA, copies: 2);
        (await print.CanPrintAsync(EventA, 3, newSession, null)).Should().BeTrue();
        (await print.GetRemainingPrintsAsync(EventA, 3, newSession, null)).Should().Be(1);

        await print.RecordPrintAsync(Guid.NewGuid(), EventA, copies: 1);
        (await print.CanPrintAsync(EventA, 3, newSession, null)).Should().BeFalse();
        (await print.GetRemainingPrintsAsync(EventA, 3, newSession, null)).Should().Be(0);

        // Les impressions d'un autre événement ne consomment pas ce plafond
        (await print.CanPrintAsync(EventB, 3, newSession, null)).Should().BeTrue();
    }

    [Fact]
    public async Task GetRemainingPrintsAsync_takes_the_tightest_cap()
    {
        using var db = new TestDb();
        var print = new PrintService(db.NewContext(), Mock.Of<IPrintLogSyncService>());
        var session = Guid.NewGuid();
        await print.RecordPrintAsync(session, EventA, copies: 2);

        (await print.GetRemainingPrintsAsync(EventA, null, session, null)).Should().BeNull("aucun plafond");
        (await print.GetRemainingPrintsAsync(EventA, 10, session, 3)).Should().Be(1);
        (await print.GetRemainingPrintsAsync(EventA, 3, session, 10)).Should().Be(1);
        (await print.GetRemainingPrintsAsync(EventA, 10, session, 2)).Should().Be(0);
        (await print.CanPrintAsync(EventA, 10, session, 2)).Should().BeFalse();
        (await print.CanPrintAsync(EventA, null, Guid.NewGuid(), 2)).Should().BeTrue();
    }
}
