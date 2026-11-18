namespace PolaKiosk.Services;

/// <summary>Sortes de réglage du pilote enregistrées par la borne (LAB-334).</summary>
public static class PrinterDriverSettingKind
{
    /// <summary>Réglage sans coupe, pour les 10x15.</summary>
    public const string Normal = "normal";

    /// <summary>« Bandes coupées » : la feuille 10x15 est coupée en deux (coupe 2 pouces des DNP).</summary>
    public const string StripCut = "strip-cut";

    public static string Label(string kind) => kind == StripCut ? "bandes coupées" : "normal";
}

/// <summary>
/// Réglage du pilote Windows tel que la fenêtre des préférences l'a rendu : DEVMODE complet (partie
/// privée du pilote comprise), en base64, gardé par imprimante dans <c>machine-settings.json</c>.
/// </summary>
public sealed record PrinterDriverSetting
{
    public string PrinterName { get; init; } = "";

    /// <summary><see cref="PrinterDriverSettingKind"/>.</summary>
    public string Kind { get; init; } = "";

    /// <summary>Taille du DEVMODE (dmSize + dmDriverExtra) : refuse un réglage d'un autre pilote.</summary>
    public int Size { get; init; }

    public string DevMode { get; init; } = "";

    public DateTimeOffset SavedAt { get; init; }

    public static PrinterDriverSetting Create(string printerName, string kind, byte[] devMode, DateTimeOffset savedAt) => new()
    {
        PrinterName = printerName,
        Kind        = kind,
        Size        = devMode.Length,
        DevMode     = Convert.ToBase64String(devMode),
        SavedAt     = savedAt,
    };
}

public enum DriverSettingStatus
{
    Valid,
    /// <summary>Aucun réglage de cette sorte enregistré.</summary>
    Missing,
    /// <summary>Réglage enregistré pour une autre imprimante.</summary>
    OtherPrinter,
    /// <summary>Base64 ou DEVMODE illisible.</summary>
    Unreadable,
    /// <summary>La taille ne correspond pas au pilote installé (pilote changé ou mis à jour).</summary>
    OtherDriver,
}

/// <summary>Réglage cherché pour une imprimante : état, DEVMODE prêt à appliquer si valide, réglage trouvé.</summary>
public sealed record DriverSettingLookup(DriverSettingStatus Status, byte[]? DevMode, PrinterDriverSetting? Setting);

/// <summary>Contrôles d'un DEVMODE enregistré (logique pure, testée).</summary>
public static class DriverSettingCheck
{
    // DEVMODEW : dmDeviceName (32 WCHAR = 64 octets), dmSpecVersion, dmDriverVersion, puis dmSize (68)
    // et dmDriverExtra (70), deux WORD.
    internal const int SizeOffset = 68;
    internal const int DriverExtraOffset = 70;
    internal const int HeaderLength = 72;

    /// <summary>dmSize + dmDriverExtra lus dans l'en-tête, 0 si le tampon est trop court.</summary>
    public static int DeclaredSize(byte[] devMode)
        => devMode.Length < HeaderLength
            ? 0
            : BitConverter.ToUInt16(devMode, SizeOffset) + BitConverter.ToUInt16(devMode, DriverExtraOffset);

    /// <summary>Tampon cohérent : en-tête lisible et taille annoncée égale à la taille du tampon.</summary>
    public static bool IsConsistent(byte[] devMode)
        => devMode.Length >= HeaderLength
           && BitConverter.ToUInt16(devMode, SizeOffset) >= HeaderLength
           && DeclaredSize(devMode) == devMode.Length;

    /// <summary>
    /// Contrôle un réglage pour l'imprimante utilisée. <paramref name="driverSize"/> = taille du DEVMODE du
    /// pilote installé (0 si inconnue : réglage refusé, on ne sait pas s'il convient).
    /// </summary>
    public static DriverSettingStatus Validate(PrinterDriverSetting setting, string printerName, int driverSize, out byte[]? devMode)
    {
        devMode = null;
        if (!SamePrinter(setting.PrinterName, printerName)) return DriverSettingStatus.OtherPrinter;

        byte[] bytes;
        try { bytes = Convert.FromBase64String(setting.DevMode ?? ""); }
        catch (FormatException) { return DriverSettingStatus.Unreadable; }
        if (!IsConsistent(bytes) || setting.Size != bytes.Length) return DriverSettingStatus.Unreadable;

        if (driverSize != bytes.Length) return DriverSettingStatus.OtherDriver;

        devMode = bytes;
        return DriverSettingStatus.Valid;
    }

    /// <summary>
    /// Réglage <paramref name="kind"/> de l'imprimante : le dernier enregistré pour elle ; sinon, s'il en
    /// existe un pour une autre imprimante, <see cref="DriverSettingStatus.OtherPrinter"/>.
    /// </summary>
    public static DriverSettingLookup Find(IReadOnlyList<PrinterDriverSetting>? saved, string kind, string printerName, int driverSize)
    {
        var ofKind = (saved ?? []).Where(s => s != null && s.Kind == kind).ToList();
        var mine = ofKind.LastOrDefault(s => SamePrinter(s.PrinterName, printerName));
        if (mine == null)
        {
            var other = ofKind.LastOrDefault();
            return other == null
                ? new(DriverSettingStatus.Missing, null, null)
                : new(DriverSettingStatus.OtherPrinter, null, other);
        }

        var status = Validate(mine, printerName, driverSize, out var devMode);
        return new(status, devMode, mine);
    }

    public static bool SamePrinter(string? a, string? b)
        => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
}
