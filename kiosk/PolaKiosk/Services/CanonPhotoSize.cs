using PolaKiosk.EDSDK;

namespace PolaKiosk.Services;

/// <summary>
/// Taille des photos JPEG du Canon, réglée dans l'écran Admin. Sur le R100 (24 Mpx, 3:2) :
/// petite = S1 2976×1984, moyenne = M 3984×2656, pleine = L 6000×4000.
/// Le montage est à la taille du PNG du cadre photo (2400×3600 en portrait, environ 600 dpi). Cas le
/// plus exigeant : la zone photo du portrait par défaut (2160×2511 px), la photo paysage recadrée
/// garde toute sa hauteur. M offre 2656 px pour 2511 (pas d'agrandissement), S1 1984 px (agrandie
/// d'un quart, encore au-dessus de 300 dpi) ; L ne sert qu'aux zones plus grandes ou très recadrées.
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
