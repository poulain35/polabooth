using FluentAssertions;
using PolaKiosk.Services;
using SkiaSharp;

namespace PolaKiosk.Tests.Services;

/// <summary>Vignettes de la galerie : composites\thumbs\{même nom}, 320 px de large.</summary>
public class CompositeThumbnailTests
{
    [Fact]
    public async Task CreateCompositeAsync_writes_the_thumbnail_next_to_the_composite()
    {
        using var dir = new TempDir();
        var photo = WriteImage(dir.File("photo.jpg"), 900, 1350);
        var svc = new CompositeService();

        var composite = await svc.CreateCompositeAsync([photo], "", [new PhotoZone(0, 0, 400, 600)],
            "portrait", dir.File("composites"), dpi: 100);

        var thumb = Path.Combine(dir.File("composites"), "thumbs", Path.GetFileName(composite));
        CompositeThumbnail.PathFor(composite).Should().Be(thumb);
        using var full = SKBitmap.Decode(composite);
        using var image = SKBitmap.Decode(thumb);
        full.Width.Should().BeGreaterThan(CompositeThumbnail.Width);
        image.Width.Should().Be(CompositeThumbnail.Width);
        image.Height.Should().Be(CompositeThumbnail.HeightFor(full.Width, full.Height));
        // Galerie : seul le dossier composites est listé, pas les vignettes.
        Directory.GetFiles(dir.File("composites")).Should().Equal(composite);
    }

    [Fact]
    public void Ensure_recreates_a_missing_thumbnail_and_keeps_it()
    {
        using var dir = new TempDir();
        var composite = WriteImage(Path.Combine(dir.Path, "composites", "montage.jpg"), 800, 1200);

        var thumb = CompositeThumbnail.Ensure(composite);

        thumb.Should().Be(CompositeThumbnail.PathFor(composite));
        File.Exists(thumb).Should().BeTrue();
        var written = File.GetLastWriteTimeUtc(thumb!);
        CompositeThumbnail.Ensure(composite).Should().Be(thumb);
        File.GetLastWriteTimeUtc(thumb!).Should().Be(written);
    }

    [Fact]
    public void Ensure_recreates_a_thumbnail_older_than_its_composite()
    {
        using var dir = new TempDir();
        var composite = WriteImage(Path.Combine(dir.Path, "composites", "montage.jpg"), 800, 1200);
        var thumb = CompositeThumbnail.PathFor(composite);
        AtomicFile.WriteAllBytes(thumb, [1, 2, 3]);
        File.SetLastWriteTimeUtc(thumb, File.GetLastWriteTimeUtc(composite).AddMinutes(-1));

        CompositeThumbnail.Ensure(composite).Should().Be(thumb);

        using var image = SKBitmap.Decode(thumb);
        image.Width.Should().Be(CompositeThumbnail.Width);
    }

    [Fact]
    public void Ensure_returns_null_for_a_missing_or_unreadable_composite()
    {
        using var dir = new TempDir();
        CompositeThumbnail.Ensure(dir.File("absent.jpg")).Should().BeNull();

        File.WriteAllText(dir.File("broken.jpg"), "pas une image");
        CompositeThumbnail.Ensure(dir.File("broken.jpg")).Should().BeNull();
    }

    [Fact]
    public void Write_keeps_a_composite_already_narrower_than_a_thumbnail()
    {
        using var dir = new TempDir();
        using var small = new SKBitmap(200, 300);
        small.Erase(SKColors.White);

        var thumb = CompositeThumbnail.Write(small, dir.File("petit.jpg"));

        using var image = SKBitmap.Decode(thumb);
        image.Width.Should().Be(200);
    }

    private static string WriteImage(string path, int w, int h)
    {
        using var bmp = new SKBitmap(w, h);
        bmp.Erase(new SKColor(200, 80, 40));
        using var image = SKImage.FromBitmap(bmp);
        using var data = image.Encode(SKEncodedImageFormat.Jpeg, 90);
        AtomicFile.WriteAllBytes(path, data.ToArray());
        return path;
    }
}
