using System.Windows.Media.Imaging;
using SkiaSharp;

namespace PolaKiosk.Services;

/// <summary>
/// Équivalent logiciel de « Canon Auto Exposure » pour l'aperçu de l'écran Live : mesure la
/// luminosité de chaque image et applique un gain adaptatif (lissé, borné) pour un aperçu clair même
/// si l'appareil est réglé pour le flash. N'affecte QUE le live view : la photo capturée n'est jamais
/// modifiée. Une instance par écran (le gain est lissé d'une image à l'autre).
/// </summary>
internal sealed class LiveViewBrightener
{
    private const double TargetLuma = 150.0;
    private const double MaxGain    = 12.0;
    private const double Smoothing  = 0.15;

    private double _gain = 1.0; // gain d'éclaircissement live view, lissé dans le temps

    /// <summary>
    /// Gain suivant, d'après la luminance moyenne (0-255) de l'image : borné entre 1 et 12, puis lissé
    /// pour éviter le scintillement. Le plafond est volontairement élevé : quand la scène est quasi
    /// noire (appareil réglé pour le flash, ambiance très sombre), on « surexpose » le live view pour
    /// que le sujet reste visible et puisse se cadrer. Une scène déjà correctement exposée garde un
    /// gain proche de 1 (pas de sur-éclaircissement).
    /// </summary>
    internal static double NextGain(double currentGain, double averageLuma)
    {
        double targetGain = Math.Clamp(TargetLuma / Math.Max(averageLuma, 1.0), 1.0, MaxGain);
        return currentGain + (targetGain - currentGain) * Smoothing;
    }

    /// <summary>Image éclaircie, figée (Freeze) donc utilisable depuis l'UI ; null si le JPEG est illisible.</summary>
    public BitmapSource? Brighten(byte[] jpegBytes)
    {
        using var bitmap = SKBitmap.Decode(jpegBytes);
        if (bitmap == null) return null;

        // 1. Luminance moyenne (échantillonnée pour la vitesse, ~80×80 points max)
        double sum = 0; int n = 0;
        int stepX = Math.Max(1, bitmap.Width / 80);
        int stepY = Math.Max(1, bitmap.Height / 80);
        for (int y = 0; y < bitmap.Height; y += stepY)
            for (int x = 0; x < bitmap.Width; x += stepX)
            {
                var c = bitmap.GetPixel(x, y);
                sum += 0.299 * c.Red + 0.587 * c.Green + 0.114 * c.Blue;
                n++;
            }
        double avg = n > 0 ? sum / n : 128.0;

        // 2. Gain pour viser une luminosité cible, borné puis lissé dans le temps
        _gain = NextGain(_gain, avg);
        float g = (float)_gain;

        // 3. Application du gain (multiplication RGB) via matrice de couleur
        var matrix = new float[]
        {
            g, 0, 0, 0, 0,
            0, g, 0, 0, 0,
            0, 0, g, 0, 0,
            0, 0, 0, 1, 0,
        };
        var info = new SKImageInfo(bitmap.Width, bitmap.Height, SKColorType.Bgra8888, SKAlphaType.Opaque);
        using var output = new SKBitmap(info);
        using (var canvas = new SKCanvas(output))
        using (var paint = new SKPaint { ColorFilter = SKColorFilter.CreateColorMatrix(matrix) })
        {
            canvas.DrawBitmap(bitmap, 0, 0, paint);
        }

        // 4. Vers un BitmapSource WPF figé (thread-safe)
        var bmp = BitmapSource.Create(
            info.Width, info.Height, 96, 96,
            System.Windows.Media.PixelFormats.Bgra32, null,
            output.GetPixels(), output.RowBytes * info.Height, output.RowBytes);
        bmp.Freeze();
        return bmp;
    }
}
