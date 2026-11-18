using System.IO;
using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-326 : événement et séance joints à chaque journal.</summary>
public class KioskLogContextTests
{
    private static readonly Guid Event   = Guid.Parse("11111111-2222-4333-8444-555555555555");
    private static readonly Guid Other   = Guid.Parse("22222222-2222-4333-8444-555555555555");
    private static readonly Guid Session = Guid.Parse("66666666-7777-4888-8999-aaaaaaaaaaaa");

    [Fact]
    public void Without_event_nor_session_nothing_is_attached()
        => KioskLogContext.Resolve(null, null, null).Should().Be(((Guid?)null, (Guid?)null));

    [Fact]
    public void Outside_a_session_the_active_event_is_attached()
        => KioskLogContext.Resolve(Event, null, null).Should().Be((Event, (Guid?)null));

    [Fact]
    public void During_a_session_its_event_and_itself_are_attached()
        => KioskLogContext.Resolve(Event, Event, Session).Should().Be((Event, Session));

    [Fact]
    public void The_session_keeps_its_own_event_if_the_active_one_changed_meanwhile()
        => KioskLogContext.Resolve(Other, Event, Session).Should().Be((Event, Session));

    [Fact]
    public void Empty_ids_count_as_none()
    {
        KioskLogContext.Resolve(Guid.Empty, null, null).Should().Be(((Guid?)null, (Guid?)null));
        // Séance sans événement (prise de vue lancée sans événement actif) : ni l'une ni l'autre.
        KioskLogContext.Resolve(Guid.Empty, Guid.Empty, Session).Should().Be(((Guid?)null, (Guid?)null));
        KioskLogContext.Resolve(Event, Event, Guid.Empty).Should().Be((Event, (Guid?)null));
    }

    [Fact]
    public void The_active_event_is_read_at_each_log_and_the_session_opens_and_closes()
    {
        Guid? active = null;
        var context = new KioskLogContext(() => active);

        context.Current.Should().Be(((Guid?)null, (Guid?)null));

        active = Event; // événement chargé après la création du contexte
        context.Current.Should().Be((Event, (Guid?)null));

        context.BeginSession(Session, Event);
        context.Current.Should().Be((Event, Session));

        context.EndSession();
        context.Current.Should().Be((Event, (Guid?)null));
    }

    [Fact]
    public void An_unreadable_state_gives_no_event_instead_of_failing()
    {
        var context = new KioskLogContext(() => throw new IOException("state.json verrouillé"));

        context.Current.Should().Be(((Guid?)null, (Guid?)null));
        context.BeginSession(Session, Event);
        context.Current.Should().Be((Event, Session));
    }
}
