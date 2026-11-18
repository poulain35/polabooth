using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Media.Imaging;
using SkiaSharp;

namespace PolaKiosk.Services;

/// <summary>
/// Chargement d'images pour l'affichage : décodées à la taille utile (jamais au-delà de
/// l'écran) et figées (Freeze), donc utilisables depuis n'importe quel thread. Une photo
/// 24 Mpx décodée en pleine résolution pèse ~100 Mo ; à la taille de l'écran, ~8 Mo.
/// </summary>
public static class ImageLoader
{
    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    /// <summary>Taille de l'écran principal en pixels physiques (1920×1080 si inconnue).</summary>
    public static (int Width, int Height) ScreenPixels
    {
        get
        {
            int w = GetSystemMetrics(SM_CXSCREEN), h = GetSystemMetrics(SM_CYSCREEN);
            return w > 0 && h > 0 ? (w, h) : (1920, 1080);
        }
    }

    /// <summary>Image affichée dans un cadre de la taille de l'écran (fill = UniformToFill).</summary>
    public static BitmapImage? LoadForScreen(string path, bool fill)
    {
        var (w, h) = ScreenPixels;
        return Load(path, w, h, fill);
    }

    /// <summary>Vignette d'au plus <paramref name="maxWidth"/> px de large.</summary>
    public static BitmapImage? LoadThumbnail(string path, int maxWidth)
        => Load(path, maxWidth, int.MaxValue, fill: false);

    public static BitmapImage? Load(string path, int boxWidth, int boxHeight, bool fill)
    {
        try
        {
            if (!File.Exists(path)) return null;

            int? decodeWidth = null;
            using (var codec = SKCodec.Create(path))
            {
                if (codec != null)
                    decodeWidth = DecodeWidth(codec.Info.Width, codec.Info.Height, boxWidth, boxHeight, fill);
            }

            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.UriSource     = new Uri(path);
            bmp.CacheOption   = BitmapCacheOption.OnLoad;
            bmp.CreateOptions = BitmapCreateOptions.IgnoreImageCache; // fichier réécrit sous le même nom
            if (decodeWidth is { } dw) bmp.DecodePixelWidth = dw;
            bmp.EndInit();
            bmp.Freeze();
            return bmp;
        }
        catch { return null; }
    }

    /// <summary>
    /// Image en mémoire (QR code, aperçu de l'appareil, aperçu d'un effet), décodée à
    /// <paramref name="decodeWidth"/> px de large si donné, figée. Lève si les octets sont illisibles.
    /// </summary>
    public static BitmapImage FromBytes(byte[] bytes, int? decodeWidth = null)
    {
        using var stream = new MemoryStream(bytes);
        var bmp = new BitmapImage();
        bmp.BeginInit();
        bmp.CacheOption  = BitmapCacheOption.OnLoad;
        bmp.StreamSource = stream;
        if (decodeWidth is { } dw) bmp.DecodePixelWidth = dw;
        bmp.EndInit();
        bmp.Freeze();
        return bmp;
    }

    /// <summary>
    /// Largeur de décodage pour afficher une image <paramref name="srcW"/>×<paramref name="srcH"/>
    /// dans un cadre donné (Uniform ou UniformToFill). Null = taille d'origine (jamais d'agrandissement).
    /// </summary>
    internal static int? DecodeWidth(int srcW, int srcH, int boxW, int boxH, bool fill)
    {
        if (srcW <= 0 || srcH <= 0 || boxW <= 0 || boxH <= 0) return null;

        double sx = (double)boxW / srcW, sy = (double)boxH / srcH;
        double scale = fill ? Math.Max(sx, sy) : Math.Min(sx, sy);
        if (scale >= 1.0) return null;

        return Math.Max(1, (int)Math.Ceiling(srcW * scale));
    }
}
