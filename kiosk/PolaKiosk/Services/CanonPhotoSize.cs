using PolaKiosk.EDSDK;

namespace PolaKiosk.Services;

/// <summary>
/// Taille des photos JPEG du Canon, réglée dans l'écran Admin. Sur le R100 (24 Mpx, 3:2) :
/// petite = S1 2976×1984, moyenne = M 3984×2656, pleine = L 6000×4000.
/// Le cas le plus exigeant est une seule photo en plein cadre sur un 10×15 portrait à 300 dpi
/// (1181×1771 px) : la photo paysage recadrée en portrait garde toute sa hauteur. S1 n'offre que
/// 1984 px pour 1771 (12 % de marge), M 2656 px (50 %) : M reste au-dessus de 300 dpi même si
/// la zone est recadrée ou agrandie, pour un fichier environ deux fois plus léger que L.
/// </summary>
public static class CanonPhotoSize
{
    public const string Small  = "small";
    public const string Medium = "medium";
    public const string Full   = "full";
    public const string Default = Medium;

    public static string Normalize(string? size) => size is Small or Medium or Full ? size : Default;

    public static uint ToEdsImageQuality(string? size) => Normalize(size) switch
    {
        Small => EdsImageQuality.S1JF,
        Full  => EdsImageQuality.LJF,
        _     => EdsImageQuality.MJF,
    };
}
