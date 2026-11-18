using System.Text;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// LAB-332 : au démarrage, les plantages de fatal.log passent dans les journaux kiosk à leur heure
/// d'origine, une seule fois (marque de position), et un fatal.log absent, illisible ou abîmé ne gêne rien.
/// Vrai KioskLogService sur SQLite en mémoire, RPC simulée.
/// </summary>
public sealed class FatalLogForwarderTests : IDisposable
{
    private const string Nl = "\r\n";
    private static readonly TimeZoneInfo Paris = EventDateFormatter.Paris;

    private readonly string _dir = Path.Combine(Path.GetTempPath(), "polakiosk-fwd-" + Guid.NewGuid().ToString("N"));
    private readonly TestDb _db = new();
    private readonly ServiceProvider _provider;
    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly Mock<INetworkMonitorService> _network = new();
    private readonly Mock<IKioskCredentials> _credentials = new();
    private readonly List<KioskLogRecord> _sent = [];
    private readonly Guid _activeEvent = Guid.NewGuid();
    // Redémarrage 2 minutes après le plantage de 21:04:07 (heure de Paris).
    private readonly FakeClock _clock = new(new DateTimeOffset(2026, 11, 15, 20, 6, 0, TimeSpan.Zero));

    public FatalLogForwarderTests()
    {
        Directory.CreateDirectory(_dir);
        _provider = new ServiceCollection().AddTransient(_ => _db.NewContext()).BuildServiceProvider();
        _network.SetupGet(n => n.IsOnline).Returns(true);
        _credentials.SetupGet(c => c.MachineId).Returns("MACHINE-1");
        _credentials.SetupGet(c => c.Secret).Returns("s3cret");
        _supabase.Setup(s => s.RecordLogsAsync(It.IsAny<IReadOnlyList<KioskLogRecord>>(), It.IsAny<CancellationToken>()))
                 .Callback<IReadOnlyList<KioskLogRecord>, CancellationToken>((logs, _) => _sent.AddRange(logs))
                 .ReturnsAsync(KioskLogSendResult.Ok);
    }

    public void Dispose()
    {
        _provider.Dispose();
        _db.Dispose();
        try { Directory.Delete(_dir, recursive: true); } catch { /* nettoyage d'un dossier temporaire */ }
    }

    private string LogPath  => Path.Combine(_dir, "fatal.log");
    private string OldPath  => LogPath + ".old";
    private string MarkPath => FatalLogForwarder.MarkPathFor(LogPath);

    private KioskLogService NewLogService()
        => new(_provider.GetRequiredService<IServiceScopeFactory>(), _network.Object, _credentials.Object, _supabase.Object,
            _clock, new KioskLogContext(() => _activeEvent));

    /// <summary>Un démarrage de la borne : relecture de fatal.log, puis la synchro habituelle.</summary>
    private async Task<int> RestartAsync(IKioskLogService? log = null)
    {
        var service = NewLogService();
        var count = await new FatalLogForwarder(LogPath, OldPath, MarkPath, log ?? service, "MACHINE-1", _clock, Paris).ForwardAsync();
        await service.UploadPendingAsync();
        return count;
    }

    private static string Entry(string time, string context, string message) => $"[{time}] [{context}] {message}{Nl}";

    private static string CrashEntry(string time, string message = "System.InvalidOperationException: boum") =>
        Entry(time, "app", message + Nl + "   at PolaKiosk.Views.HomeView.OnLoaded()");

    private void Append(string text, string? path = null) => File.AppendAllText(path ?? LogPath, text, Encoding.UTF8);

    private async Task<List<KioskLogEntity>> RowsAsync()
    {
        using var ctx = _db.NewContext();
        return await ctx.KioskLogs.AsNoTracking().ToListAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task A_crash_reaches_kiosk_logs_with_its_real_time_after_a_restart()
    {
        Append(CrashEntry("2026-11-15 21:04:07"));

        (await RestartAsync()).Should().Be(1);

        var sent = _sent.Should().ContainSingle().Subject;
        sent.Level.Should().Be("error");
        sent.Context.Should().Be("app");
        sent.Message.Should().Be("Plantage de l'application : System.InvalidOperationException: boum");
        sent.StackTrace.Should().Contain("HomeView.OnLoaded");
        sent.OccurredAtUtc.Should().Be(new DateTime(2026, 11, 15, 20, 4, 7, DateTimeKind.Utc)); // pas l'heure de lecture
        sent.EventId.Should().Be(_activeEvent);
        sent.SessionId.Should().BeNull();
        File.Exists(MarkPath).Should().BeTrue();
    }

    [Fact]
    public async Task A_second_restart_does_not_send_it_again()
    {
        Append(CrashEntry("2026-11-15 21:04:07"));
        await RestartAsync();

        (await RestartAsync()).Should().Be(0);

        _sent.Should().ContainSingle();
        (await RowsAsync()).Should().ContainSingle();
    }

    [Fact]
    public async Task Only_entries_written_since_the_last_pass_are_sent()
    {
        Append(CrashEntry("2026-11-15 21:04:07", "System.Exception: premier"));
        await RestartAsync();

        Append(Entry("2026-11-15 21:05:30", "ui-recovery", "System.Exception: second" + Nl + FatalLog.WatchdogExitNotice));
        Append(Entry("2026-11-15 21:05:31", "startup", "PolaKiosk est déjà lancé : cette nouvelle instance se ferme."));
        (await RestartAsync()).Should().Be(1);

        _sent.Select(l => $"{l.Context}|{l.Message}").Should().Equal(
            "app|Plantage de l'application : System.Exception: premier",
            "ui-recovery|Arrêt de l'application, relancée par le watchdog : System.Exception: second");
    }

    [Fact]
    public async Task A_new_entry_in_the_same_second_as_the_mark_is_still_sent()
    {
        Append(CrashEntry("2026-11-15 21:04:07", "System.Exception: A"));
        await RestartAsync();

        Append(Entry("2026-11-15 21:04:07", "exit", "Fermeture de la caméra non terminée après 5 s."));
        (await RestartAsync()).Should().Be(1);

        _sent.Select(l => l.Context).Should().Equal("app", "exit");
        _sent[1].Level.Should().Be("warning");
    }

    [Fact]
    public async Task Rotation_to_fatal_log_old_neither_loses_nor_repeats_an_entry()
    {
        Append(CrashEntry("2026-11-15 21:00:00", "System.Exception: avant"));
        await RestartAsync();

        // Une entrée de plus, puis rotation au-delà de 1 Mo (FatalLog.Write) et une entrée dans le nouveau fichier.
        Append(CrashEntry("2026-11-15 21:02:00", "System.Exception: juste avant la rotation"));
        File.Move(LogPath, OldPath, overwrite: true);
        Append(CrashEntry("2026-11-15 21:04:00", "System.Exception: après la rotation"));

        (await RestartAsync()).Should().Be(2);

        _sent.Select(l => l.Message).Should().Equal(
            "Plantage de l'application : System.Exception: avant",
            "Plantage de l'application : System.Exception: juste avant la rotation",
            "Plantage de l'application : System.Exception: après la rotation");
    }

    [Fact]
    public async Task A_truncated_or_deleted_file_only_brings_its_new_entries()
    {
        Append(CrashEntry("2026-11-15 21:00:00", "System.Exception: ancien"));
        await RestartAsync();

        File.WriteAllText(LogPath, CrashEntry("2026-11-15 21:04:00", "System.Exception: nouveau"));
        (await RestartAsync()).Should().Be(1);

        _sent.Select(l => l.Message).Should().Equal(
            "Plantage de l'application : System.Exception: ancien",
            "Plantage de l'application : System.Exception: nouveau");
    }

    [Fact]
    public async Task Missing_fatal_log_starts_normally()
    {
        (await RestartAsync()).Should().Be(0);

        _sent.Should().BeEmpty();
        File.Exists(MarkPath).Should().BeFalse();
    }

    [Fact]
    public async Task Unreadable_fatal_log_starts_normally_and_is_read_next_time()
    {
        Append(CrashEntry("2026-11-15 21:04:07"));
        using (new FileStream(LogPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) // verrouillé
            (await RestartAsync()).Should().Be(0);

        (await RestartAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Corrupted_fatal_log_starts_normally_and_keeps_its_readable_entries()
    {
        File.WriteAllBytes(LogPath, [0xFF, 0xFE, 0x00, 0x00, 0xC3, 0x28, 0x0A, 0x00]);
        Append("[2026-11-15 21:04:07] [app] System.Exception: lisible\0\0" + Nl);

        (await RestartAsync()).Should().Be(1);

        _sent.Single().Message.Should().Be("Plantage de l'application : System.Exception: lisible");
    }

    [Fact]
    public async Task A_utf8_bom_at_the_start_does_not_hide_the_first_entry()
    {
        File.WriteAllText(LogPath, CrashEntry("2026-11-15 21:04:07"), new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));

        (await RestartAsync()).Should().Be(1);
    }

    [Fact]
    public async Task A_corrupted_mark_rereads_the_file_without_duplicates()
    {
        Append(CrashEntry("2026-11-15 21:04:07"));
        await RestartAsync();

        File.WriteAllText(MarkPath, "{ pas du json");
        await RestartAsync();

        (await RowsAsync()).Should().ContainSingle(); // même id : déjà en base, la RPC est idempotente sur id
        _sent.Should().ContainSingle();
    }

    [Fact]
    public async Task Entries_older_than_seven_days_stay_on_the_pc_and_are_counted()
    {
        Append(CrashEntry("2026-11-01 10:00:00", "System.Exception: vieux"));
        Append(CrashEntry("2026-11-15 21:04:07", "System.Exception: récent"));

        (await RestartAsync()).Should().Be(1);

        // Le bilan part tout de suite (journal ordinaire), le plantage avec la synchro : ordre indifférent.
        _sent.Select(l => $"{l.Level}|{l.Context}|{l.Message}").Should().BeEquivalentTo(
            "error|app|Plantage de l'application : System.Exception: récent",
            $"warning|fatal-log|{FatalLogForwarder.SkippedMessage(1, 0)}");
        (await RestartAsync()).Should().Be(0); // la vieille entrée est marquée lue
    }

    [Fact]
    public async Task At_most_fifty_entries_per_start_the_most_recent()
    {
        var start = new DateTime(2026, 11, 15, 20, 0, 0);
        var text = new StringBuilder();
        for (var i = 0; i < 60; i++)
            text.Append(CrashEntry(start.AddSeconds(i).ToString("yyyy-MM-dd HH:mm:ss"), $"System.Exception: n°{i}"));
        Append(text.ToString());

        (await RestartAsync()).Should().Be(FatalLogForwarder.MaxEntriesPerStart);

        var crashes = _sent.Where(l => l.Context == "app").ToList();
        crashes.Should().HaveCount(50);
        crashes[0].Message.Should().EndWith("n°10");
        _sent.Should().Contain(l => l.Context == "fatal-log" && l.Message == FatalLogForwarder.SkippedMessage(0, 10));
    }

    [Fact]
    public async Task A_failed_local_write_keeps_the_mark_and_retries_next_start()
    {
        Append(CrashEntry("2026-11-15 21:04:07"));
        var failing = new Mock<IKioskLogService>();
        failing.Setup(l => l.RecordPastAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(),
            It.IsAny<string?>(), It.IsAny<DateTime>())).ReturnsAsync(false);

        (await RestartAsync(failing.Object)).Should().Be(0);
        File.Exists(MarkPath).Should().BeFalse();

        (await RestartAsync()).Should().Be(1);
    }

    [Fact]
    public async Task A_logging_failure_never_breaks_the_start()
    {
        Append(CrashEntry("2026-11-15 21:04:07"));
        var throwing = new Mock<IKioskLogService>();
        throwing.Setup(l => l.RecordPastAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(),
            It.IsAny<string?>(), It.IsAny<DateTime>())).ThrowsAsync(new InvalidOperationException("base illisible"));

        await FluentActions.Awaiting(() => RestartAsync(throwing.Object)).Should().NotThrowAsync();
    }

    [Fact]
    public void The_mark_survives_a_round_trip_on_disk()
    {
        var entry = new FatalLogEntry(new DateTime(2026, 11, 15, 21, 4, 7), "app", "x");
        var id = Guid.NewGuid();
        var mark = FatalLogMark.After([(entry, id)], previous: null);

        var json = Newtonsoft.Json.JsonConvert.SerializeObject(mark);
        var back = Newtonsoft.Json.JsonConvert.DeserializeObject<FatalLogMark>(json)!;

        json.Should().Contain("last_time").And.Contain("ids");
        back.HasRead(entry, id).Should().BeTrue();
        back.HasRead(entry with { Message = "autre" }, Guid.NewGuid()).Should().BeFalse();
        back.HasRead(entry with { LocalTime = entry.LocalTime.AddSeconds(-1) }, Guid.NewGuid()).Should().BeTrue();
    }

    private sealed class FakeClock(DateTimeOffset start) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => start;
    }
}
