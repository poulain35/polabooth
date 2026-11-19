using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using SkiaSharp;

namespace PolaKiosk.Tests.Services;

/// <summary>Assemblage réel (SkiaSharp) : modèle sans zone, décor, noms de fichiers.</summary>
public class CompositeOutputTests
{
    private const int Dpi = 30; // petites images : test rapide
    private static readonly SKColor PhotoColor = new(220, 30, 30);
    private static readonly SKColor DecorColor = new(30, 30, 220);

    [Fact]
    public async Task CreateCompositeAsync_without_zones_prints_the_photo_full_frame_and_logs_it()
    {
        using var dir = new TempDir();
        var photo = WriteImage(dir.File("photo.jpg"), 90, 135, PhotoColor, SKEncodedImageFormat.Jpeg);
        var template = WriteImage(dir.File("template.png"), 40, 60, DecorColor, SKEncodedImageFormat.Png);
        var log = new Mock<IKioskLogService>();
        var svc = new CompositeService(log.Object);

        var path = await svc.CreateCompositeAsync([photo], template, [], "portrait", dir.File("out"), Dpi);

        using var result = SKBitmap.Decode(path);
        // Décor opaque sans zone : il masquerait la photo, il est donc écarté.
        IsClose(result.GetPixel(result.Width / 2, result.Height / 2), PhotoColor).Should().BeTrue();
        IsClose(result.GetPixel(2, 2), PhotoColor).Should().BeTrue();
        log.Verify(l => l.LogWarningAsync("composite", It.Is<string>(m => m.Contains("plein cadre"))), Times.Once);
    }

    [Fact]
    public async Task CreateCompositeAsync_without_zones_keeps_a_template_with_transparent_area()
    {
        using var dir = new TempDir();
        var photo = WriteImage(dir.File("photo.jpg"), 90, 135, PhotoColor, SKEncodedImageFormat.Jpeg);
        // Décor : bandeau opaque en haut, reste transparent (cadre classique).
        var template = dir.File("template.png");
        using (var bmp = new SKBitmap(new SKImageInfo(40, 60, SKColorType.Rgba8888, SKAlphaType.Premul)))
        {
            bmp.Erase(SKColors.Transparent);
            using (var canvas = new SKCanvas(bmp))
            using (var paint = new SKPaint { Color = DecorColor })
                canvas.DrawRect(0, 0, 40, 10, paint);
            Save(bmp, template, SKEncodedImageFormat.Png);
        }
        var svc = new CompositeService();

        var path = await svc.CreateCompositeAsync([photo], template, [], "portrait", dir.File("out"), Dpi);

        using var result = SKBitmap.Decode(path);
        IsClose(result.GetPixel(result.Width / 2, result.Height / 2), PhotoColor).Should().BeTrue();
        IsClose(result.GetPixel(result.Width / 2, 2), DecorColor).Should().BeTrue();
    }

    [Fact]
    public async Task CreateCompositeAsync_by_default_keeps_the_size_of_the_saas_png()
    {
        // Montage à la taille du PNG du cadre photo (2400×3600) : ni le cadre ni la photo ne perdent
        // en définition avant le pilote de l'imprimante.
        using var dir = new TempDir();
        var photo = WriteImage(dir.File("photo.jpg"), 300, 200, PhotoColor, SKEncodedImageFormat.Jpeg);
        string template = dir.File("template.png");
        using (var decor = new SKBitmap(2400, 3600))
        {
            decor.Erase(SKColors.Transparent);
            // Filet d'un pixel du décor : il doit rester net, au même endroit.
            for (int y = 0; y < 3600; y++) decor.SetPixel(1200, y, DecorColor);
            Save(decor, template, SKEncodedImageFormat.Png);
        }
        var svc = new CompositeService();

        var path = await svc.CreateCompositeAsync([photo], template, [new PhotoZone(0, 0, 400, 600)], "portrait", dir.File("out"));

        using var result = SKBitmap.Decode(path);
        (result.Width, result.Height).Should().Be((2400, 3600));
        IsClose(result.GetPixel(1200, 1800), DecorColor).Should().BeTrue();
        IsClose(result.GetPixel(1203, 1800), PhotoColor).Should().BeTrue();
    }

    [Fact]
    public async Task CreateCompositeAsync_gives_each_composite_its_own_file()
    {
        using var dir = new TempDir();
        var photo = WriteImage(dir.File("photo.jpg"), 90, 135, PhotoColor, SKEncodedImageFormat.Jpeg);
        var zones = new[] { new PhotoZone(0, 0, 400, 600) };
        var svc = new CompositeService();

        var first  = await svc.CreateCompositeAsync([photo], "", zones, "portrait", dir.File("out"), Dpi);
        var second = await svc.CreateCompositeAsync([photo], "", zones, "portrait", dir.File("out"), Dpi);

        second.Should().NotBe(first);
        File.Exists(first).Should().BeTrue();
        File.Exists(second).Should().BeTrue();
        Directory.GetFiles(dir.File("out"), "*.tmp").Should().BeEmpty();
    }

    [Fact]
    public async Task CreateCompositeAsync_rotates_the_photo_with_its_zone()
    {
        using var dir = new TempDir();
        var photo = WriteImage(dir.File("photo.jpg"), 90, 135, PhotoColor, SKEncodedImageFormat.Jpeg);
        // Zone 300 × 100 centrée en (200, 300), tournée de 90° : elle couvre x 150–250, y 150–450 (canvas).
        var zones = new[] { new PhotoZone(50, 250, 300, 100, 90) };
        var svc = new CompositeService();

        var path = await svc.CreateCompositeAsync([photo], "", zones, "portrait", dir.File("out"), Dpi);

        using var result = SKBitmap.Decode(path);
        float scale = result.Width / 400f;
        // Dans la zone tournée mais hors du rectangle non tourné : photo.
        IsClose(result.GetPixel((int)(200 * scale), (int)(180 * scale)), PhotoColor).Should().BeTrue();
        // Dans le rectangle non tourné mais hors de la zone tournée : fond blanc.
        IsClose(result.GetPixel((int)(100 * scale), (int)(300 * scale)), SKColors.White).Should().BeTrue();
    }

    [Fact]
    public async Task CreateCompositeAsync_throws_a_clear_error_on_an_unreadable_photo()
    {
        using var dir = new TempDir();
        var photo = dir.File("broken.jpg");
        await File.WriteAllTextAsync(photo, "pas une image", TestContext.Current.CancellationToken);
        var svc = new CompositeService();

        var act = () => svc.CreateCompositeAsync([photo], "", [], "portrait", dir.File("out"), Dpi);

        await act.Should().ThrowAsync<InvalidOperationException>();
    }

    [Fact]
    public void HasTransparentArea_is_false_for_an_opaque_image()
    {
        using var bmp = new SKBitmap(new SKImageInfo(20, 20, SKColorType.Rgba8888, SKAlphaType.Premul));
        bmp.Erase(DecorColor);
        CompositeService.HasTransparentArea(bmp).Should().BeFalse();
    }

    [Fact]
    public void HasTransparentArea_is_true_for_a_frame_with_a_transparent_window()
    {
        using var bmp = new SKBitmap(new SKImageInfo(20, 20, SKColorType.Rgba8888, SKAlphaType.Premul));
        bmp.Erase(DecorColor);
        using (var canvas = new SKCanvas(bmp))
        using (var paint = new SKPaint { Color = SKColors.Transparent, BlendMode = SKBlendMode.Src })
            canvas.DrawRect(4, 4, 12, 12, paint);
        CompositeService.HasTransparentArea(bmp).Should().BeTrue();
    }

    [Fact]
    public void FullFrameZone_covers_the_whole_canvas()
    {
        CompositeService.FullFrameZone("portrait").Should().Be(new PhotoZone(0, 0, 400, 600));
        CompositeService.FullFrameZone("stripV").Should().Be(new PhotoZone(0, 0, 200, 600));
    }

    private static string WriteImage(string path, int w, int h, SKColor color, SKEncodedImageFormat format)
    {
        using var bmp = new SKBitmap(w, h);
        bmp.Erase(color);
        Save(bmp, path, format);
        return path;
    }

    private static void Save(SKBitmap bmp, string path, SKEncodedImageFormat format)
    {
        using var data = bmp.Encode(format, 95);
        File.WriteAllBytes(path, data.ToArray());
    }

    // JPEG : tolérance sur les couleurs
    private static bool IsClose(SKColor actual, SKColor expected) =>
        Math.Abs(actual.Red - expected.Red) < 40
        && Math.Abs(actual.Green - expected.Green) < 40
        && Math.Abs(actual.Blue - expected.Blue) < 40;
}
