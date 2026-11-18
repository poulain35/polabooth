using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>Ce que l'écran de partage sait à un instant donné (lu dans <see cref="ResultViewModel"/>).</summary>
public sealed record ShareScreenInputs(
    bool ShowPrintBlock,
    bool CanPrint,
    bool IsPrinting,
    int Copies,
    int MaxCopies,
    bool ShowEmailTile,
    bool ShowQrTile,
    bool IsShareReady,
    bool ShowRetake,
    bool ShowFinish,
    bool ShowRemainingPrints = false,
    int? RemainingPrints = null,
    string PrintStatus = "",
    bool ShowCountdown = false,
    int SecondsLeft = 0,
    string ShareStatus = "");

/// <summary>
/// Partage composé par l'admin (LAB-297) : état de chaque bouton et valeur de chaque texte vivant,
/// avec les règles de l'écran standard. Fonction coupée pour l'événement : masqué. Fonction
/// indisponible pour l'instant (photo pas encore envoyée, plus de tirage, impression en cours) :
/// grisé. Le bloc d'impression (boutons et textes) apparaît et disparaît d'un bloc (spec D10).
/// </summary>
public static class ShareScreenState
{
    public static IReadOnlyDictionary<string, ScreenActionState> Actions(ShareScreenInputs s)
    {
        var printReady = s.CanPrint && !s.IsPrinting;
        return new Dictionary<string, ScreenActionState>(StringComparer.Ordinal)
        {
            ["print"]        = Print(s, printReady),
            ["copies_minus"] = Print(s, printReady && s.Copies > 1),
            ["copies_plus"]  = Print(s, printReady && s.Copies < s.MaxCopies),
            ["email"]        = Share(s.ShowEmailTile, s.IsShareReady),
            ["qr"]           = Share(s.ShowQrTile, s.IsShareReady),
            ["retake"]       = s.ShowRetake ? ScreenActionState.Active : ScreenActionState.Hidden,
            ["finish"]       = s.ShowFinish ? ScreenActionState.Active : ScreenActionState.Hidden,
        };

        static ScreenActionState Print(ShareScreenInputs s, bool ready)
            => !s.ShowPrintBlock ? ScreenActionState.Hidden : ready ? ScreenActionState.Active : ScreenActionState.Disabled;

        static ScreenActionState Share(bool shown, bool ready)
            => !shown ? ScreenActionState.Hidden : ready ? ScreenActionState.Active : ScreenActionState.Disabled;
    }

    /// <summary>Texte vide : masqué par l'écran.</summary>
    public static IReadOnlyDictionary<string, string> Texts(ShareScreenInputs s)
    {
        var print = s.ShowPrintBlock;
        return new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["copies"]           = print ? s.Copies.ToString(System.Globalization.CultureInfo.InvariantCulture) : "",
            ["prints_remaining"] = print && s.ShowRemainingPrints && s.CanPrint ? RemainingText(s.RemainingPrints) : "",
            ["print_status"]     = print ? s.PrintStatus : "",
            ["countdown"]        = s.ShowCountdown ? $"Retour à l'accueil dans {s.SecondsLeft} s" : "",
            ["share_status"]     = (s.ShowEmailTile || s.ShowQrTile) && !s.IsShareReady ? s.ShareStatus : "",
        };
    }

    /// <summary>
    /// Bandeau d'impression gardé par la borne (D9) : sans texte vivant <c>print_status</c> sur l'écran,
    /// la borne écrit elle-même l'état de l'impression (erreur, plus de tirage…) en haut. Vide sinon.
    /// </summary>
    public static string PrintBanner(bool layoutShowsPrintStatus, ShareScreenInputs s)
        => layoutShowsPrintStatus || !s.ShowPrintBlock ? "" : s.PrintStatus;

    /// <summary>« encore N tirages possibles » ; vide sans plafond (ou plus rien à tirer : <c>print_status</c> le dit).</summary>
    public static string RemainingText(int? remaining) => remaining switch
    {
        null or <= 0 => "",
        1            => "encore 1 tirage possible",
        var n        => $"encore {n} tirages possibles",
    };

    /// <summary>
    /// Ce qui change selon l'état de l'impression (D10) : en cours, erreur, confirmation, plus de
    /// tirage. Vide quand le bouton « Imprimer » dessiné suffit.
    /// </summary>
    public static string PrintStatus(bool isPrinting, string error, string notice, bool canPrint)
        => isPrinting ? "Impression…"
         : error.Length > 0 ? error
         : notice.Length > 0 ? notice
         : !canPrint ? "Plus de tirage disponible"
         : "";
}
