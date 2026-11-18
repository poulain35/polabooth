using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// Choix exact du papier (LAB-320). Les listes DNP sont reconstituées d'après les noms connus de ces
/// pilotes (débord compris, 4x6 ≈ 413×615) : les noms réels de la DS620 et de la RX1-HS restent à
/// relever sur les bornes (journal « print » au premier tirage).
/// </summary>
public class PaperSizeChooserTests
{
    private static PaperOption P(string name, int w, int h) => new(name, w, h);

    // Extrait réel de Microsoft Print to PDF (Windows 11, français), dans l'ordre du pilote.
    private static readonly PaperOption[] PrintToPdf =
    [
        P("Lettre US (215,9 x 279,4 mm)", 850, 1100),
        P("A4", 827, 1169),
        P("A5", 583, 827),
        P("Carte postale japonaise", 394, 583),
        P("A6", 413, 583),
        P("Photo 4x 4", 400, 400),
        P(" 10x15in", 1000, 1500),
        P(" 98x148mm", 386, 583),
        P("North America 3x 5", 300, 500),
        P("North America 4x 6", 400, 600),
        P("North America 5x 7", 500, 700),
    ];

    private static readonly PaperOption[] DnpDs620 =
    [
        P("(6x8) x2", 615, 816),
        P("(4x6) x2", 615, 816),
        P("(2x6) x2", 413, 615),
        P("(3.5x5)", 362, 512),
        P("(5x7)", 512, 715),
        P("(4x6)", 413, 615),
        P("6x8", 615, 816),
        P("(6x9)", 615, 916),
    ];

    private static readonly PaperOption[] DnpRx1Hs =
    [
        P("PC 6x8", 615, 816),
        P("PC 4x6 x2", 615, 816),
        P("PC 2x6 x2", 207, 615),
        P("PC 4x6", 413, 615),
        P("PC 6x4", 615, 413),
    ];

    [Fact]
    public void Print_to_pdf_takes_north_america_4x6_and_never_10x15_inches()
    {
        var choice = PaperSizeChooser.Choose("4x6", PrintToPdf);

        choice!.Option.Name.Should().Be("North America 4x 6");
        choice.Match.Should().Be(PaperMatch.Dimensions);
    }

    [Fact]
    public void Print_to_pdf_has_no_strip_paper()
        => PaperSizeChooser.Choose("2x6", PrintToPdf).Should().BeNull();

    [Fact]
    public void Ds620_4x6_is_the_single_sheet_not_the_doubled_one()
    {
        var choice = PaperSizeChooser.Choose("4x6", DnpDs620);

        choice!.Option.Name.Should().Be("(4x6)");
        choice.Index.Should().Be(5);
        choice.Match.Should().Be(PaperMatch.Name);
    }

    [Fact]
    public void Ds620_strip_on_a_4x6_sheet_is_refused()
    {
        // « (2x6) x2 » annoncé en 4x6 : le pilote attend deux bandes côte à côte, une bande seule
        // serait agrandie et rognée. Ni bande ni 10×15.
        PaperSizeChooser.Choose("2x6", DnpDs620).Should().BeNull();
        PaperSizeChooser.Choose("4x6", [P("(2x6) x2", 413, 615)]).Should().BeNull();
    }

    [Fact]
    public void Rx1hs_4x6_by_name_and_strip_as_doubled_strip_page()
    {
        PaperSizeChooser.Choose("4x6", DnpRx1Hs)!.Option.Name.Should().Be("PC 4x6");

        var strip = PaperSizeChooser.Choose("2x6", DnpRx1Hs);
        strip!.Option.Name.Should().Be("PC 2x6 x2");
        strip.Match.Should().Be(PaperMatch.MultiUp);
    }

    [Fact]
    public void A_single_strip_beats_the_doubled_strip()
    {
        var choice = PaperSizeChooser.Choose("2x6", [P("(2x6) x2", 207, 615), P("(2x6)", 207, 615)]);

        choice!.Option.Name.Should().Be("(2x6)");
        choice.Match.Should().Be(PaperMatch.Name);
    }

    [Theory]
    [InlineData("10x15in", 1000, 1500)]
    [InlineData("(4x6) x2", 615, 816)]
    [InlineData("(4x6) x2", 400, 600)]
    [InlineData("6x8", 600, 800)]
    [InlineData("4x6 2inch cut", 400, 600)]
    [InlineData("A6", 413, 583)]
    [InlineData("Carte postale japonaise", 394, 583)]
    public void Traps_are_never_taken_for_4x6(string name, int w, int h)
        => PaperSizeChooser.Choose("4x6", [P(name, w, h)]).Should().BeNull();

    [Theory]
    [InlineData("4x6", 400, 600)]
    [InlineData("4 x 6", 400, 600)]
    [InlineData("4\" x 6\"", 400, 600)]
    [InlineData("6x4", 600, 400)]
    [InlineData("10x15", 394, 591)]
    [InlineData("10 x 15 cm", 394, 591)]
    [InlineData("PC_4x6", 413, 615)]
    [InlineData("Carte post 4x6", 400, 600)]
    [InlineData("Photo 10×15", 394, 591)]
    public void Real_4x6_papers_are_found(string name, int w, int h)
        => PaperSizeChooser.Choose("4x6", [P("A4", 827, 1169), P(name, w, h)])!.Index.Should().Be(1);

    [Theory]
    [InlineData("2x6", 200, 600)]
    [InlineData("6x2", 600, 200)]
    [InlineData("5x15", 197, 591)]
    [InlineData("(2x6)", 207, 615)]
    [InlineData("Bande photo", 200, 600)]
    public void Real_strip_papers_are_found(string name, int w, int h)
        => PaperSizeChooser.Choose("2x6", [P("4x6", 400, 600), P(name, w, h)])!.Index.Should().Be(1);

    [Fact]
    public void An_exact_name_with_the_wrong_size_is_not_taken()
        // Un « 2x6 » qui est en réalité une planche 4x6 : refusé, la bande serait rognée.
        => PaperSizeChooser.Choose("2x6", [P("2x6", 400, 600)]).Should().BeNull();

    [Fact]
    public void Name_order_wins_over_driver_order()
        => PaperSizeChooser.Choose("4x6", [P("10x15", 394, 591), P("4x6", 400, 600)])!.Option.Name.Should().Be("4x6");

    [Fact]
    public void Closest_dimensions_win()
        => PaperSizeChooser.Choose("4x6", [P("Photo L", 394, 591), P("Photo", 400, 600)])!.Option.Name.Should().Be("Photo");

    [Fact]
    public void Unknown_format_or_empty_list_gives_nothing()
    {
        PaperSizeChooser.Choose("portrait", PrintToPdf).Should().BeNull();
        PaperSizeChooser.Choose("4x6", []).Should().BeNull();
        PaperSizeChooser.FallbackSize("4x6").Should().Be((400, 600));
        PaperSizeChooser.FallbackSize("2x6").Should().Be((200, 600));
        PaperSizeChooser.FallbackSize("portrait").Should().BeNull();
    }

    [Theory]
    [InlineData(" 10x15in", "10x15in")]
    [InlineData("(4x6) x2", "4x6x2")]
    [InlineData("PC_4x6", "pc4x6")]
    [InlineData("4\" × 6\"", "4x6")]
    [InlineData("4 x 6 inch", "4x6in")]
    public void Names_are_normalized(string name, string expected)
        => PaperSizeChooser.Normalize(name).Should().Be(expected);

    [Theory]
    [InlineData(1200, 1800, 400, 600, false)]  // portrait sur portrait
    [InlineData(1800, 1200, 400, 600, true)]   // paysage sur portrait
    [InlineData(1200, 1800, 600, 400, true)]   // portrait sur « 6x4 »
    [InlineData(1800, 600, 200, 600, true)]    // bande horizontale sur bande
    [InlineData(1200, 1200, 400, 600, false)]  // carré : rien à tourner
    public void Page_orientation_follows_the_composite(int iw, int ih, int pw, int ph, bool landscape)
        => PaperSizeChooser.NeedsLandscape(iw, ih, pw, ph).Should().Be(landscape);

    [Fact]
    public void Driver_list_is_described_with_sizes()
    {
        var lines = PaperSizeChooser.Describe("DNP DS620", DnpDs620);

        lines.Should().ContainSingle();
        lines[0].Should().StartWith("Formats de papier du pilote « DNP DS620 » (8, centièmes de pouce) : ")
            .And.Contain("« (4x6) » 413×615 ; « 6x8 » 615×816");
    }

    [Fact]
    public void Long_driver_list_is_split_under_the_log_limit()
    {
        var many = Enumerable.Range(0, 120).Select(i => P($"Format numéro {i}", 400 + i, 600 + i)).ToList();

        var lines = PaperSizeChooser.Describe("Microsoft Print to PDF", many);

        lines.Should().HaveCountGreaterThan(1).And.OnlyContain(l => l.Length <= 1900);
        lines[0].Should().Contain($"[1/{lines.Count}]");
        string.Join(" ", lines).Should().Contain("« Format numéro 0 » 400×600").And.Contain("« Format numéro 119 » 519×719");
    }

    [Fact]
    public void Empty_driver_list_is_said()
        => PaperSizeChooser.Describe("X", []).Should().Equal("Formats de papier du pilote « X » (0, centièmes de pouce) : aucun.");
}
