using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-394 : compteur des PIN admin refusés, commun aux pavés et gardé au redémarrage.
public sealed class PinAttemptLimiterTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "pin-attempts-" + Guid.NewGuid().ToString("N"));
    private readonly string _path;
    private DateTime _now = new(2026, 11, 18, 12, 0, 0, DateTimeKind.Utc);

    public PinAttemptLimiterTests()
    {
        Directory.CreateDirectory(_dir);
        _path = Path.Combine(_dir, "pin-attempts.json");
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { /* nettoyage d'un dossier temporaire */ }
    }

    private PinAttemptLimiter NewLimiter() => new(_path, () => _now);

    private static PinFailure FailTimes(IPinAttemptLimiter limiter, int count)
    {
        PinFailure last = default;
        for (var i = 0; i < count; i++) last = limiter.RecordFailure();
        return last;
    }

    [Fact]
    public void Four_wrong_pins_leave_one_attempt()
    {
        var limiter = NewLimiter();

        FailTimes(limiter, 4).Should().Be(new PinFailure(1, null));
        limiter.LockRemaining().Should().BeNull();
    }

    [Fact]
    public void The_fifth_wrong_pin_locks_for_30_seconds()
    {
        var limiter = NewLimiter();

        FailTimes(limiter, 5).LockedFor.Should().Be(TimeSpan.FromSeconds(30));
        limiter.LockRemaining().Should().Be(TimeSpan.FromSeconds(30));

        _now = _now.AddSeconds(30);
        limiter.LockRemaining().Should().BeNull();
    }

    [Fact]
    public void The_lockout_doubles_up_to_15_minutes()
    {
        var limiter = NewLimiter();
        var lockouts = new List<TimeSpan>();
        for (var round = 0; round < 8; round++)
        {
            lockouts.Add(FailTimes(limiter, 5).LockedFor!.Value);
            _now += lockouts[^1];
        }

        lockouts.Select(l => l.TotalSeconds).Should().Equal(30, 60, 120, 240, 480, 900, 900, 900);
    }

    [Fact]
    public void The_lock_survives_a_restart()
    {
        FailTimes(NewLimiter(), 5);
        _now = _now.AddSeconds(10);

        NewLimiter().LockRemaining().Should().Be(TimeSpan.FromSeconds(20));
    }

    [Fact]
    public void Wrong_pins_are_counted_across_a_restart()
    {
        FailTimes(NewLimiter(), 3);

        NewLimiter().RecordFailure().Should().Be(new PinFailure(1, null));
    }

    [Fact]
    public void The_escalation_survives_a_restart()
    {
        FailTimes(NewLimiter(), 5);
        _now = _now.AddSeconds(31);

        FailTimes(NewLimiter(), 5).LockedFor.Should().Be(TimeSpan.FromSeconds(60));
    }

    [Fact]
    public void The_right_pin_resets_everything()
    {
        var limiter = NewLimiter();
        FailTimes(limiter, 5);
        _now = _now.AddSeconds(31);
        FailTimes(limiter, 2);

        limiter.RecordSuccess();

        FailTimes(limiter, 5).LockedFor.Should().Be(TimeSpan.FromSeconds(30));
        File.Exists(_path).Should().BeTrue();
    }

    [Fact]
    public void An_hour_without_error_resets_the_escalation()
    {
        var limiter = NewLimiter();
        FailTimes(limiter, 5);
        _now = _now.AddHours(1).AddMinutes(1);

        FailTimes(limiter, 5).LockedFor.Should().Be(TimeSpan.FromSeconds(30));
    }

    [Fact]
    public void An_unreadable_file_does_not_block_the_pad()
    {
        File.WriteAllText(_path, "{ pas du JSON");

        var limiter = NewLimiter();

        limiter.LockRemaining().Should().BeNull();
        limiter.RecordFailure().Should().Be(new PinFailure(4, null));
    }

    [Fact]
    public void A_lock_far_in_the_future_is_cut_to_the_longest_lockout()
    {
        File.WriteAllText(_path,
            """{"FailedAttempts":0,"Lockouts":99,"LockedUntilUtc":"2099-01-01T00:00:00Z","LastFailureUtc":"2099-01-01T00:00:00Z"}""");

        NewLimiter().LockRemaining().Should().Be(PinAttemptLimiter.MaxLockout);
    }

    [Fact]
    public void A_clock_moved_back_does_not_extend_the_lock()
    {
        var limiter = NewLimiter();
        FailTimes(limiter, 5);
        _now = _now.AddDays(-1);

        limiter.LockRemaining().Should().Be(TimeSpan.FromSeconds(30));
    }

    [Fact]
    public void A_write_error_does_not_break_the_counter()
    {
        Directory.CreateDirectory(_path);

        var limiter = NewLimiter();

        FailTimes(limiter, 5).LockedFor.Should().Be(TimeSpan.FromSeconds(30));
        limiter.LockRemaining().Should().Be(TimeSpan.FromSeconds(30));
    }

    [Fact]
    public void Without_a_file_the_counter_stays_in_memory()
    {
        var limiter = new PinAttemptLimiter(utcNow: () => _now);

        FailTimes(limiter, 5).LockedFor.Should().Be(TimeSpan.FromSeconds(30));
        Directory.EnumerateFileSystemEntries(_dir).Should().BeEmpty();
    }
}
