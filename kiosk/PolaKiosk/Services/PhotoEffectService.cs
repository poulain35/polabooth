using System.IO;
using SkiaSharp;

namespace PolaKiosk.Services;

public enum PhotoEffect
{
    None,
    BlackAndWhite,
    Sepia,
    Vintage,
    Vignette,
    Bright,
}

public static class PhotoEffectService
{
    public static readonly Dictionary<PhotoEffect, string> Labels = new()
    {
        [PhotoEffect.None]         = "Original",
        [PhotoEffect.BlackAndWhite] = "Noir & blanc",
        [PhotoEffect.Sepia]        = "Sépia",
        [PhotoEffect.Vintage]      = "Vintage",
        [PhotoEffect.Vignette]     = "Vignette",
        [PhotoEffect.Bright]       = "Lumineux",
    };

    public static PhotoEffect FromString(string key) => key?.ToLower() switch
    {
        "bw" or "blackandwhite" or "noir" => PhotoEffect.BlackAndWhite,
        "sepia"                           => PhotoEffect.Sepia,
        "vintage"                         => PhotoEffect.Vintage,
        "vignette"                        => PhotoEffect.Vignette,
        "bright" or "lumineux"            => PhotoEffect.Bright,
        _                                 => PhotoEffect.None,
    };

    public static string ToString(PhotoEffect effect) => effect switch
    {
        PhotoEffect.BlackAndWhite => "bw",
        PhotoEffect.Sepia        => "sepia",
        PhotoEffect.Vintage      => "vintage",
        PhotoEffect.Vignette     => "vignette",
        PhotoEffect.Bright       => "bright",
        _                        => "none",
    };

    /// <summary>Applique un effet sur une image et retourne les bytes JPEG.</summary>
    public static byte[] ApplyEffect(string imagePath, PhotoEffect effect)
    {
        using var original = SKBitmap.Decode(imagePath)
            ?? throw new InvalidOperationException($"Impossible de lire l'image : {imagePath}");
        return ApplyEffectToBitmap(original, effect);
    }

    /// <summary>Applique un effet sur des bytes JPEG et retourne les bytes résultants.</summary>
    public static byte[] ApplyEffect(byte[] jpegBytes, PhotoEffect effect)
    {
        using var original = SKBitmap.Decode(jpegBytes)
            ?? throw new InvalidOperationException("Image illisible.");
        return ApplyEffectToBitmap(original, effect);
    }

    /// <summary>Applique un effet et sauvegarde dans outputPath. Retourne le chemin.</summary>
    public static string ApplyAndSave(string inputPath, PhotoEffect effect, string outputDir)
    {
        var fileName   = $"{Path.GetFileNameWithoutExtension(inputPath)}_{ToString(effect)}.jpg";
        var outputPath = Path.Combine(outputDir, fileName);

        AtomicFile.WriteAllBytes(outputPath, ApplyEffect(inputPath, effect));
        CompositeThumbnail.Ensure(outputPath); // nouveau montage dans la galerie
        return outputPath;
    }

    private static byte[] ApplyEffectToBitmap(SKBitmap bitmap, PhotoEffect effect)
    {
        using var surface = SKSurface.Create(new SKImageInfo(bitmap.Width, bitmap.Height))
            ?? throw new InvalidOperationException("Surface de dessin indisponible.");
        var canvas = surface.Canvas;

        using var filter = ColorMatrix(effect) is { } matrix ? SKColorFilter.CreateColorMatrix(matrix) : null;
        using (var paint = new SKPaint { ColorFilter = filter })
            canvas.DrawBitmap(bitmap, 0, 0, paint);

        if (effect == PhotoEffect.Vignette)
            DrawVignette(canvas, bitmap.Width, bitmap.Height);

        using var image = surface.Snapshot();
        using var data  = KioskJpeg.Encode(image, CompositeService.CompositeJpegQuality)
            ?? throw new InvalidOperationException("Encodage JPEG impossible.");
        return data.ToArray();
    }

    private static float[]? ColorMatrix(PhotoEffect effect) => effect switch
    {
        PhotoEffect.BlackAndWhite => BwMatrix(),
        PhotoEffect.Sepia         => SepiaMatrix(),
        PhotoEffect.Vintage       => VintageMatrix(),
        PhotoEffect.Bright        => BrightMatrix(),
        _                         => null,
    };

    private static void DrawVignette(SKCanvas canvas, int w, int h)
    {
        var center = new SKPoint(w / 2f, h / 2f);
        var radius = Math.Max(w, h) * 0.75f;
        using var shader = SKShader.CreateRadialGradient(
            center, radius,
            new[] { SKColors.Transparent, new SKColor(0, 0, 0, 180) },
            new[] { 0.4f, 1.0f },
            SKShaderTileMode.Clamp);
        using var paint = new SKPaint { Shader = shader };
        canvas.DrawRect(SKRect.Create(w, h), paint);
    }

    // ── Matrices de couleur ───────────────────────────────────────────────────

    private static float[] BwMatrix() =>
    [
        0.299f, 0.587f, 0.114f, 0, 0,
        0.299f, 0.587f, 0.114f, 0, 0,
        0.299f, 0.587f, 0.114f, 0, 0,
        0,      0,      0,      1, 0
    ];

    private static float[] SepiaMatrix() =>
    [
        0.393f, 0.769f, 0.189f, 0, 0,
        0.349f, 0.686f, 0.168f, 0, 0,
        0.272f, 0.534f, 0.131f, 0, 0,
        0,      0,      0,      1, 0
    ];

    private static float[] VintageMatrix() =>
    [
        0.9f, 0.1f,  0.0f, 0, -10,
        0.0f, 0.85f, 0.1f, 0, -5,
        0.1f, 0.1f,  0.8f, 0,  0,
        0,    0,     0,    1,  0
    ];

    private static float[] BrightMatrix() =>
    [
        1.2f, 0,    0,    0, 20,
        0,    1.2f, 0,    0, 20,
        0,    0,    1.2f, 0, 20,
        0,    0,    0,    1,  0
    ];
}
