namespace PolaKiosk.ViewModels;

/// <summary>
/// Partie de l'image caméra gardée dans une zone photo du cadre, en pixels de l'image (LAB-405,
/// logique pure, testée). Le CompositeService fait un cover-fit centré de la photo dans chaque zone :
/// le center-crop au ratio de la zone est exactement ce que l'invité verra sur l'écran Live.
/// </summary>
internal readonly record struct LiveFrameCrop(double X, double Y, double Width, double Height)
{
    /// <summary>Rognage centré d'une image <paramref name="frameWidth"/>×<paramref name="frameHeight"/> au ratio largeur/hauteur de la zone.</summary>
    public static LiveFrameCrop CenterCrop(double frameWidth, double frameHeight, double zoneAspect)
    {
        double w     = frameWidth;
        double h     = frameHeight;
        double camAR = w / h;

        if (camAR > zoneAspect)
        {
            // Caméra plus large que la zone → rogner gauche/droite
            double cropW = h * zoneAspect;
            return new LiveFrameCrop((w - cropW) / 2.0, 0, cropW, h);
        }

        // Caméra plus haute que la zone → rogner haut/bas
        double cropH = w / zoneAspect;
        return new LiveFrameCrop(0, (h - cropH) / 2.0, w, cropH);
    }
}
