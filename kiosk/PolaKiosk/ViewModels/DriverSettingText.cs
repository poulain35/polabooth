using System.Globalization;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>Textes de l'état des réglages du pilote dans l'Admin (LAB-334, logique pure, testée).</summary>
public static class DriverSettingText
{
    public static string Status(DriverSettingLookup lookup, string kind, string printer)
    {
        var strip = kind == PrinterDriverSettingKind.StripCut;
        var title = strip ? "Bandes coupées" : "Normal";
        var fallback = strip
            ? "les bandes sortent seules en taille 2x6, sans être doublées."
            : "les 10x15 utilisent le réglage par défaut du pilote.";
        return lookup.Status switch
        {
            DriverSettingStatus.Valid =>
                $"{title} : enregistré le {Paris(lookup.Setting!.SavedAt)} pour « {printer} ».",
            DriverSettingStatus.Missing => $"{title} : non enregistré ; {fallback}",
            DriverSettingStatus.OtherPrinter =>
                $"{title} : enregistré pour une autre imprimante (« {lookup.Setting?.PrinterName} ») ; {fallback} À enregistrer pour « {printer} ».",
            DriverSettingStatus.OtherDriver =>
                $"{title} : le pilote de l'imprimante a changé depuis l'enregistrement ; {fallback} À enregistrer à nouveau.",
            _ => $"{title} : réglage illisible ; {fallback} À enregistrer à nouveau.",
        };
    }

    private static string Paris(DateTimeOffset at)
        => TimeZoneInfo.ConvertTime(at, EventDateFormatter.Paris)
            .ToString("d MMMM yyyy 'à' HH:mm", CultureInfo.GetCultureInfo("fr-FR"));
}
