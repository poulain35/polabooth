using System.Globalization;
using System.Windows;
using System.Windows.Media;

namespace PolaKiosk.Views;

/// <summary>Réduction d'un texte pour qu'il tienne dans sa place (titres de l'accueil, textes vivants).</summary>
public static class TextFit
{
    private static readonly CultureInfo French = CultureInfo.GetCultureInfo("fr-FR");

    /// <summary>
    /// Plus grande taille (de <paramref name="maxSize"/> à <paramref name="minSize"/>, de 2 en 2) où
    /// le texte tient en <paramref name="maxLines"/> lignes dans la largeur, sans couper un mot, et,
    /// si <paramref name="maxHeight"/> est donné, dans cette hauteur. Sinon <paramref name="minSize"/> :
    /// le texte est alors coupé avec « … » à l'affichage.
    /// </summary>
    public static double FitFontSize(string text, Typeface typeface, double maxSize, double minSize,
        double lineFactor, double width, int maxLines, double pixelsPerDip, double? maxHeight = null)
    {
        if (string.IsNullOrWhiteSpace(text)) return maxSize;

        for (var size = maxSize; size > minSize; size -= 2)
        {
            var formatted = new FormattedText(text, French, FlowDirection.LeftToRight,
                typeface, size, Brushes.Black, pixelsPerDip)
            {
                MaxTextWidth = width,
                LineHeight   = Math.Round(size * lineFactor),
            };
            bool wordsFit  = formatted.MinWidth <= width;
            bool linesFit  = formatted.Height <= maxLines * formatted.LineHeight + 0.5;
            bool heightFit = maxHeight is not { } h || Math.Min(formatted.Height, maxLines * formatted.LineHeight) <= h + 0.5;
            if (wordsFit && linesFit && heightFit) return size;
        }
        return minSize;
    }
}
