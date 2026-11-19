using System.Globalization;

namespace PolaKiosk.Services;

/// <summary>
/// Décalage et agrandissement de l'impression (LAB-433), gardés par borne dans machine-settings.json :
/// d'un rouleau à l'autre, l'image ne tombe pas toujours au même endroit sur la feuille. Un seul réglage
/// pour tous les formats, exprimé dans le sens d'une photo en portrait (celui de la feuille de test) :
/// X positif = vers la droite, Y positif = vers le bas.
/// </summary>
public record PrintAdjustment
{
    public double OffsetXMm { get; init; }
    public double OffsetYMm { get; init; }

    /// <summary>Agrandissement en %, pour que l'image décalée couvre encore toute la feuille.</summary>
    public double EnlargePercent { get; init; }
}

/// <summary>Déplacement et échelle à appliquer à la page, en unités de la page (centièmes de pouce).</summary>
public readonly record struct PageAdjustment(double OffsetX, double OffsetY, double Scale)
{
    public bool IsIdentity => OffsetX == 0 && OffsetY == 0 && Scale == 1;
}

public static class PrintAdjust
{
    public const double OffsetStepMm   = 0.5;
    public const double MaxOffsetMm    = 5;
    public const double EnlargeStep    = 0.5;
    public const double MaxEnlarge     = 5;

    public static readonly PrintAdjustment Zero = new();

    private static readonly CultureInfo Fr = CultureInfo.GetCultureInfo("fr-FR");

    /// <summary>Valeurs bornées et arrondies au pas ; null ou valeur illisible = 0.</summary>
    public static PrintAdjustment Normalize(PrintAdjustment? value)
    {
        if (value == null) return Zero;
        return new PrintAdjustment
        {
            OffsetXMm      = Snap(value.OffsetXMm, OffsetStepMm, -MaxOffsetMm, MaxOffsetMm),
            OffsetYMm      = Snap(value.OffsetYMm, OffsetStepMm, -MaxOffsetMm, MaxOffsetMm),
            EnlargePercent = Snap(value.EnlargePercent, EnlargeStep, 0, MaxEnlarge),
        };
    }

    public static bool IsZero(PrintAdjustment? value) => Normalize(value) == Zero;

    /// <summary>Un pas de plus (<paramref name="steps"/> = +1) ou de moins (−1) sur le décalage horizontal.</summary>
    public static PrintAdjustment StepX(PrintAdjustment? value, int steps)
    {
        var a = Normalize(value);
        return Normalize(a with { OffsetXMm = a.OffsetXMm + steps * OffsetStepMm });
    }

    public static PrintAdjustment StepY(PrintAdjustment? value, int steps)
    {
        var a = Normalize(value);
        return Normalize(a with { OffsetYMm = a.OffsetYMm + steps * OffsetStepMm });
    }

    public static PrintAdjustment StepEnlarge(PrintAdjustment? value, int steps)
    {
        var a = Normalize(value);
        return Normalize(a with { EnlargePercent = a.EnlargePercent + steps * EnlargeStep });
    }

    /// <summary>Millimètres en centièmes de pouce (unité de la page d'impression).</summary>
    public static double MmToHundredths(double mm) => mm * 100 / 25.4;

    /// <summary>
    /// Déplacement et échelle pour une page donnée. Le réglage est exprimé dans le sens d'une photo en
    /// portrait ; la page peut être tournée par rapport à ce sens (cadre paysage, bandes horizontales) :
    /// le décalage est alors tourné pour bouger l'image du même côté de la feuille.
    /// </summary>
    /// <param name="referenceLandscape">Orientation que prendrait une photo en portrait sur ce papier.</param>
    /// <param name="pageLandscape">Orientation de la page imprimée.</param>
    /// <param name="landscapeAngle">
    /// Rotation, en degrés dans le sens inverse des aiguilles d'une montre, du portrait du pilote vers son
    /// paysage (<c>PrinterSettings.LandscapeAngle</c> : 90 ou 270, 0 sans paysage).
    /// </param>
    public static PageAdjustment ForPage(PrintAdjustment? value, bool referenceLandscape, bool pageLandscape, int landscapeAngle)
    {
        var a = Normalize(value);
        var x = MmToHundredths(a.OffsetXMm);
        var y = MmToHundredths(a.OffsetYMm);

        // Sens de la photo portrait → sens du papier (portrait du pilote), puis → sens de la page.
        if (referenceLandscape) (x, y) = LandscapeToPaper(x, y, landscapeAngle);
        if (pageLandscape)      (x, y) = PaperToLandscape(x, y, landscapeAngle);

        return new PageAdjustment(Clean(x), Clean(y), 1 + a.EnlargePercent / 100);
    }

    // Repère y vers le bas. Paysage à 90° : le contenu est tourné de 90° dans le sens inverse des aiguilles
    // d'une montre sur le papier, donc « droite » du paysage = « haut » du papier.
    private static (double X, double Y) LandscapeToPaper(double x, double y, int angle) => angle switch
    {
        90  => (y, -x),
        270 => (-y, x),
        _   => (x, y),
    };

    private static (double X, double Y) PaperToLandscape(double x, double y, int angle) => angle switch
    {
        90  => (-y, x),
        270 => (y, -x),
        _   => (x, y),
    };

    // Libellés de l'Admin
    public static string OffsetXLabel(double mm) => mm == 0 ? "centré" : $"{Mm(Math.Abs(mm))} vers la {(mm > 0 ? "droite" : "gauche")}";
    public static string OffsetYLabel(double mm) => mm == 0 ? "centré" : $"{Mm(Math.Abs(mm))} vers le {(mm > 0 ? "bas" : "haut")}";
    public static string EnlargeLabel(double percent) => percent == 0 ? "aucun" : $"{percent.ToString("0.#", Fr)} %";

    /// <summary>Résumé d'une ligne, imprimé sur la feuille de test.</summary>
    public static string Summary(PrintAdjustment? value)
    {
        var a = Normalize(value);
        return $"Gauche / droite : {OffsetXLabel(a.OffsetXMm)} · Haut / bas : {OffsetYLabel(a.OffsetYMm)} · " +
               $"Agrandissement : {EnlargeLabel(a.EnlargePercent)}";
    }

    private static string Mm(double mm) => $"{mm.ToString("0.#", Fr)} mm";

    private static double Snap(double value, double step, double min, double max)
    {
        if (double.IsNaN(value) || double.IsInfinity(value)) return 0;
        var snapped = Math.Round(value / step, MidpointRounding.AwayFromZero) * step;
        return Clean(Math.Clamp(snapped, min, max));
    }

    // Évite « -0 » dans les comparaisons et les libellés.
    private static double Clean(double v) => v == 0 ? 0 : v;
}
