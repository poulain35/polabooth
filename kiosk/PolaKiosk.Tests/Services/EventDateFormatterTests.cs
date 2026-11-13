using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Dates de l'accueil personnalisé (LAB-251), toujours à l'heure de Paris.</summary>
public class EventDateFormatterTests
{
    private static DateTimeOffset At(string iso) => DateTimeOffset.Parse(iso);

    [Fact]
    public void No_start_date_shows_nothing()
    {
        EventDateFormatter.Format(null, null).Should().BeNull();
        EventDateFormatter.Format(null, At("2026-06-15T02:00:00Z")).Should().BeNull();
        EventDateFormatter.FormatShort(null).Should().BeNull();
    }

    [Theory]
    [InlineData("2026-06-14T14:00:00Z", null,                   "Dimanche 14 juin 2026")]
    [InlineData("2026-06-14T14:00:00Z", "2026-06-14T21:00:00Z", "Dimanche 14 juin 2026")]
    [InlineData("2026-06-14T14:00:00Z", "2026-06-13T21:00:00Z", "Dimanche 14 juin 2026")] // fin avant le début
    [InlineData("2026-08-01T10:00:00Z", null,                   "Samedi 1er août 2026")]
    public void A_single_day_shows_the_full_date(string start, string? end, string expected)
    {
        EventDateFormatter.Format(At(start), end == null ? null : At(end)).Should().Be(expected);
    }

    [Theory]
    // Soirée de mariage qui finit à 4 h du matin : deux jours à Paris.
    [InlineData("2026-06-14T14:00:00Z", "2026-06-15T02:00:00Z", "Du 14 au 15 juin 2026")]
    [InlineData("2026-06-30T10:00:00Z", "2026-07-02T10:00:00Z", "Du 30 juin au 2 juillet 2026")]
    [InlineData("2026-12-31T18:00:00Z", "2027-01-01T03:00:00Z", "Du 31 décembre 2026 au 1er janvier 2027")]
    public void Several_days_show_a_range(string start, string end, string expected)
    {
        EventDateFormatter.Format(At(start), At(end)).Should().Be(expected);
    }

    [Theory]
    // Heure d'été (UTC+2) et d'hiver (UTC+1) : le jour affiché est celui de Paris, pas celui d'UTC.
    [InlineData("2026-03-28T23:30:00Z", "Dimanche 29 mars 2026")]    // nuit du passage à l'heure d'été
    [InlineData("2026-06-14T22:30:00Z", "Lundi 15 juin 2026")]       // 0 h 30 à Paris, été
    [InlineData("2026-06-14T21:30:00Z", "Dimanche 14 juin 2026")]      // 23 h 30 à Paris, été
    [InlineData("2026-10-24T22:30:00Z", "Dimanche 25 octobre 2026")] // nuit du retour à l'heure d'hiver
    [InlineData("2026-12-12T23:30:00Z", "Dimanche 13 décembre 2026")]// 0 h 30 à Paris, hiver
    [InlineData("2026-12-12T22:30:00Z", "Samedi 12 décembre 2026")]  // 23 h 30 à Paris, hiver
    public void The_day_is_the_one_in_Paris(string instant, string expected)
    {
        EventDateFormatter.Format(At(instant), null).Should().Be(expected);
    }

    [Fact]
    public void The_offset_sent_does_not_change_the_day()
    {
        EventDateFormatter.Format(At("2026-06-15T00:30:00+02:00"), null)
            .Should().Be(EventDateFormatter.Format(At("2026-06-14T22:30:00Z"), null));
    }

    [Fact]
    public void The_print_footer_shows_a_short_date()
    {
        EventDateFormatter.FormatShort(At("2026-06-14T14:00:00Z")).Should().Be("14 · 06 · 2026");
        EventDateFormatter.FormatShort(At("2026-06-14T22:30:00Z")).Should().Be("15 · 06 · 2026");
    }
}
