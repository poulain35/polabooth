using System.IO;
using SkiaSharp;

namespace PolaKiosk.Services;

/// <summary>
/// Vignette d'un montage pour la galerie : <c>composites\thumbs\{même nom}</c>, JPEG de
/// <see cref="Width"/> px de large. Créée juste après le montage ; une vignette absente ou plus
/// ancienne que son montage (effet réappliqué sous le même nom) est recréée à la demande.
/// </summary>
public static class CompositeThumbnail
{
    public const int Width = 320;
    public const string FolderName = "thumbs";
    private const int JpegQuality = 80;

    private static readonly SKSamplingOptions Sampling = new(SKFilterMode.Linear, SKMipmapMode.Linear);

    public static string PathFor(string compositePath)
        => Path.Combine(Path.GetDirectoryName(compositePath)!, FolderName, Path.GetFileName(compositePath));

    /// <summary>Écrit la vignette depuis le montage déjà en mémoire (pas de second décodage).</summary>
    public static string Write(SKBitmap composite, string compositePath)
    {
        var thumbPath = PathFor(compositePath);
        using var resized = composite.Width > Width
            ? composite.Resize(new SKImageInfo(Width, HeightFor(composite.Width, composite.Height)), Sampling)
              ?? throw new InvalidOperationException("Redimensionnement de la vignette impossible.")
            : null;

        using var image = SKImage.FromBitmap(resized ?? composite);
        using var data = image.Encode(SKEncodedImageFormat.Jpeg, JpegQuality)
            ?? throw new InvalidOperationException("Encodage JPEG de la vignette impossible.");
        AtomicFile.Write(thumbPath, data.SaveTo);
        return thumbPath;
    }

    internal static int HeightFor(int width, int height)
        => Math.Max(1, (int)Math.Round(height * (double)Width / width));

    /// <summary>
    /// Chemin d'une vignette à jour du montage, créée si elle manque (gardée ensuite).
    /// Null si le montage est illisible. Ne lève jamais.
    /// </summary>
    public static string? Ensure(string compositePath)
    {
        try
        {
            if (!File.Exists(compositePath)) return null;

            var thumbPath = PathFor(compositePath);
            if (File.Exists(thumbPath)
                && File.GetLastWriteTimeUtc(thumbPath) >= File.GetLastWriteTimeUtc(compositePath))
                return thumbPath;

            using var composite = SKBitmap.Decode(compositePath);
            return composite == null ? null : Write(composite, compositePath);
        }
        catch { return null; }
    }
}
