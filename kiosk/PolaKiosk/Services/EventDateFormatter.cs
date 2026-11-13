using System.Globalization;

namespace PolaKiosk.Services;

/// <summary>
/// Dates de l'événement affichées sur l'accueil (LAB-251), à l'heure de Paris quel que soit le
/// fuseau du PC : « Samedi 14 juin 2026 », « Du 14 au 15 juin 2026 », « Du 30 juin au 2 juillet 2026 »,
/// « Du 31 décembre 2026 au 1er janvier 2027 ». Sans date de début, rien n'est affiché.
/// </summary>
public static class EventDateFormatter
{
    private static readonly CultureInfo French = CultureInfo.GetCultureInfo("fr-FR");

    /// <summary>Fuseau de Paris (« Romance Standard Time » sous Windows, « Europe/Paris » ailleurs).</summary>
    public static TimeZoneInfo Paris { get; } = FindParis();

    /// <summary>Date longue de l'accueil personnalisé, ou null sans date de début.</summary>
    public static string? Format(DateTimeOffset? start, DateTimeOffset? end)
    {
        if (start is not { } s) return null;

        var first = ParisDay(s);
        // Fin absente ou pas après le début : un seul jour.
        var last = end is { } e && ParisDay(e) > first ? ParisDay(e) : first;

        if (last == first)
            return Capitalize($"{first.ToString("dddd", French)} {Day(first)} {Month(first)} {first.Year}");

        if (first.Year != last.Year)
            return $"Du {Day(first)} {Month(first)} {first.Year} au {Day(last)} {Month(last)} {last.Year}";
        if (first.Month != last.Month)
            return $"Du {Day(first)} {Month(first)} au {Day(last)} {Month(last)} {last.Year}";
        return $"Du {Day(first)} au {Day(last)} {Month(last)} {last.Year}";
    }

    /// <summary>Date courte du pied du tirage (« 14 · 06 · 2026 »), ou null sans date de début.</summary>
    public static string? FormatShort(DateTimeOffset? start)
        => start is { } s ? ParisDay(s).ToString("dd' · 'MM' · 'yyyy", CultureInfo.InvariantCulture) : null;

    /// <summary>Jour à Paris de l'instant donné (heure d'été comprise).</summary>
    internal static DateOnly ParisDay(DateTimeOffset instant)
        => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, Paris).DateTime);

    // Usage français : « 1er » pour le premier du mois.
    private static string Day(DateOnly date) => date.Day == 1 ? "1er" : date.Day.ToString(CultureInfo.InvariantCulture);

    private static string Month(DateOnly date) => date.ToString("MMMM", French);

    private static string Capitalize(string text) => text.Length == 0 ? text : char.ToUpper(text[0], French) + text[1..];

    // Fuseau du PC en dernier recours seulement : les bornes sont réglées sur Paris.
    private static TimeZoneInfo FindParis()
        => TimeZoneInfo.TryFindSystemTimeZoneById("Romance Standard Time", out var windows) ? windows
         : TimeZoneInfo.TryFindSystemTimeZoneById("Europe/Paris", out var iana) ? iana
         : TimeZoneInfo.Local;
}
