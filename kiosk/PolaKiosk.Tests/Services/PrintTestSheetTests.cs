using System.Drawing;
using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-433 : feuille de test du décalage, 10x15 portrait à 300 dpi.
public sealed class PrintTestSheetTests : IDisposable
{
    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    [Fact]
    public void Render_writes_a_portrait_4x6_png_with_marks_from_the_edges()
    {
        var path = System.IO.Path.Combine(_dir.Path, "feuille.png");

        PrintTestSheet.Render(path, new PrintAdjustment { OffsetXMm = 1 });

        File.Exists(path).Should().BeTrue();
        File.Exists(path + ".tmp").Should().BeFalse();
        using var bitmap = new Bitmap(path);
        bitmap.Width.Should().Be(PrintTestSheet.Width);
        bitmap.Height.Should().Be(PrintTestSheet.Height);

        // Bord gris dans le premier millimètre, cadre noir à 1 mm, cadre rouge à 2 mm (au milieu des côtés).
        var middle = PrintTestSheet.Height / 2;
        bitmap.GetPixel(2, middle).ToArgb().Should().Be(Color.FromArgb(200, 200, 200).ToArgb());
        bitmap.GetPixel(PrintTestSheet.MarkInset(1), middle).R.Should().BeLessThan(60);
        var red = bitmap.GetPixel(PrintTestSheet.Width - PrintTestSheet.MarkInset(2), middle);
        red.R.Should().BeGreaterThan(150);
        red.G.Should().BeLessThan(80);
    }

    [Fact]
    public void Marks_are_one_millimetre_apart_at_300_dpi()
    {
        PrintTestSheet.MarkInset(1).Should().Be(12);
        PrintTestSheet.MarkInset(6).Should().Be(71);
    }
}
