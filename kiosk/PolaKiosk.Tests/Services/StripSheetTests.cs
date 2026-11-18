using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Bande 5x15 doublée sur une feuille 10x15, coupée au milieu (LAB-334).</summary>
public class StripSheetTests
{
    // Page 4x6 en centièmes de pouce, telle que PrintPageEventArgs la donne.
    private static readonly SheetRect Portrait  = new(0, 0, 400, 600);
    private static readonly SheetRect Landscape = new(0, 0, 600, 400);

    [Fact]
    public void Vertical_strip_sheet_is_two_strips_wide_and_portrait()
        => StripSheet.SheetSize(590, 1771).Should().Be((1180, 1771));

    [Fact]
    public void Horizontal_strip_sheet_is_two_strips_high_and_landscape()
        => StripSheet.SheetSize(1771, 590).Should().Be((1771, 1180));

    [Theory]
    [InlineData(590, 1771, 400, 600, false)]   // stripV sur une page 4x6 en portrait : rien à tourner
    [InlineData(1771, 590, 400, 600, true)]    // stripH : la feuille doublée est couchée, page en paysage
    [InlineData(590, 1771, 413, 615, false)]
    [InlineData(1771, 590, 413, 615, true)]
    public void Sheet_orientation_follows_the_doubled_sheet(int stripW, int stripH, int paperW, int paperH, bool landscape)
    {
        var (w, h) = StripSheet.SheetSize(stripW, stripH);
        PaperSizeChooser.NeedsLandscape(w, h, paperW, paperH).Should().Be(landscape);
    }

    [Fact]
    public void Vertical_strips_are_side_by_side_with_the_cut_exactly_in_the_middle()
    {
        var placement = StripSheet.Place(590, 1771, Portrait);

        placement.CutIsVertical.Should().BeTrue();
        placement.CutAt.Should().Be(200);
        placement.First.Area.Should().Be(new SheetRect(0, 0, 200, 600));
        placement.Second.Area.Should().Be(new SheetRect(200, 0, 200, 600));
    }

    [Fact]
    public void Horizontal_strips_are_one_above_the_other_with_the_cut_exactly_in_the_middle()
    {
        var placement = StripSheet.Place(1771, 590, Landscape);

        placement.CutIsVertical.Should().BeFalse();
        placement.CutAt.Should().Be(200);
        placement.First.Area.Should().Be(new SheetRect(0, 0, 600, 200));
        placement.Second.Area.Should().Be(new SheetRect(0, 200, 600, 200));
    }

    [Fact]
    public void Odd_page_and_offset_still_cut_in_the_middle_without_gap()
    {
        var page = new SheetRect(3, 5, 413, 615);
        var placement = StripSheet.Place(590, 1771, page);

        placement.CutAt.Should().Be(3 + 206.5);
        placement.First.Area.Right.Should().Be(placement.Second.Area.X);
        placement.First.Area.X.Should().Be(page.X);
        placement.Second.Area.Right.Should().Be(page.Right);
        placement.First.Area.Width.Should().Be(placement.Second.Area.Width);
    }

    [Fact]
    public void Each_half_is_filled_without_margin_and_centered()
    {
        var placement = StripSheet.Place(590, 1771, Portrait);

        foreach (var half in new[] { placement.First, placement.Second })
        {
            var image = half.Image;
            image.X.Should().BeLessThanOrEqualTo(half.Area.X + 1e-9);
            image.Y.Should().BeLessThanOrEqualTo(half.Area.Y + 1e-9);
            image.Right.Should().BeGreaterThanOrEqualTo(half.Area.Right - 1e-9);
            image.Bottom.Should().BeGreaterThanOrEqualTo(half.Area.Bottom - 1e-9);
            (image.X + image.Width / 2).Should().BeApproximately(half.Area.X + half.Area.Width / 2, 1e-9);
            (image.Y + image.Height / 2).Should().BeApproximately(half.Area.Y + half.Area.Height / 2, 1e-9);
            (image.Width / image.Height).Should().BeApproximately(590.0 / 1771, 1e-9, "le ratio de la bande est gardé");
        }
    }

    [Fact]
    public void Exact_ratio_strip_fills_its_half_exactly()
    {
        // 600 x 1800 : exactement 1 x 3, comme une demi-page 200 x 600.
        var placement = StripSheet.Place(600, 1800, Portrait);

        placement.First.Image.Should().Be(placement.First.Area);
        placement.Second.Image.Should().Be(placement.Second.Area);
    }
}
