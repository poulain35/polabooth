using System.Globalization;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>Option de la liste déroulante caméra. Mode null = détection automatique.</summary>
public record CameraSourceOption(string Label, string? Mode, int WebcamIndex);

/// <summary>Taille des photos du Canon (valeur <see cref="CanonPhotoSize"/>).</summary>
public record PhotoSizeOption(string Label, string Size);

/// <summary>Délai de conservation d'un événement terminé sur le PC.</summary>
public record RetentionOption(string Label, int Days);

/// <summary>Ligne de la liste « .pola déjà importés » (LAB-321).</summary>
public sealed record PolaHistoryItem(PolaHistoryEntry Entry, string EventName, string EventDates, string ImportedText)
{
    private static readonly CultureInfo French = CultureInfo.GetCultureInfo("fr-FR");

    public static PolaHistoryItem From(PolaHistoryEntry entry) => new(
        entry,
        string.IsNullOrWhiteSpace(entry.EventName) ? "Événement sans nom" : entry.EventName,
        EventDateFormatter.Format(entry.StartDate, entry.EndDate) ?? "Dates non renseignées",
        ImportedLabel(entry.ImportedAt));

    /// <summary>« Importé le 15 novembre 2026 à 18:30 », à l'heure de Paris.</summary>
    public static string ImportedLabel(DateTimeOffset importedAt)
    {
        var paris = TimeZoneInfo.ConvertTime(importedAt, EventDateFormatter.Paris);
        return "Importé le " + paris.ToString("d MMMM yyyy 'à' HH:mm", French);
    }
}
