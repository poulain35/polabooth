using FluentAssertions;
using Newtonsoft.Json.Linq;
using PolaKiosk.Services;
using SkiaSharp;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// Montage du tirage sur les cas de test communs au SaaS et à la borne
/// (docs/specs/fixtures/kiosk-composite-cases.json, LAB-306) : l'aperçu du SaaS
/// (saas/src/lib/kioskComposite.js) doit placer les photos exactement comme <see cref="CompositeService"/>.
/// </summary>
public class CompositeSharedCasesTests
{
    private const float Px = 0.01f;
    private const float ScaleTolerance = 1e-5f;

    private static readonly Lazy<JObject> Fixture = new(() => SharedCases.Load("kiosk-composite-cases.json"));

    private static IEnumerable<JObject> Cases => Fixture.Value["cases"]!.Children<JObject>();

    private static JObject Case(string name) => Cases.Single(c => (string)c["name"]! == name);

    public static TheoryData<string> CaseNames()
    {
        var data = new TheoryData<string>();
        foreach (var c in Cases) data.Add((string)c["name"]!);
        return data;
    }

    private static List<PhotoZone> Zones(JObject c) => c["zones"]!.Children<JObject>()
        .Select(z => new PhotoZone((float)z["left"]!, (float)z["top"]!, (float)z["width"]!, (float)z["height"]!, (float)z["angle"]!))
        .ToList();

    private static List<(int W, int H)> Photos(JObject c) => c["photos"]!.Children<JObject>()
        .Select(p => ((int)p["width"]!, (int)p["height"]!))
        .ToList();

    private static float[] Floats(JToken token) => token.Select(t => (float)t).ToArray();

    [Fact]
    public void The_shared_cases_file_is_found_and_not_empty()
        => Cases.Should().HaveCountGreaterThanOrEqualTo(6);

    [Fact]
    public void Print_sizes_match_the_shared_file()
    {
        foreach (var (format, size) in Fixture.Value["print_sizes"]!.Children<JProperty>().Select(p => (p.Name, p.Value)))
            CompositeService.PrintPixelSize(format, (int)size["dpi"]!).Should().Be(((int)size["w"]!, (int)size["h"]!), format);
    }

    /// <summary>
    /// Placement calculé avec les fonctions de <see cref="CompositeService"/> et le même enchaînement
    /// que la boucle de <c>CreateCompositeAsync</c> (zone plein cadre sans zone, dernière photo répétée,
    /// rectangle = zone × échelle, cover, rotation autour du centre). Le test suivant vérifie sur
    /// l'image produite que cette boucle place bien chaque photo là.
    /// </summary>
    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Every_shared_case_gives_the_expected_placements(string name)
    {
        var c = Case(name);
        var expected = (JObject)c["expected"]!;
        string format = (string)c["format"]!;
        int dpi = (int)c["dpi"]!;
        var zones = Zones(c);
        var photos = Photos(c);

        CompositeService.PrintPixelSize(format, dpi).Should().Be(((int)expected["print"]!["w"]!, (int)expected["print"]!["h"]!));
        float scale = CompositeService.CanvasToPrintScale(format, dpi);
        scale.Should().BeApproximately((float)expected["scale"]!, ScaleTolerance);

        bool fullFrame = zones.Count == 0;
        fullFrame.Should().Be((bool)expected["full_frame"]!);
        IReadOnlyList<PhotoZone> drawZones = fullFrame ? [CompositeService.FullFrameZone(format)] : zones;

        var placements = expected["placements"]!.Children<JObject>().ToList();
        drawZones.Should().HaveCount(placements.Count);
        for (int i = 0; i < drawZones.Count; i++)
        {
            var zone = drawZones[i];
            var want = placements[i];
            int photoIndex = Math.Min(i, photos.Count - 1);
            var dest = new SKRect(zone.Left * scale, zone.Top * scale,
                (zone.Left + zone.Width) * scale, (zone.Top + zone.Height) * scale);
            var (l, t, r, b) = CompositeService.CoverSourceRect(photos[photoIndex].W, photos[photoIndex].H, dest.Width, dest.Height);

            photoIndex.Should().Be((int)want["photo_index"]!, $"zone {i}");
            ShouldMatch([dest.Left, dest.Top, dest.Right, dest.Bottom], Floats(want["dest"]!), $"dest de la zone {i}");
            ShouldMatch([l, t, r, b], Floats(want["source"]!), $"source de la zone {i}");
            zone.Angle.Should().BeApproximately((float)want["angle"]!, Px, $"angle de la zone {i}");
            ShouldMatch([dest.MidX, dest.MidY], Floats(want["pivot"]!), $"pivot de la zone {i}");
        }
    }

    // Couleur unie par photo, dans l'ordre des prises.
    private static readonly SKColor[] PhotoColors = [new(220, 30, 30), new(30, 30, 220), new(30, 180, 30)];

    /// <summary>
    /// Montage réel par <c>CreateCompositeAsync</c> (sans décor) : chaque zone attendue montre la bonne
    /// photo (couleur de son rang) à l'intérieur de son rectangle tourné, et le fond blanc juste à
    /// l'extérieur. Photos 20 fois plus petites que dans les cas (mêmes proportions) : le test reste rapide,
    /// et la taille de la photo ne change pas le rectangle de destination.
    /// </summary>
    [Theory]
    [MemberData(nameof(CaseNames))]
    public async Task Every_shared_case_is_drawn_where_expected_by_CreateCompositeAsync(string name)
    {
        var c = Case(name);
        var expected = (JObject)c["expected"]!;
        using var dir = new TempDir();
        var photoPaths = Photos(c).Select((p, i) =>
        {
            var path = dir.File($"photo{i}.png");
            using var bmp = new SKBitmap(p.W / 20, p.H / 20);
            bmp.Erase(PhotoColors[i]);
            using var data = bmp.Encode(SKEncodedImageFormat.Png, 100);
            File.WriteAllBytes(path, data.ToArray());
            return path;
        }).ToList();
        var svc = new CompositeService();

        var output = await svc.CreateCompositeAsync(photoPaths, "", Zones(c), (string)c["format"]!, dir.File("out"), (int)c["dpi"]!);

        using var result = SKBitmap.Decode(output);
        result.Width.Should().Be((int)expected["print"]!["w"]!);
        result.Height.Should().Be((int)expected["print"]!["h"]!);

        foreach (var (want, i) in expected["placements"]!.Children<JObject>().Select((p, i) => (p, i)))
        {
            var d = Floats(want["dest"]!);
            var pivot = Floats(want["pivot"]!);
            double angle = (double)want["angle"]! * Math.PI / 180;
            double halfW = (d[2] - d[0]) / 2, halfH = (d[3] - d[1]) / 2;
            var color = PhotoColors[(int)want["photo_index"]!];
            const double inset = 6;

            // Point du repère de la zone (origine au centre) → pixel du tirage, rotation horaire comme Skia.
            (int X, int Y) At(double x, double y) => (
                (int)Math.Floor(pivot[0] + x * Math.Cos(angle) - y * Math.Sin(angle)),
                (int)Math.Floor(pivot[1] + x * Math.Sin(angle) + y * Math.Cos(angle)));

            // Une zone tournée peut déborder du tirage : seuls les points sur le tirage sont lus.
            bool OnPrint((int X, int Y) p) => p.X >= 0 && p.Y >= 0 && p.X < result.Width && p.Y < result.Height;

            var inside = new[]
            {
                At(0, 0),
                At(-halfW + inset, -halfH + inset), At(halfW - inset, -halfH + inset),
                At(-halfW + inset, halfH - inset), At(halfW - inset, halfH - inset),
            };
            OnPrint(inside[0]).Should().BeTrue($"le centre de la zone {i} est sur le tirage");
            foreach (var (x, y) in inside.Where(OnPrint))
                IsClose(result.GetPixel(x, y), color).Should().BeTrue($"zone {i} : ({x}, {y}) montre la photo {want["photo_index"]}");

            var outside = new[] { At(0, -halfH - inset), At(0, halfH + inset), At(-halfW - inset, 0), At(halfW + inset, 0) };
            foreach (var (x, y) in outside.Where(OnPrint))
                IsClose(result.GetPixel(x, y), SKColors.White).Should().BeTrue($"zone {i} : ({x}, {y}) est hors de la zone");
        }
    }

    private static void ShouldMatch(float[] actual, float[] expected, string because)
    {
        actual.Should().HaveSameCount(expected, because);
        for (int k = 0; k < expected.Length; k++)
            actual[k].Should().BeApproximately(expected[k], Px, $"{because} [{k}]");
    }

    // JPEG : tolérance sur les couleurs.
    private static bool IsClose(SKColor actual, SKColor expected) =>
        Math.Abs(actual.Red - expected.Red) < 40
        && Math.Abs(actual.Green - expected.Green) < 40
        && Math.Abs(actual.Blue - expected.Blue) < 40;
}
