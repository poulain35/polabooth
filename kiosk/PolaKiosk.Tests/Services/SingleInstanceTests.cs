using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-200 : une seule instance de PolaKiosk à la fois.
public class SingleInstanceTests
{
    // Nom propre à chaque test : jamais en conflit avec une borne ou un autre test.
    private readonly string _name = @"Local\PolaKiosk.Tests." + Guid.NewGuid().ToString("N");

    [Fact]
    public void A_second_instance_cannot_acquire_the_lock()
    {
        using var first = SingleInstance.TryAcquire(_name);
        first.Should().NotBeNull();

        // Un mutex Windows est réentrant pour son fil : la « seconde instance » est simulée par un autre fil.
        RunOnOtherThread(() =>
        {
            using var second = SingleInstance.TryAcquire(_name);
            return second;
        }).Should().BeNull();
    }

    [Fact]
    public void The_lock_is_available_again_once_released()
    {
        SingleInstance.TryAcquire(_name)!.Dispose();

        RunOnOtherThread(() =>
        {
            using var again = SingleInstance.TryAcquire(_name);
            return again;
        }).Should().NotBeNull();
    }

    private static SingleInstance? RunOnOtherThread(Func<SingleInstance?> action)
    {
        SingleInstance? result = null;
        var thread = new Thread(() => result = action());
        thread.Start();
        thread.Join();
        return result;
    }
}
