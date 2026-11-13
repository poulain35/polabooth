using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-230 : file des impressions envoyée par kiosk_record_print (marquage, reprise, verrou).</summary>
public sealed class PrintLogSyncServiceTests : IDisposable
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private const string AccessCode = "TUQNA5";

    private readonly TestDb _db = new();
    private readonly ServiceProvider _provider;
    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly Mock<INetworkMonitorService> _network = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly List<string> _logged = [];
    private readonly List<PrintLogRecord> _sent = [];

    public PrintLogSyncServiceTests()
    {
        _provider = new ServiceCollection().AddTransient(_ => _db.NewContext()).BuildServiceProvider();
        _network.SetupGet(n => n.IsOnline).Returns(true);
        _log.Setup(l => l.LogInfoAsync(It.IsAny<string>(), It.IsAny<string>()))
            .Callback<string, string>((c, m) => _logged.Add($"{c} {m}")).Returns(Task.CompletedTask);
        _log.Setup(l => l.LogWarningAsync(It.IsAny<string>(), It.IsAny<string>()))
            .Callback<string, string>((c, m) => _logged.Add($"{c} {m}")).Returns(Task.CompletedTask);
        _log.Setup(l => l.LogErrorAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>()))
            .Callback<string, string, string?>((c, m, _) => _logged.Add($"{c} {m}")).Returns(Task.CompletedTask);
        RespondWith(PrintLogSendResult.Ok);

        using var ctx = _db.NewContext();
        ctx.Events.Add(new EventEntity { Id = EventId, Name = "Mariage", AccessCode = AccessCode });
        ctx.SaveChanges();
    }

    public void Dispose()
    {
        _provider.Dispose();
        _db.Dispose();
    }

    private PrintLogSyncService NewService() => new(
        _provider.GetRequiredService<IServiceScopeFactory>(), _supabase.Object, _network.Object, _log.Object);

    private void RespondWith(PrintLogSendResult result)
        => _supabase.Setup(s => s.RecordPrintAsync(It.IsAny<PrintLogRecord>(), It.IsAny<CancellationToken>()))
                    .Callback<PrintLogRecord, CancellationToken>((r, _) => _sent.Add(r))
                    .ReturnsAsync(result);

    private async Task<PrintLogEntity> QueueAsync(Guid? eventId = null, DateTime? printedAt = null, int copies = 1)
    {
        using var ctx = _db.NewContext();
        var row = new PrintLogEntity
        {
            EventId   = eventId ?? EventId,
            SessionId = Guid.NewGuid(),
            Copies    = copies,
            PrintedAt = printedAt ?? DateTime.UtcNow,
        };
        ctx.PrintLogs.Add(row);
        await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        return row;
    }

    private async Task<List<PrintLogEntity>> RowsAsync()
    {
        using var ctx = _db.NewContext();
        return await ctx.PrintLogs.AsNoTracking().ToListAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task Pending_prints_are_sent_with_their_local_fields_and_marked_synced()
    {
        var printedAt = new DateTime(2026, 11, 4, 21, 10, 5, DateTimeKind.Utc);
        var row = await QueueAsync(printedAt: printedAt, copies: 3);

        var summary = await NewService().SendPendingAsync();

        summary.Should().Be(new PrintLogSendSummary(1, 0, 0));
        var sent = _sent.Should().ContainSingle().Subject;
        sent.Id.Should().Be(row.Id);
        sent.EventId.Should().Be(EventId);
        sent.AccessCode.Should().Be(AccessCode);
        sent.SessionId.Should().Be(row.SessionId);
        sent.Copies.Should().Be(3);
        sent.PrintedAtUtc.Should().Be(printedAt);
        sent.PrintedAtUtc.Kind.Should().Be(DateTimeKind.Utc);
        (await RowsAsync()).Should().ContainSingle().Which.Synced.Should().BeTrue();
        _logged.Should().ContainSingle().Which.Should().Contain("1 impression(s) envoyée(s)");
    }

    [Fact]
    public async Task A_synced_print_is_never_sent_again()
    {
        await QueueAsync();
        await NewService().SendPendingAsync();

        // La RPC répond true pour un doublon aussi : une fois marquée, la ligne ne repart plus.
        var second = await NewService().SendPendingAsync();

        second.Should().Be(PrintLogSendSummary.None);
        _sent.Should().ContainSingle();
    }

    [Fact]
    public async Task Prints_are_sent_oldest_first()
    {
        var late  = await QueueAsync(printedAt: DateTime.UtcNow);
        var early = await QueueAsync(printedAt: DateTime.UtcNow.AddMinutes(-30));

        await NewService().SendPendingAsync();

        _sent.Select(r => r.Id).Should().Equal(early.Id, late.Id);
    }

    [Fact]
    public async Task Definitively_refused_print_leaves_the_queue_but_stays_in_the_local_count()
    {
        await QueueAsync();
        RespondWith(PrintLogSendResult.Rejected(PrintLogSendResult.InvalidDataCode));

        var summary = await NewService().SendPendingAsync();

        summary.Should().Be(new PrintLogSendSummary(0, 0, 0, 1));
        // Ligne gardée (compteur local) mais plus jamais renvoyée.
        (await RowsAsync()).Should().ContainSingle().Which.Synced.Should().BeTrue();
        _logged.Should().ContainSingle().Which.Should().Contain("code 22023");
        (await NewService().SendPendingAsync()).Should().Be(PrintLogSendSummary.None);
        _sent.Should().ContainSingle();
    }

    [Fact]
    public async Task Refused_print_stays_pending_and_is_retried_next_cycle()
    {
        await QueueAsync();
        RespondWith(PrintLogSendResult.Rejected("P0001"));

        var summary = await NewService().SendPendingAsync();

        summary.Should().Be(new PrintLogSendSummary(0, 1, 0));
        (await RowsAsync()).Single().Synced.Should().BeFalse();
        _logged.Should().ContainSingle().Which.Should().Contain("code : P0001");

        RespondWith(PrintLogSendResult.Ok);
        (await NewService().SendPendingAsync()).Sent.Should().Be(1);
        (await RowsAsync()).Single().Synced.Should().BeTrue();
    }

    [Fact]
    public async Task A_refusal_does_not_stop_the_other_prints()
    {
        var refused  = await QueueAsync(printedAt: DateTime.UtcNow.AddMinutes(-2));
        var accepted = await QueueAsync(printedAt: DateTime.UtcNow.AddMinutes(-1));
        _supabase.Setup(s => s.RecordPrintAsync(It.Is<PrintLogRecord>(r => r.Id == refused.Id), It.IsAny<CancellationToken>()))
                 .ReturnsAsync(PrintLogSendResult.Rejected("HTTP 503"));

        var summary = await NewService().SendPendingAsync();

        summary.Should().Be(new PrintLogSendSummary(1, 1, 0));
        var rows = await RowsAsync();
        rows.Single(r => r.Id == refused.Id).Synced.Should().BeFalse();
        rows.Single(r => r.Id == accepted.Id).Synced.Should().BeTrue();
    }

    [Fact]
    public async Task Network_error_stops_the_pass_and_keeps_every_row()
    {
        await QueueAsync(printedAt: DateTime.UtcNow.AddMinutes(-2));
        await QueueAsync(printedAt: DateTime.UtcNow.AddMinutes(-1));
        _supabase.Setup(s => s.RecordPrintAsync(It.IsAny<PrintLogRecord>(), It.IsAny<CancellationToken>()))
                 .ThrowsAsync(new HttpRequestException("coupure"));

        var summary = await NewService().SendPendingAsync();

        summary.Should().Be(new PrintLogSendSummary(0, 1, 0));
        _supabase.Verify(s => s.RecordPrintAsync(It.IsAny<PrintLogRecord>(), It.IsAny<CancellationToken>()), Times.Once);
        (await RowsAsync()).Should().OnlyContain(r => !r.Synced);
        _logged.Should().ContainSingle().Which.Should().Contain("HttpRequestException");
    }

    [Fact]
    public async Task Print_without_a_local_access_code_is_kept_and_not_sent()
    {
        var orphan = await QueueAsync(eventId: Guid.NewGuid());
        await QueueAsync();

        var summary = await NewService().SendPendingAsync();

        summary.Should().Be(new PrintLogSendSummary(1, 0, 1));
        _sent.Should().ContainSingle().Which.EventId.Should().Be(EventId);
        (await RowsAsync()).Single(r => r.Id == orphan.Id).Synced.Should().BeFalse();
    }

    [Fact]
    public async Task Only_one_pass_at_a_time()
    {
        await QueueAsync();
        var release = new TaskCompletionSource<PrintLogSendResult>();
        var entered = new TaskCompletionSource();
        _supabase.Setup(s => s.RecordPrintAsync(It.IsAny<PrintLogRecord>(), It.IsAny<CancellationToken>()))
                 .Returns(() => { entered.TrySetResult(); return release.Task; });
        var service = NewService();

        var first = service.SendPendingAsync();
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        var second = await service.SendPendingAsync();
        release.SetResult(PrintLogSendResult.Ok);

        second.Should().Be(PrintLogSendSummary.None);
        (await first).Sent.Should().Be(1);
        _supabase.Verify(s => s.RecordPrintAsync(It.IsAny<PrintLogRecord>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task SendSoon_sends_in_the_background_when_online()
    {
        await QueueAsync();
        var service = NewService();

        service.SendSoon();
        await service.LastBackgroundSend.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);

        _sent.Should().ContainSingle();
        (await RowsAsync()).Single().Synced.Should().BeTrue();
    }

    [Fact]
    public async Task SendSoon_does_nothing_offline()
    {
        await QueueAsync();
        _network.SetupGet(n => n.IsOnline).Returns(false);
        var service = NewService();

        service.SendSoon();
        await service.LastBackgroundSend;

        _sent.Should().BeEmpty();
        (await RowsAsync()).Single().Synced.Should().BeFalse();
    }

    [Fact]
    public async Task SendSoon_never_throws_and_logs_the_error()
    {
        var broken = new Mock<IServiceScopeFactory>();
        broken.Setup(f => f.CreateScope()).Throws(new InvalidOperationException("database is locked"));
        var service = new PrintLogSyncService(broken.Object, _supabase.Object, _network.Object, _log.Object);

        service.SendSoon();
        await FluentActions.Awaiting(() => service.LastBackgroundSend).Should().NotThrowAsync();

        _logged.Should().ContainSingle().Which.Should().Contain(PrintLogSyncService.LogContext).And.Contain("database is locked");
    }
}
