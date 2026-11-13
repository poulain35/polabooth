using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class RecoveryLimiterTests
{
    private static readonly DateTime T0 = new(2026, 11, 3, 20, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Refuses_the_recovery_beyond_the_limit_within_a_minute()
    {
        var limiter = new RecoveryLimiter(3, TimeSpan.FromMinutes(1));

        limiter.TryRecover(T0).Should().BeTrue();
        limiter.TryRecover(T0.AddSeconds(10)).Should().BeTrue();
        limiter.TryRecover(T0.AddSeconds(20)).Should().BeTrue();
        limiter.TryRecover(T0.AddSeconds(30)).Should().BeFalse();
    }

    [Fact]
    public void Forgets_recoveries_older_than_the_window()
    {
        var limiter = new RecoveryLimiter(2, TimeSpan.FromMinutes(1));

        limiter.TryRecover(T0).Should().BeTrue();
        limiter.TryRecover(T0.AddSeconds(30)).Should().BeTrue();
        limiter.TryRecover(T0.AddSeconds(90)).Should().BeTrue();
    }
}
