using System.Windows;

namespace PolaKiosk.Services;

/// <summary>
/// Placement de la surface 1920×1080 d'un écran composé sur l'écran réel, comme le fait un
/// <c>Viewbox Stretch="UniformToFill"</c> centré : la surface remplit l'écran à ses proportions et
/// le surplus est coupé à parts égales (en 16:10, une bande à gauche et à droite).
/// </summary>
public readonly record struct ScreenGeometry(double Scale, double OffsetX, double OffsetY)
{
    /// <summary>Placement pour un écran de <paramref name="screenWidth"/>×<paramref name="screenHeight"/>.</summary>
    public static ScreenGeometry Fit(double screenWidth, double screenHeight)
    {
        if (screenWidth <= 0 || screenHeight <= 0) return new ScreenGeometry(1, 0, 0);
        double scale = Math.Max(screenWidth / ScreenLayout.Width, screenHeight / ScreenLayout.Height);
        return new ScreenGeometry(scale,
            (screenWidth  - ScreenLayout.Width  * scale) / 2,
            (screenHeight - ScreenLayout.Height * scale) / 2);
    }

    /// <summary>Point de l'écran → point de la surface 1920×1080.</summary>
    public Point ToDesign(Point screen) => new((screen.X - OffsetX) / Scale, (screen.Y - OffsetY) / Scale);

    /// <summary>Point de la surface → point de l'écran.</summary>
    public Point ToScreen(Point design) => new(design.X * Scale + OffsetX, design.Y * Scale + OffsetY);

    /// <summary>Boîte de la surface (ex. un bouton) → boîte à l'écran.</summary>
    public Rect ToScreen(Rect design)
        => new(ToScreen(design.TopLeft), new Size(design.Width * Scale, design.Height * Scale));

    /// <summary>
    /// Action du bouton touché au point d'écran donné, parmi les boutons visibles (le dernier posé
    /// gagne s'ils se chevauchent, comme à l'affichage). Null : aucun bouton à cet endroit.
    /// </summary>
    public string? HitAction(IReadOnlyList<ScreenButton> buttons, Point screen, Func<string, bool>? isVisible = null)
    {
        var p = ToDesign(screen);
        for (int i = buttons.Count - 1; i >= 0; i--)
        {
            var b = buttons[i];
            if (isVisible != null && !isVisible(b.Action)) continue;
            if (p.X >= b.X && p.X < b.X + b.W && p.Y >= b.Y && p.Y < b.Y + b.H) return b.Action;
        }
        return null;
    }
}
