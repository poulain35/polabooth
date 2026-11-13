using System.IO;
using Newtonsoft.Json.Linq;
using SkiaSharp;

namespace PolaKiosk.Services;

public class CompositeService : ICompositeService
{
    // Mitchell = traduction exacte de l'ancien SKFilterQuality.High (rendu identique au pixel près).
    private static readonly SKSamplingOptions HighQuality = new(SKCubicResampler.Mitchell);

    // Dimensions canvas SaaS par format (largeur × hauteur en px canvas)
    private static readonly Dictionary<string, (int W, int H)> CanvasSizes = new()
    {
        ["portrait"]  = (400, 600),
        ["landscape"] = (600, 400),
        ["stripV"]    = (200, 600),
        ["stripH"]    = (600, 200),
    };

    // Dimensions physiques en mm par format
    private static readonly Dictionary<string, (float WMm, float HMm)> PhysicalSizes = new()
    {
        ["portrait"]  = (100f, 150f),
        ["landscape"] = (150f, 100f),
        ["stripV"]    = (50f,  150f),
        ["stripH"]    = (150f, 50f),
    };

    private readonly IKioskLogService? _log;
    private readonly object _zonesLock = new();
    private (Guid Id, int Length, int Hash, IReadOnlyList<PhotoZone> Zones)? _zonesCache;

    public CompositeService(IKioskLogService? log = null)
    {
        _log = log;
    }

    public Task<IReadOnlyList<PhotoZone>> GetPhotoZonesAsync(Guid templateId, string canvasJson)
    {
        return Task.Run(() =>
        {
            // Empreinte bon marché du canvas_json (plusieurs Mo) : on ne le ré-analyse que s'il a changé.
            int length = canvasJson.Length;
            int hash   = canvasJson.GetHashCode();
            lock (_zonesLock)
            {
                if (_zonesCache is { } c && c.Id == templateId && c.Length == length && c.Hash == hash)
                    return c.Zones;
            }

            IReadOnlyList<PhotoZone> zones = ParsePhotoZones(canvasJson);
            lock (_zonesLock)
                _zonesCache = (templateId, length, hash, zones);
            return zones;
        });
    }

    public Task<string> CreateCompositeAsync(
        IReadOnlyList<string> photoPaths,
        string templatePngPath,
        IReadOnlyList<PhotoZone> zones,
        string format,
        string compositesDirectory,
        int dpi = 300)
    {
        return Task.Run(() =>
        {
            if (photoPaths.Count == 0)
                throw new ArgumentException("Aucune photo à assembler.", nameof(photoPaths));

            // Calcul des dimensions d'impression en pixels + échelle canvas→impression (lèvent si format inconnu)
            var (printW, printH) = PrintPixelSize(format, dpi);
            float scale = CanvasToPrintScale(format, dpi);

            // Modèle sans zone photo : sans repli, le décor serait imprimé sans la photo.
            bool fullFrame = zones.Count == 0;
            if (fullFrame)
                _ = _log?.LogWarningAsync("composite",
                    $"Modèle sans zone photo ({format}) : photo placée en plein cadre.");
            IReadOnlyList<PhotoZone> drawZones = fullFrame ? [FullFrameZone(format)] : zones;

            using var bitmap = new SKBitmap(printW, printH);
            using var cvs = new SKCanvas(bitmap);
            cvs.Clear(SKColors.White);

            // Une photo répétée sur plusieurs zones n'est décodée qu'une fois.
            var decoded = new Dictionary<string, SKImage>();
            try
            {
                // Fallback sur la dernière photo si moins de photos que de zones
                for (int i = 0; i < drawZones.Count; i++)
                {
                    var zone = drawZones[i];
                    var photoPath = photoPaths[Math.Min(i, photoPaths.Count - 1)];
                    if (!decoded.TryGetValue(photoPath, out var photo))
                    {
                        photo = DecodeImage(photoPath);
                        decoded[photoPath] = photo;
                    }

                    var destRect = new SKRect(
                        zone.Left * scale,
                        zone.Top * scale,
                        (zone.Left + zone.Width) * scale,
                        (zone.Top + zone.Height) * scale);

                    var (l, t, r, b) = CoverSourceRect(photo.Width, photo.Height, destRect.Width, destRect.Height);
                    cvs.Save();
                    cvs.RotateDegrees(zone.Angle, destRect.MidX, destRect.MidY);
                    cvs.DrawImage(photo, new SKRect(l, t, r, b), destRect, HighQuality);
                    cvs.Restore();
                }
            }
            finally
            {
                foreach (var photo in decoded.Values) photo.Dispose();
            }

            // Superposition du template par-dessus les photos
            DrawTemplate(cvs, templatePngPath, printW, printH, fullFrame);

            return SaveJpeg(bitmap, compositesDirectory, 85);
        });
    }

    public Task<string> CreateFromSinglePhotoAsync(
        string photoPath,
        string compositesDirectory,
        int maxDimension = 2400,
        int jpegQuality = 85)
    {
        return Task.Run(() =>
        {
            using var src = SKBitmap.Decode(photoPath)
                ?? throw new InvalidOperationException($"Impossible de lire la photo : {photoPath}");

            // Redimensionnement si le côté le plus long dépasse maxDimension (ratio préservé).
            int longest = Math.Max(src.Width, src.Height);
            float f = maxDimension / (float)longest;
            using var resized = maxDimension > 0 && longest > maxDimension
                ? src.Resize(new SKImageInfo(
                    Math.Max(1, (int)Math.Round(src.Width  * f)),
                    Math.Max(1, (int)Math.Round(src.Height * f))), HighQuality)
                : null;

            return SaveJpeg(resized ?? src, compositesDirectory, jpegQuality);
        });
    }

    private void DrawTemplate(SKCanvas cvs, string templatePngPath, int printW, int printH, bool fullFrame)
    {
        if (!File.Exists(templatePngPath)) return;

        using var template = SKBitmap.Decode(templatePngPath);
        if (template == null)
        {
            _ = _log?.LogWarningAsync("composite", $"Décor illisible, montage sans décor : {templatePngPath}");
            return;
        }

        using var scaled = template.Resize(new SKImageInfo(printW, printH), HighQuality);
        if (scaled == null)
        {
            _ = _log?.LogWarningAsync("composite", $"Redimensionnement du décor impossible : {templatePngPath}");
            return;
        }

        // Photo en plein cadre : un décor sans partie transparente la masquerait entièrement.
        if (fullFrame && !HasTransparentArea(scaled))
        {
            _ = _log?.LogWarningAsync("composite", "Décor opaque sans zone photo : photo imprimée sans le décor.");
            return;
        }

        cvs.DrawBitmap(scaled, 0, 0);
    }

    private static SKImage DecodeImage(string path)
    {
        using var bitmap = SKBitmap.Decode(path)
            ?? throw new InvalidOperationException($"Impossible de lire la photo : {path}");
        return SKImage.FromBitmap(bitmap);
    }

    private string SaveJpeg(SKBitmap bitmap, string compositesDirectory, int quality)
    {
        string outputPath;
        using (var image = SKImage.FromBitmap(bitmap))
        using (var data = image.Encode(SKEncodedImageFormat.Jpeg, quality)
            ?? throw new InvalidOperationException("Encodage JPEG du montage impossible."))
        {
            outputPath = Path.Combine(compositesDirectory, UniqueFileName.Create("composite", ".jpg"));
            AtomicFile.Write(outputPath, data.SaveTo);
        }

        // Vignette de la galerie depuis le montage en mémoire. Un échec ne coûte pas le montage :
        // la galerie la recrée à l'affichage.
        try { CompositeThumbnail.Write(bitmap, outputPath); }
        catch (Exception ex)
        {
            _ = _log?.LogWarningAsync("composite", $"Vignette non créée ({Path.GetFileName(outputPath)}) : {ex.Message}");
        }
        return outputPath;
    }

    // ── Helpers de conversion (purs, testables) ──────────────────────────────

    /// <summary>Taille d'impression en pixels pour un format donné à un DPI donné.</summary>
    internal static (int W, int H) PrintPixelSize(string format, int dpi)
    {
        if (!PhysicalSizes.TryGetValue(format, out var physical))
            throw new ArgumentException($"Format inconnu : {format}");
        const float mmPerInch = 25.4f;
        return ((int)(physical.WMm / mmPerInch * dpi), (int)(physical.HMm / mmPerInch * dpi));
    }

    /// <summary>Échelle de conversion coordonnées canvas SaaS → pixels d'impression.</summary>
    internal static float CanvasToPrintScale(string format, int dpi)
    {
        if (!CanvasSizes.TryGetValue(format, out var canvas))
            throw new ArgumentException($"Format inconnu : {format}");
        var (printW, _) = PrintPixelSize(format, dpi);
        return printW / (float)canvas.W;
    }

    /// <summary>Zone couvrant tout le canvas du format (modèle sans zone photo).</summary>
    internal static PhotoZone FullFrameZone(string format)
    {
        if (!CanvasSizes.TryGetValue(format, out var canvas))
            throw new ArgumentException($"Format inconnu : {format}");
        return new PhotoZone(0, 0, canvas.W, canvas.H);
    }

    /// <summary>Vrai si au moins 5 % du décor est transparent (un pixel sur 4 par axe est examiné).</summary>
    internal static bool HasTransparentArea(SKBitmap bitmap)
    {
        if (bitmap.AlphaType == SKAlphaType.Opaque) return false;
        if (bitmap.BytesPerPixel != 4) return true;

        var pixels = bitmap.GetPixelSpan();
        long sampled = 0, transparent = 0;
        for (int y = 0; y < bitmap.Height; y += 4)
        {
            int row = y * bitmap.RowBytes;
            for (int x = 0; x < bitmap.Width; x += 4)
            {
                sampled++;
                // Octet alpha en 4e position, en RGBA comme en BGRA
                if (pixels[row + x * 4 + 3] < 128) transparent++;
            }
        }
        return transparent * 20 >= sampled;
    }

    /// <summary>Rectangle source pour un effet "cover" (remplit la zone sans déformer), en coordonnées brutes.</summary>
    internal static (float L, float T, float R, float B) CoverSourceRect(float srcW, float srcH, float destW, float destH)
    {
        float scale = Math.Max(destW / srcW, destH / srcH);
        float offsetX = (srcW * scale - destW) / 2f / scale;
        float offsetY = (srcH * scale - destH) / 2f / scale;
        return (offsetX, offsetY, offsetX + destW / scale, offsetY + destH / scale);
    }

    /// <summary>
    /// Zones photo du canvas_json dans l'ordre d'empilement, y compris celles rangées dans un groupe
    /// (à toute profondeur). Reproduit la géométrie de Fabric.js 5 : les enfants d'un groupe sont
    /// placés par rapport au centre du groupe, dont la position, l'origine, l'échelle, l'angle et le
    /// miroir s'appliquent. Le SaaS perce le décor avec la même géométrie (saas/src/lib/photoZones.js).
    /// </summary>
    internal static List<PhotoZone> ParsePhotoZones(string canvasJson)
    {
        var zones = new List<PhotoZone>();
        try
        {
            if (JObject.Parse(canvasJson)["objects"] is JArray objects)
                CollectPhotoZones(objects, Affine.Identity, zones);
        }
        catch { /* canvas_json malformé → pas de zones */ }

        return zones;
    }

    private static void CollectPhotoZones(JArray objects, Affine parent, List<PhotoZone> zones)
    {
        foreach (var token in objects)
        {
            if (token is not JObject obj) continue;

            if (Flag(obj, "isPhotoZone"))
                zones.Add(ZoneFromMatrix(parent.Then(OwnMatrix(obj)), Number(obj, "width", 0), Number(obj, "height", 0)));
            else if ((string?)obj["type"] == "group" && obj["objects"] is JArray children)
                CollectPhotoZones(children, parent.Then(OwnMatrix(obj)), zones);
        }
    }

    /// <summary>Matrice propre d'un objet Fabric (sans son groupe), comme <c>calcOwnMatrix</c> de Fabric 5.</summary>
    private static Affine OwnMatrix(JObject o)
    {
        double width  = Number(o, "width", 0),  height = Number(o, "height", 0);
        double scaleX = Number(o, "scaleX", 1), scaleY = Number(o, "scaleY", 1);
        double skewX  = Number(o, "skewX", 0),  skewY  = Number(o, "skewY", 0);
        double angle  = Number(o, "angle", 0) * Math.PI / 180;
        double stroke = Number(o, "strokeWidth", 0);
        bool strokeUniform = Flag(o, "strokeUniform");

        // Boîte englobante (trait compris) qui sert à passer du point d'origine au centre.
        var shape = Affine.Shape(scaleX, scaleY, skewX, skewY, flipX: false, flipY: false);
        double w = strokeUniform ? width : width + stroke;
        double h = strokeUniform ? height : height + stroke;
        double boxW = Math.Abs(shape.A) * w + Math.Abs(shape.C) * h;
        double boxH = Math.Abs(shape.B) * w + Math.Abs(shape.D) * h;
        if (strokeUniform) { boxW += stroke; boxH += stroke; }

        // (left, top) désigne le point d'origine : centre = origine + décalage tourné de l'angle.
        double dx = -OriginOffset(o["originX"], "right")  * boxW;
        double dy = -OriginOffset(o["originY"], "bottom") * boxH;
        double cos = Math.Cos(angle), sin = Math.Sin(angle);
        double cx = Number(o, "left", 0) + dx * cos - dy * sin;
        double cy = Number(o, "top", 0)  + dx * sin + dy * cos;

        return new Affine(1, 0, 0, 1, cx, cy)
            .Then(new Affine(cos, sin, -sin, cos, 0, 0))
            .Then(Affine.Shape(scaleX, scaleY, skewX, skewY, Flag(o, "flipX"), Flag(o, "flipY")));
    }

    /// <summary>
    /// Rectangle de la zone à partir de sa matrice complète (cisaillement ignoré). Un miroir ne
    /// retourne jamais la photo : même rectangle, orientation la plus proche de l'endroit.
    /// </summary>
    private static PhotoZone ZoneFromMatrix(Affine m, double width, double height)
    {
        double a = m.A, b = m.B;
        double det = m.A * m.D - m.B * m.C;
        bool mirrored = det < 0;
        if (mirrored) { a = -a; b = -b; det = -det; }

        double scaleX = Math.Sqrt(a * a + b * b);
        double angle  = Math.Atan2(b, a) * 180 / Math.PI;
        if (mirrored && Math.Abs(angle) > 90) angle += angle > 0 ? -180 : 180;

        double w = width * scaleX;
        double h = scaleX == 0 ? 0 : height * det / scaleX;
        return new PhotoZone((float)(m.E - w / 2), (float)(m.F - h / 2), (float)w, (float)h, (float)angle);
    }

    // Origine Fabric : "left"/"top" = -0.5, "center" = 0, "right"/"bottom" = 0.5, nombre n = n - 0.5.
    private static double OriginOffset(JToken? origin, string end) => origin switch
    {
        JValue { Type: JTokenType.Integer or JTokenType.Float } v => v.Value<double>() - 0.5,
        JValue { Type: JTokenType.String } v when (string?)v == "center" => 0,
        JValue { Type: JTokenType.String } v when (string?)v == end      => 0.5,
        _ => -0.5,
    };

    private static double Number(JObject o, string key, double fallback) =>
        o[key] is JValue { Type: JTokenType.Integer or JTokenType.Float } v ? v.Value<double>() : fallback;

    private static bool Flag(JObject o, string key) =>
        o[key] is JValue { Type: JTokenType.Boolean } v && v.Value<bool>();

    /// <summary>Matrice affine au format Fabric [a, b, c, d, e, f] : x' = a·x + c·y + e, y' = b·x + d·y + f.</summary>
    private readonly record struct Affine(double A, double B, double C, double D, double E, double F)
    {
        public static readonly Affine Identity = new(1, 0, 0, 1, 0, 0);

        /// <summary>this × next (next s'applique en premier), comme <c>multiplyTransformMatrices</c>.</summary>
        public Affine Then(Affine next) => new(
            A * next.A + C * next.B,
            B * next.A + D * next.B,
            A * next.C + C * next.D,
            B * next.C + D * next.D,
            A * next.E + C * next.F + E,
            B * next.E + D * next.F + F);

        /// <summary>Échelle, miroir puis cisaillement, comme <c>calcDimensionsMatrix</c> de Fabric.</summary>
        public static Affine Shape(double scaleX, double scaleY, double skewX, double skewY, bool flipX, bool flipY)
        {
            var m = new Affine(flipX ? -scaleX : scaleX, 0, 0, flipY ? -scaleY : scaleY, 0, 0);
            if (skewX != 0) m = m.Then(new Affine(1, 0, Math.Tan(skewX * Math.PI / 180), 1, 0, 0));
            if (skewY != 0) m = m.Then(new Affine(1, Math.Tan(skewY * Math.PI / 180), 0, 1, 0, 0));
            return m;
        }
    }
}

/// <summary>
/// Zone photo d'un template, en pixels canvas SaaS (transformations Fabric.js déjà appliquées) :
/// rectangle non tourné (coin haut gauche, taille) puis tourné de <paramref name="Angle"/> degrés
/// (sens horaire) autour de son centre.
/// </summary>
public record PhotoZone(float Left, float Top, float Width, float Height, float Angle = 0);
