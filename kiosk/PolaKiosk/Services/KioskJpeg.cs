using SkiaSharp;

namespace PolaKiosk.Services;

/// <summary>
/// Encodage JPEG des montages : couleur en pleine définition (4:4:4). L'encodage par défaut de Skia
/// (4:2:0) divise par deux la définition de la couleur : textes et bords colorés du cadre bavaient.
/// </summary>
public static class KioskJpeg
{
    public static SKData? Encode(SKBitmap bitmap, int quality)
    {
        using var pixmap = bitmap.PeekPixels();
        if (pixmap == null) return null;
        return pixmap.Encode(Options(quality));
    }

    public static SKData? Encode(SKImage image, int quality)
    {
        using var pixmap = image.PeekPixels();
        // Image hors mémoire (rare) : encodage standard.
        return pixmap != null ? pixmap.Encode(Options(quality)) : image.Encode(SKEncodedImageFormat.Jpeg, quality);
    }

    private static SKJpegEncoderOptions Options(int quality)
        => new(quality, SKJpegEncoderDownsample.Downsample444, SKJpegEncoderAlphaOption.Ignore);
}
