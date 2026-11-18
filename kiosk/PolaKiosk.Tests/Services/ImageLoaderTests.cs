using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class ImageLoaderTests
{
    [Theory]
    // Photo 6000×4000 dans un écran 1920×1080
    [InlineData(6000, 4000, 1920, 1080, false, 1620)] // Uniform : limité par la hauteur (1080/4000)
    [InlineData(6000, 4000, 1920, 1080, true,  1920)] // UniformToFill : limité par la largeur
    [InlineData(6000, 4000, 240, int.MaxValue, false, 240)] // vignette
    public void DecodeWidth_fits_image_to_box(int srcW, int srcH, int boxW, int boxH, bool fill, int expected)
    {
        ImageLoader.DecodeWidth(srcW, srcH, boxW, boxH, fill).Should().Be(expected);
    }

    [Theory]
    [InlineData(800, 600, 1920, 1080, false)] // plus petite que l'écran : jamais agrandie
    [InlineData(0, 600, 1920, 1080, true)]    // dimensions inconnues
    public void DecodeWidth_keeps_original_size_when_no_reduction(int srcW, int srcH, int boxW, int boxH, bool fill)
    {
        ImageLoader.DecodeWidth(srcW, srcH, boxW, boxH, fill).Should().BeNull();
    }

    [Fact]
    public void Load_returns_null_for_missing_file()
    {
        ImageLoader.LoadThumbnail(@"C:\nexistepas\photo.jpg", 240).Should().BeNull();
    }

    [Fact]
    public void FromBytes_decodes_at_the_requested_width_and_freezes()
    {
        var qr = QrCodeRenderer.Render("https://exemple.fr/g/ABC123", 10);
        var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
        encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(qr));
        using var png = new MemoryStream();
        encoder.Save(png);

        var image = ImageLoader.FromBytes(png.ToArray(), 100);

        image.PixelWidth.Should().Be(100);
        image.IsFrozen.Should().BeTrue();
    }

    [Fact]
    public void Qr_code_size_follows_the_pixels_per_module()
    {
        var small = QrCodeRenderer.Render("https://exemple.fr/g/ABC123", QrCodeRenderer.SharePixelsPerModule);
        var large = QrCodeRenderer.Render("https://exemple.fr/g/ABC123", QrCodeRenderer.PairingPixelsPerModule);

        small.IsFrozen.Should().BeTrue();
        large.PixelWidth.Should().Be(small.PixelWidth * 2);
    }
}
