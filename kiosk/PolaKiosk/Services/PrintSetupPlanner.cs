namespace PolaKiosk.Services;

/// <summary>Ligne de journal à écrire une fois par lancement (<see cref="Key"/>).</summary>
public sealed record PrintSetupNote(string Key, bool IsWarning, string Message);

/// <summary>
/// Préparation d'une impression : papier demandé au pilote, réglage du pilote à appliquer (DEVMODE complet,
/// ou null = réglage par défaut du pilote), bande doublée sur la feuille.
/// </summary>
public sealed record PrintSetup(
    string PaperFormat,
    byte[]? DevMode,
    string? DevModeKind,
    bool DoubleStrip,
    IReadOnlyList<PrintSetupNote> Notes);

/// <summary>
/// Choix du réglage du pilote (LAB-334, logique pure, testée). Une bande (« 2x6 ») part en 4x6 doublée avec
/// le réglage « bandes coupées » ; sans lui, en taille 2x6 comme avant (LAB-320), avec un avertissement.
/// Un 10x15 part avec le réglage « normal », ou le réglage par défaut du pilote s'il n'est pas enregistré.
/// </summary>
public static class PrintSetupPlanner
{
    public const string StripFormat = "2x6";
    public const string SheetFormat = "4x6";

    public static PrintSetup Plan(string paperFormat, string printerName,
        IReadOnlyList<PrinterDriverSetting>? saved, int driverSize)
    {
        var notes = new List<PrintSetupNote>();
        var normal = DriverSettingCheck.Find(saved, PrinterDriverSettingKind.Normal, printerName, driverSize);

        if (paperFormat == StripFormat)
        {
            var cut = DriverSettingCheck.Find(saved, PrinterDriverSettingKind.StripCut, printerName, driverSize);
            if (cut.DevMode != null)
            {
                notes.Add(new($"{printerName}|strip-cut|ok", false,
                    $"Bande sur « {printerName} » : imprimée deux fois sur une feuille 4x6, avec le réglage « bandes coupées »."));
                return new(SheetFormat, cut.DevMode, PrinterDriverSettingKind.StripCut, true, notes);
            }

            AddIgnored(notes, cut, PrinterDriverSettingKind.StripCut, printerName, driverSize);
            AddIgnored(notes, normal, PrinterDriverSettingKind.Normal, printerName, driverSize);
            notes.Add(new($"{printerName}|strip-cut|fallback", true,
                $"Aucun réglage « bandes coupées » utilisable pour « {printerName} » : la bande part seule en taille 2x6, " +
                "sans être doublée. Pour imprimer deux bandes par feuille 10x15 : Administration → Imprimante → " +
                "« Enregistrer le réglage bandes coupées »."));
            return new(StripFormat, normal.DevMode, normal.DevMode != null ? PrinterDriverSettingKind.Normal : null, false, notes);
        }

        AddIgnored(notes, normal, PrinterDriverSettingKind.Normal, printerName, driverSize);
        return new(paperFormat, normal.DevMode, normal.DevMode != null ? PrinterDriverSettingKind.Normal : null, false, notes);
    }

    /// <summary>Avertissement pour un réglage enregistré mais refusé (le réglage absent ne dit rien ici).</summary>
    private static void AddIgnored(List<PrintSetupNote> notes, DriverSettingLookup lookup, string kind,
        string printerName, int driverSize)
    {
        if (lookup.Status is DriverSettingStatus.Valid or DriverSettingStatus.Missing) return;

        var label = PrinterDriverSettingKind.Label(kind);
        var reason = lookup.Status switch
        {
            DriverSettingStatus.OtherPrinter =>
                $"il a été enregistré pour « {lookup.Setting?.PrinterName} », pas pour « {printerName} »",
            DriverSettingStatus.OtherDriver =>
                $"il vient d'un autre pilote ({lookup.Setting?.Size} octets, pilote installé : " +
                (driverSize > 0 ? $"{driverSize} octets" : "taille inconnue") + ")",
            _ => "il est illisible",
        };
        notes.Add(new($"{printerName}|{kind}|{lookup.Status}", true,
            $"Réglage « {label} » ignoré pour « {printerName} » : {reason}. " +
            $"Enregistrez-le à nouveau : Administration → Imprimante → « Enregistrer le réglage {label} »."));
    }
}
