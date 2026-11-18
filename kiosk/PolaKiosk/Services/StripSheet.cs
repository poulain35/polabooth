namespace PolaKiosk.Services;

/// <summary>Rectangle en unités de page (centièmes de pouce à l'impression), à virgule pour une coupe exacte.</summary>
public readonly record struct SheetRect(double X, double Y, double Width, double Height)
{
    public double Right  => X + Width;
    public double Bottom => Y + Height;
}

/// <summary>Moitié de la feuille : zone découpée (<see cref="Area"/>) et place de la bande, centrée et
/// remplie, qui peut déborder de la zone (<see cref="Image"/>, rognée à la zone).</summary>
public sealed record SheetHalf(SheetRect Area, SheetRect Image);

/// <summary>Place des deux bandes sur la page ; coupe verticale (à X = <see cref="CutAt"/>) ou horizontale.</summary>
public sealed record StripSheetPlacement(SheetHalf First, SheetHalf Second, bool CutIsVertical, double CutAt);

/// <summary>
/// Feuille 10x15 qui porte la bande deux fois, côte à côte, sans marge (LAB-334, logique pure, testée).
/// La coupe 2 pouces des DNP partage la feuille au milieu de son petit côté : la coupe suit le grand côté.
/// stripV (bande debout) : deux bandes l'une à côté de l'autre, feuille en portrait.
/// stripH (bande couchée) : deux bandes l'une au-dessus de l'autre, feuille en paysage.
/// </summary>
public static class StripSheet
{
    /// <summary>Taille de la feuille doublée, en pixels du montage (pour l'orientation de la page).</summary>
    public static (int Width, int Height) SheetSize(int stripWidth, int stripHeight)
        => stripWidth <= stripHeight ? (stripWidth * 2, stripHeight) : (stripWidth, stripHeight * 2);

    /// <summary>Les deux moitiés de la page, coupées au milieu du petit côté, et la bande remplie dans chacune.</summary>
    public static StripSheetPlacement Place(int stripWidth, int stripHeight, SheetRect page)
    {
        var vertical = page.Width <= page.Height;
        SheetRect first, second;
        double cutAt;
        if (vertical)
        {
            var half = page.Width / 2;
            cutAt  = page.X + half;
            first  = new(page.X, page.Y, half, page.Height);
            second = new(cutAt, page.Y, page.Right - cutAt, page.Height);
        }
        else
        {
            var half = page.Height / 2;
            cutAt  = page.Y + half;
            first  = new(page.X, page.Y, page.Width, half);
            second = new(page.X, cutAt, page.Width, page.Bottom - cutAt);
        }

        return new(
            new(first, Cover(stripWidth, stripHeight, first)),
            new(second, Cover(stripWidth, stripHeight, second)),
            vertical, cutAt);
    }

    /// <summary>Remplissage « cover » : ratio gardé, zone remplie, image centrée (le débord est rogné).</summary>
    internal static SheetRect Cover(int imageWidth, int imageHeight, SheetRect area)
    {
        var scale = Math.Max(area.Width / imageWidth, area.Height / imageHeight);
        var w = imageWidth * scale;
        var h = imageHeight * scale;
        return new(area.X + (area.Width - w) / 2, area.Y + (area.Height - h) / 2, w, h);
    }
}
