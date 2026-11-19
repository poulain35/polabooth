using System.Globalization;
using PolaKiosk.Models;

namespace PolaKiosk.Services;

/// <summary>
/// Codes Canon (EDSDK) des réglages d'exposition → libellés affichés à la Canon (LAB-427).
/// Tables de la référence EDSDK (kEdsPropID_Tv, _Av, _ISOSpeed, _WhiteBalance, _AEMode) ; les
/// libellés sont lus tels quels par le SaaS : « 1/125 », « 0"5 », « 30" », « 5,6 », « 1600 »,
/// « Auto », « 5600 K ». Jamais d'exception : un code inconnu donne un libellé de repli lisible.
/// </summary>
public static class CanonExposure
{
    /// <summary>EDSDK renvoie 0xFFFFFFFF pour « pas de valeur » (propriété non lisible dans ce mode).</summary>
    public const int Invalid = unchecked((int)0xFFFFFFFF);

    /// <summary>Code Canon de la balance « Température de couleur » : la liste kelvin n'a de sens qu'avec lui.</summary>
    public const int WbColorTemperature = 9;

    /// <summary>Mode M (EdsAEMode.Manual) : le seul où les réglages s'appliquent.</summary>
    public const int ModeManual = 3;

    public const int KelvinMin = 2500, KelvinMax = 10000, KelvinStep = 100;

    /// <summary>1/200 s : vitesse de synchronisation du flash du R100 (D8).</summary>
    public const int FlashSyncTv = 0x75;

    public const string FlashSyncWarning =
        "Plus rapide que 1/200 : le flash risque de ne couvrir qu'une partie de la photo.";

    private static readonly Dictionary<int, string> TvLabels = new()
    {
        [0x0C] = "Bulb",
        [0x10] = "30\"", [0x13] = "25\"", [0x14] = "20\"", [0x15] = "20\"", [0x18] = "15\"",
        [0x1B] = "13\"", [0x1C] = "10\"", [0x1D] = "10\"", [0x20] = "8\"", [0x23] = "6\"",
        [0x24] = "6\"", [0x25] = "5\"", [0x28] = "4\"", [0x2B] = "3\"2", [0x2C] = "3\"",
        [0x2D] = "2\"5", [0x30] = "2\"", [0x33] = "1\"6", [0x34] = "1\"5", [0x35] = "1\"3",
        [0x38] = "1\"", [0x3B] = "0\"8", [0x3C] = "0\"7", [0x3D] = "0\"6", [0x40] = "0\"5",
        [0x43] = "0\"4", [0x44] = "0\"3", [0x45] = "0\"3",
        [0x48] = "1/4", [0x4B] = "1/5", [0x4C] = "1/6", [0x4D] = "1/6", [0x50] = "1/8",
        [0x53] = "1/10", [0x54] = "1/10", [0x55] = "1/13", [0x58] = "1/15", [0x5B] = "1/20",
        [0x5C] = "1/20", [0x5D] = "1/25", [0x60] = "1/30", [0x63] = "1/40", [0x64] = "1/45",
        [0x65] = "1/50", [0x68] = "1/60", [0x6B] = "1/80", [0x6C] = "1/90", [0x6D] = "1/100",
        [0x70] = "1/125", [0x73] = "1/160", [0x74] = "1/180", [0x75] = "1/200", [0x78] = "1/250",
        [0x7B] = "1/320", [0x7C] = "1/350", [0x7D] = "1/400", [0x80] = "1/500", [0x83] = "1/640",
        [0x84] = "1/750", [0x85] = "1/800", [0x88] = "1/1000", [0x8B] = "1/1250", [0x8C] = "1/1500",
        [0x8D] = "1/1600", [0x90] = "1/2000", [0x93] = "1/2500", [0x94] = "1/3000", [0x95] = "1/3200",
        [0x98] = "1/4000", [0x9B] = "1/5000", [0x9C] = "1/6000", [0x9D] = "1/6400", [0xA0] = "1/8000",
        [0xA3] = "1/10000", [0xA5] = "1/12800", [0xA8] = "1/16000",
    };

    private static readonly Dictionary<int, string> AvLabels = new()
    {
        [0x08] = "1", [0x0B] = "1,1", [0x0C] = "1,2", [0x0D] = "1,2", [0x10] = "1,4", [0x13] = "1,6",
        [0x14] = "1,8", [0x15] = "1,8", [0x18] = "2", [0x1B] = "2,2", [0x1C] = "2,5", [0x1D] = "2,5",
        [0x20] = "2,8", [0x23] = "3,2", [0x85] = "3,4", [0x24] = "3,5", [0x25] = "3,5", [0x28] = "4",
        [0x2B] = "4,5", [0x2C] = "4,5", [0x2D] = "5", [0x30] = "5,6", [0x33] = "6,3", [0x34] = "6,7",
        [0x35] = "7,1", [0x38] = "8", [0x3B] = "9", [0x3C] = "9,5", [0x3D] = "10", [0x40] = "11",
        [0x43] = "13", [0x44] = "13", [0x45] = "14", [0x48] = "16", [0x4B] = "18", [0x4C] = "19",
        [0x4D] = "20", [0x50] = "22", [0x53] = "25", [0x54] = "27", [0x55] = "29", [0x58] = "32",
        [0x5B] = "36", [0x5C] = "38", [0x5D] = "40", [0x60] = "45", [0x63] = "51", [0x64] = "54",
        [0x65] = "57", [0x68] = "64", [0x6B] = "72", [0x6C] = "76", [0x6D] = "80", [0x70] = "91",
    };

    private static readonly Dictionary<int, string> IsoLabels = new()
    {
        [0x00] = "Auto",
        [0x28] = "6", [0x30] = "12", [0x38] = "25", [0x40] = "50", [0x48] = "100", [0x4B] = "125",
        [0x4D] = "160", [0x50] = "200", [0x53] = "250", [0x55] = "320", [0x58] = "400", [0x5B] = "500",
        [0x5D] = "640", [0x60] = "800", [0x63] = "1000", [0x65] = "1250", [0x68] = "1600", [0x6B] = "2000",
        [0x6D] = "2500", [0x70] = "3200", [0x73] = "4000", [0x75] = "5000", [0x78] = "6400", [0x7B] = "8000",
        [0x7D] = "10000", [0x80] = "12800", [0x83] = "16000", [0x85] = "20000", [0x88] = "25600",
        [0x8B] = "32000", [0x8D] = "40000", [0x90] = "51200", [0x93] = "64000", [0x95] = "80000",
        [0x98] = "102400", [0xA0] = "204800", [0xA8] = "409600", [0xB0] = "819200",
    };

    private static readonly Dictionary<int, string> WbLabels = new()
    {
        [0] = "Auto", [1] = "Lumière du jour", [2] = "Nuageux", [3] = "Tungstène", [4] = "Fluorescent",
        [5] = "Flash", [6] = "Personnalisée", [8] = "Ombre", [WbColorTemperature] = "Température de couleur",
        [10] = "Réglage PC 1", [11] = "Réglage PC 2", [12] = "Réglage PC 3",
        [15] = "Personnalisée 2", [16] = "Personnalisée 3", [18] = "Personnalisée 4", [19] = "Personnalisée 5",
        [20] = "Réglage PC 4", [21] = "Réglage PC 5", [23] = "Auto : priorité blanc",
    };

    // EdsAEMode : libellés courts de la molette (lus aussi par le SaaS).
    private static readonly Dictionary<int, string> ModeLabels = new()
    {
        [0] = "P", [1] = "Tv", [2] = "Av", [ModeManual] = "M", [4] = "B", [5] = "A-DEP", [6] = "DEP",
        [7] = "C1", [8] = "Verrouillé", [9] = "Auto", [10] = "Scène", [11] = "Scène", [12] = "Scène",
        [13] = "Scène", [14] = "Scène", [15] = "Flash désactivé", [16] = "C2", [17] = "C3",
        [19] = "Auto créatif", [20] = "Vidéo", [21] = "Vidéo", [22] = "Auto", [25] = "Scène",
        [55] = "Fv",
    };

    public static string TvLabel(int code)
        => TvLabels.TryGetValue(code, out var label) ? label : Fallback("Vitesse", code);

    public static string AvLabel(int code)
        => AvLabels.TryGetValue(code, out var label) ? label : Fallback("Ouverture", code);

    public static string IsoLabel(int code)
        => IsoLabels.TryGetValue(code, out var label) ? label : Fallback("ISO", code);

    public static string WbLabel(int code)
        => WbLabels.TryGetValue(code, out var label) ? label : Fallback("Balance", code);

    public static string KelvinLabel(int kelvin) => kelvin.ToString(CultureInfo.InvariantCulture) + " K";

    /// <summary>Mode de la molette ; les modes scène, filtres et vidéo récents (23 et plus) donnent « Scène ».</summary>
    public static string ModeLabel(int code)
    {
        if (ModeLabels.TryGetValue(code, out var label)) return label;
        if (code == Invalid) return "Inconnu";
        return code is >= 23 and < 256 ? "Scène" : Fallback("Mode", code);
    }

    public static bool IsManual(int? modeCode) => modeCode == ModeManual;

    /// <summary>Libellé d'un code pour une clé de <see cref="CameraExposureKeys"/>.</summary>
    public static string Label(string key, int code) => key switch
    {
        CameraExposureKeys.Tv     => TvLabel(code),
        CameraExposureKeys.Av     => AvLabel(code),
        CameraExposureKeys.Iso    => IsoLabel(code),
        CameraExposureKeys.Wb     => WbLabel(code),
        CameraExposureKeys.Kelvin => KelvinLabel(code),
        _                         => Fallback("Valeur", code),
    };

    /// <summary>
    /// Plus rapide que 1/200 s (D8) : le flash risque de ne couvrir qu'une partie de la photo. Bulb,
    /// code invalide ou absent : non.
    /// </summary>
    public static bool IsFasterThanFlashSync(int? tvCode) => tvCode is > FlashSyncTv and <= 0xFF;

    public static bool IsValidKelvin(int kelvin)
        => kelvin is >= KelvinMin and <= KelvinMax && kelvin % KelvinStep == 0;

    /// <summary>2500 K à 10000 K par pas de 100 (le code est la valeur en kelvins).</summary>
    public static List<CameraOption> KelvinOptions()
    {
        var list = new List<CameraOption>((KelvinMax - KelvinMin) / KelvinStep + 1);
        for (var k = KelvinMin; k <= KelvinMax; k += KelvinStep) list.Add(new CameraOption(k, KelvinLabel(k)));
        return list;
    }

    /// <summary>
    /// Liste proposée à partir des codes permis par l'appareil, dans son ordre : codes invalides
    /// (0xFFFFFFFF, négatifs) et doublons écartés.
    /// </summary>
    public static List<CameraOption> Options(string key, IEnumerable<int> codes)
    {
        var seen = new HashSet<int>();
        var list = new List<CameraOption>();
        foreach (var code in codes)
        {
            if (code < 0 || !seen.Add(code)) continue;
            list.Add(new CameraOption(code, Label(key, code)));
        }
        return list;
    }

    private static string Fallback(string what, int code)
        => code == Invalid ? "—" : $"{what} (code 0x{code:X2})";
}
