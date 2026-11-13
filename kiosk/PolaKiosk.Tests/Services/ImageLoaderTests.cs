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
}
