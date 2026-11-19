using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Seule table des formats de tirage (LAB-401).</summary>
public class PrintFormatsTests
{
    [Theory]
    [InlineData("portrait", 400, 600, "4x6")]
    [InlineData("landscape", 600, 400, "4x6")]
    [InlineData("stripV", 200, 600, "2x6")]
    [InlineData("stripH", 600, 200, "2x6")]
    public void Known_formats_give_canvas_and_paper(string key, int w, int h, string paper)
    {
        var format = PrintFormats.Get(key);

        (format.CanvasWidth, format.CanvasHeight, format.Paper).Should().Be((w, h, paper));
        PrintService.PaperFormatFromTemplateFormat(key).Should().Be(paper);
    }

    [Theory]
    [InlineData("portrait", 2400, 3600)]
    [InlineData("landscape", 3600, 2400)]
    [InlineData("stripV", 1200, 3600)]
    [InlineData("stripH", 3600, 1200)]
    public void Export_size_matches_the_png_exported_by_the_saas(string key, int w, int h)
    {
        // saas/src/utils/formats.js : exportWidth × exportHeight (canvas × 6).
        var format = PrintFormats.Get(key);
        (format.ExportWidth, format.ExportHeight).Should().Be((w, h));
        CompositeService.ExportPixelSize(key).Should().Be((w, h));
    }

    [Fact]
    public void Unknown_format_falls_back_to_portrait_for_display_only()
    {
        PrintFormats.Find("hexagon").Should().BeNull();
        PrintFormats.FindOrDefault("hexagon").Key.Should().Be("portrait");
        PrintService.PaperFormatFromTemplateFormat("hexagon").Should().Be("4x6");
        ((Action)(() => PrintFormats.Get("hexagon"))).Should().Throw<ArgumentException>();
    }
}
