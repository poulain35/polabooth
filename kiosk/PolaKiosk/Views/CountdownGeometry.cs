using System.Globalization;
using System.Windows;
using System.Windows.Media;

namespace PolaKiosk.Views;

/// <summary>
/// LAB-248 : anneau du compte à rebours (maquette 2) et apparition du chiffre.
/// Repère : carré de <see cref="Size"/> px, centre au milieu.
/// </summary>
internal static class CountdownGeometry
{
    public const double Size          = 360;
    /// <summary>Axe de l'anneau (rayon du cercle de la maquette).</summary>
    public const double RingRadius    = 164;
    public const double RingThickness = 12;
    /// <summary>Fin de tour (fraction) sur laquelle le trait s'affine : pas de point qui disparaît d'un coup.</summary>
    public const double ThinningTail  = 0.04;

    /// <summary>Taille du chiffre (Fraunces SemiBold), en pixels.</summary>
    public const double DigitFontSize = 220;

    /// <summary>Apparition d'un chiffre : 70 % → 106 % → 100 %, en fondu.</summary>
    public static readonly TimeSpan PopDuration = TimeSpan.FromMilliseconds(450);

    public static readonly Point Center = new(Size / 2, Size / 2);

    /// <summary>
    /// Trait restant : arc depuis le haut, dans le sens des aiguilles d'une montre, sur
    /// <paramref name="progress"/> (1 = cercle plein, 0 = rien), bouts arrondis. Sur la toute fin,
    /// le trait s'affine jusqu'à disparaître.
    /// </summary>
    public static Geometry Arc(double progress)
    {
        if (progress <= 0.0005) return Geometry.Empty;
        if (progress >= 0.9995)
        {
            const double outer = RingRadius + RingThickness / 2, inner = RingRadius - RingThickness / 2;
            return new CombinedGeometry(GeometryCombineMode.Exclude,
                new EllipseGeometry(Center, outer, outer), new EllipseGeometry(Center, inner, inner));
        }

        var thickness = RingThickness * Math.Min(1, progress / ThinningTail);
        var angle = progress * 2 * Math.PI;
        var start = new Point(Center.X, Center.Y - RingRadius);
        var end = new Point(Center.X + RingRadius * Math.Sin(angle), Center.Y - RingRadius * Math.Cos(angle));

        var figure = new PathFigure { StartPoint = start, IsClosed = false, IsFilled = false };
        figure.Segments.Add(new ArcSegment(end, new System.Windows.Size(RingRadius, RingRadius), 0,
            isLargeArc: progress > 0.5, SweepDirection.Clockwise, isStroked: true));
        var path = new PathGeometry();
        path.Figures.Add(figure);

        var pen = new Pen(Brushes.Black, thickness) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round };
        return path.GetWidenedPathGeometry(pen);
    }

    /// <summary>
    /// Contour du chiffre (LAB-260), ramené en (0, 0) : centré dans l'anneau sur son dessin réel.
    /// Centrer la ligne de texte le plaçait trop haut, la police gardant de la place sous les chiffres.
    /// </summary>
    public static Geometry Digit(string text, FontFamily family, double pixelsPerDip)
    {
        var formatted = new FormattedText(text, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
            new Typeface(family, FontStyles.Normal, FontWeights.SemiBold, FontStretches.Normal),
            DigitFontSize, Brushes.Black, pixelsPerDip);
        var geometry = formatted.BuildGeometry(new Point(0, 0));
        var bounds = geometry.Bounds;
        if (bounds.IsEmpty) return Geometry.Empty;
        geometry.Transform = new TranslateTransform(-bounds.X, -bounds.Y);
        geometry.Freeze();
        return geometry;
    }

    /// <summary>Part restante de l'anneau après <paramref name="elapsed"/> sur <paramref name="total"/>.</summary>
    public static double Progress(TimeSpan elapsed, TimeSpan total)
        => total <= TimeSpan.Zero ? 0 : 1 - Math.Clamp(elapsed / total, 0, 1);

    /// <summary>
    /// Échelle et opacité du chiffre <paramref name="elapsed"/> après son apparition (animation
    /// « pop » de la maquette) : il grossit jusqu'à 106 % en devenant opaque, puis revient à 100 %.
    /// </summary>
    public static (double Scale, double Opacity) Pop(TimeSpan elapsed)
    {
        var t = Math.Clamp(elapsed / PopDuration, 0, 1);
        const double peak = 0.6;
        if (t < peak)
        {
            var u = EaseOut(t / peak);
            return (0.7 + (1.06 - 0.7) * u, u);
        }
        return (1.06 + (1 - 1.06) * EaseOut((t - peak) / (1 - peak)), 1);
    }

    private static double EaseOut(double t) => 1 - Math.Pow(1 - t, 2);
}
