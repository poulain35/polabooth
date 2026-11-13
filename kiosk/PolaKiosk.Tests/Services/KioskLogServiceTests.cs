using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// LAB-278 : journaux envoyés par kiosk_record_logs. Pas de secret, rien ne part ; licence refusée
/// (42501) ou limite de débit (PT429), les lignes restent en attente sans relance immédiate ; lots de 100.
/// </summary>
public sealed class KioskLogServiceTests : IDisposable
{
    private readonly TestDb _db = new();
    private readonly ServiceProvider _provider;
    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly Mock<INetworkMonitorService> _network = new();
    private readonly Mock<IKioskCredentials> _credentials = new();
    private readonly FakeClock _clock = new(new DateTimeOffset(2026, 11, 13, 12, 0, 0, TimeSpan.Zero));
    private readonly List<IReadOnlyList<KioskLogRecord>> _calls = [];
    private string _secret = "s3cret";

    public KioskLogServiceTests()
    {
        _provider = new ServiceCollection().AddTransient(_ => _db.NewContext()).BuildServiceProvider();
        _network.SetupGet(n => n.IsOnline).Returns(true);
        _credentials.SetupGet(c => c.MachineId).Returns("MACHINE-1");
        _credentials.SetupGet(c => c.Secret).Returns(() => _secret);
        RespondWith(KioskLogSendResult.Ok);
    }

    public void Dispose()
    {
        _provider.Dispose();
        _db.Dispose();
    }

    private KioskLogService NewService() => new(
        _provider.GetRequiredService<IServiceScopeFactory>(), _network.Object, _credentials.Object, _supabase.Object, _clock);

    private void RespondWith(KioskLogSendResult result)
        => _supabase.Setup(s => s.RecordLogsAsync(It.IsAny<IReadOnlyList<KioskLogRecord>>(), It.IsAny<CancellationToken>()))
                    .Callback<IReadOnlyList<KioskLogRecord>, CancellationToken>((logs, _) => _calls.Add(logs.ToList()))
                    .ReturnsAsync(result);

    private async Task QueueAsync(int count)
    {
        using var ctx = _db.NewContext();
        var start = new DateTime(2026, 11, 13, 8, 0, 0, DateTimeKind.Utc);
        for (var i = 0; i < count; i++)
            ctx.KioskLogs.Add(new KioskLogEntity
            {
                MachineId = "MACHINE-1", Level = "error", Context = "camera",
                Message = $"erreur {i}", OccurredAt = start.AddSeconds(i),
            });
        await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
    }

    private async Task<List<KioskLogEntity>> RowsAsync()
    {
        using var ctx = _db.NewContext();
        return await ctx.KioskLogs.AsNoTracking().ToListAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task Pending_logs_are_sent_and_marked_synced()
    {
        await QueueAsync(3);

        await NewService().UploadPendingAsync();

        var batch = _calls.Should().ContainSingle().Subject;
        batch.Select(l => l.Message).Should().Equal("erreur 0", "erreur 1", "erreur 2");
        batch[0].Level.Should().Be("error");
        batch[0].Context.Should().Be("camera");
        batch[0].OccurredAtUtc.Kind.Should().Be(DateTimeKind.Utc);
        (await RowsAsync()).Should().OnlyContain(l => l.Synced);

        await NewService().UploadPendingAsync();
        _calls.Should().ContainSingle("une ligne envoyée ne repart jamais");
    }

    [Fact]
    public async Task More_than_100_pending_logs_are_split_into_batches_of_100()
    {
        await QueueAsync(250);

        await NewService().UploadPendingAsync();

        _calls.Select(c => c.Count).Should().Equal(100, 100, 50);
        _calls.SelectMany(c => c.Select(l => l.Id)).Should().OnlyHaveUniqueItems();
        _calls[0][0].Message.Should().Be("erreur 0", "les plus anciennes partent d'abord");
        (await RowsAsync()).Should().OnlyContain(l => l.Synced);
    }

    [Fact]
    public async Task Without_secret_nothing_is_sent_and_logs_stay_local()
    {
        _secret = "";
        var service = NewService();

        await service.LogErrorAsync("camera", "Appareil photo absent");
        await QueueAsync(2);
        await service.UploadPendingAsync();

        _calls.Should().BeEmpty();
        var rows = await RowsAsync();
        rows.Should().HaveCount(3).And.OnlyContain(l => !l.Synced);
        rows.Should().ContainSingle(l => l.Message == "Appareil photo absent").Which.MachineId.Should().Be("MACHINE-1");
    }

    [Fact]
    public async Task Secret_is_read_when_sending_so_logs_leave_once_the_kiosk_is_paired()
    {
        _secret = "";
        var service = NewService();
        await service.LogErrorAsync("camera", "avant association");
        _calls.Should().BeEmpty();

        _secret = "secret-de-licence"; // association pendant que l'app tourne
        await service.UploadPendingAsync();

        _calls.Should().ContainSingle().Which.Should().ContainSingle().Which.Message.Should().Be("avant association");
        (await RowsAsync()).Should().OnlyContain(l => l.Synced);
    }

    [Fact]
    public async Task A_new_log_is_sent_immediately_when_online()
    {
        await NewService().LogWarningAsync("print", "Papier bientôt vide");

        var batch = _calls.Should().ContainSingle().Subject;
        batch.Should().ContainSingle().Which.Level.Should().Be("warning");
        (await RowsAsync()).Should().ContainSingle().Which.Synced.Should().BeTrue();
    }

    [Fact]
    public async Task Offline_a_new_log_waits_in_sqlite()
    {
        _network.SetupGet(n => n.IsOnline).Returns(false);

        await NewService().LogErrorAsync("upload", "réseau coupé");

        _calls.Should().BeEmpty();
        (await RowsAsync()).Should().ContainSingle().Which.Synced.Should().BeFalse();
    }

    [Fact]
    public async Task License_refused_keeps_logs_and_stops_immediate_sends_until_next_sync()
    {
        RespondWith(KioskLogSendResult.Rejected(KioskLogSendResult.LicenseRefusedCode));
        var service = NewService();

        await service.LogErrorAsync("camera", "première");
        await service.LogErrorAsync("camera", "deuxième");
        await service.LogErrorAsync("camera", "troisième");

        _calls.Should().ContainSingle("après un 42501, plus d'envoi immédiat jusqu'à la synchro suivante");
        (await RowsAsync()).Should().HaveCount(3).And.OnlyContain(l => !l.Synced);

        // Synchro suivante (cycle de 2 min) : licence réactivée, tout part en un lot.
        RespondWith(KioskLogSendResult.Ok);
        await service.UploadPendingAsync();

        _calls.Should().HaveCount(2);
        _calls[1].Select(l => l.Message).Should().Equal("première", "deuxième", "troisième");
        (await RowsAsync()).Should().OnlyContain(l => l.Synced);

        await service.LogInfoAsync("app", "envoi immédiat rétabli");
        _calls.Should().HaveCount(3);
    }

    [Fact]
    public async Task License_refused_during_sync_stops_the_batches_and_keeps_the_rows()
    {
        await QueueAsync(150);
        RespondWith(KioskLogSendResult.Rejected(KioskLogSendResult.LicenseRefusedCode));

        await NewService().UploadPendingAsync();

        _calls.Should().ContainSingle();
        (await RowsAsync()).Should().HaveCount(150).And.OnlyContain(l => !l.Synced);
    }

    [Theory]
    [InlineData(KioskLogSendResult.RateLimitedCode)]
    [InlineData("HTTP 429")]
    public async Task Rate_limited_backs_off_then_retries(string code)
    {
        await QueueAsync(150);
        var service = NewService();

        // Premier lot accepté, le second refusé par la limite de débit.
        _supabase.SetupSequence(s => s.RecordLogsAsync(It.IsAny<IReadOnlyList<KioskLogRecord>>(), It.IsAny<CancellationToken>()))
                 .ReturnsAsync(KioskLogSendResult.Ok)
                 .ReturnsAsync(KioskLogSendResult.Rejected(code));
        await service.UploadPendingAsync();
        (await RowsAsync()).Count(l => l.Synced).Should().Be(100);

        RespondWith(KioskLogSendResult.Ok);
        await service.UploadPendingAsync();
        await service.LogErrorAsync("camera", "pendant la pause");
        _calls.Should().BeEmpty("aucun appel pendant la pause");

        _clock.Advance(KioskLogService.RateLimitBackoff);
        await service.UploadPendingAsync();

        _calls.Should().ContainSingle().Which.Should().HaveCount(51);
        (await RowsAsync()).Should().HaveCount(151).And.OnlyContain(l => l.Synced);
    }

    [Fact]
    public async Task Other_errors_keep_the_rows_for_the_next_sync()
    {
        await QueueAsync(2);
        RespondWith(KioskLogSendResult.Rejected("HTTP 503"));
        var service = NewService();

        await service.UploadPendingAsync();
        (await RowsAsync()).Should().OnlyContain(l => !l.Synced);

        RespondWith(KioskLogSendResult.Ok);
        await service.UploadPendingAsync();
        (await RowsAsync()).Should().OnlyContain(l => l.Synced);
    }

    [Fact]
    public async Task Network_errors_never_reach_the_caller()
    {
        _supabase.Setup(s => s.RecordLogsAsync(It.IsAny<IReadOnlyList<KioskLogRecord>>(), It.IsAny<CancellationToken>()))
                 .ThrowsAsync(new HttpRequestException("coupure"));
        await QueueAsync(1);
        var service = NewService();

        await FluentActions.Awaiting(() => service.LogErrorAsync("camera", "erreur")).Should().NotThrowAsync();
        await FluentActions.Awaiting(service.UploadPendingAsync).Should().NotThrowAsync();

        (await RowsAsync()).Should().HaveCount(2).And.OnlyContain(l => !l.Synced);
    }

    private sealed class FakeClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now += by;
    }
}
