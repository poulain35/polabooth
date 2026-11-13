using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Attribution des photos Canon aux prises de vue (logique managée d'EdsdkCameraService).</summary>
public class CaptureSlotTests
{
    [Fact]
    public async Task Late_photo_is_refused_and_the_next_capture_gets_its_own_photo()
    {
        var slot = new CaptureSlot();

        // Prise 1 : délai dépassé avant l'arrivée de la photo
        var first = slot.Begin("photos");
        slot.Expire(first, new TimeoutException("délai"));
        await FluentActions.Awaiting(() => first.Task).Should().ThrowAsync<TimeoutException>();

        // La photo de la prise 1 arrive en retard : aucune prise ne la réclame → transfert annulé
        slot.Claim().Should().BeNull();

        // Prise 2 : elle reçoit bien sa propre photo
        var second = slot.Begin("photos");
        var claimed = slot.Claim();
        claimed.Should().BeSameAs(second);
        claimed!.Complete("photo-2.jpg");

        (await second.Task).Should().Be("photo-2.jpg");
    }

    [Fact]
    public void A_capture_accepts_only_one_photo()
    {
        var slot = new CaptureSlot();
        var capture = slot.Begin("photos");

        slot.Claim().Should().BeSameAs(capture);
        // Deuxième transfert pour la même prise (DirItemCreated après DirItemRequestTransfer…)
        slot.Claim().Should().BeNull();
    }

    [Fact]
    public void Expiring_an_old_capture_does_not_close_the_current_one()
    {
        var slot = new CaptureSlot();
        var old = slot.Begin("photos");
        var current = slot.Begin("photos");

        slot.Expire(old, new TimeoutException("délai"));

        old.Task.IsFaulted.Should().BeTrue();
        slot.Claim().Should().BeSameAs(current);
    }

    [Fact]
    public async Task Cancel_fails_the_pending_capture_immediately()
    {
        var slot = new CaptureSlot();
        var capture = slot.Begin("photos");

        slot.Cancel(new InvalidOperationException("appareil débranché"));

        await FluentActions.Awaiting(() => capture.Task).Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("appareil débranché");
        slot.Claim().Should().BeNull();
    }

    [Fact]
    public async Task Completed_capture_keeps_its_photo_when_expired_afterwards()
    {
        var slot = new CaptureSlot();
        var capture = slot.Begin("photos");
        slot.Claim()!.Complete("photo.jpg");

        slot.Expire(capture, new TimeoutException("trop tard"));

        (await capture.Task).Should().Be("photo.jpg");
    }
}
