using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-433 : décalage et agrandissement de l'impression, un seul réglage par borne.
public class PrintAdjustTests
{
    private static readonly double OneMm = 100 / 25.4; // en centièmes de pouce

    [Fact]
    public void Normalize_snaps_to_the_step_clamps_and_ignores_unreadable_values()
    {
        PrintAdjust.Normalize(null).Should().Be(PrintAdjust.Zero);
        PrintAdjust.Normalize(new PrintAdjustment { OffsetXMm = 1.3, OffsetYMm = -12, EnlargePercent = 9 })
            .Should().Be(new PrintAdjustment { OffsetXMm = 1.5, OffsetYMm = -5, EnlargePercent = 5 });
        PrintAdjust.Normalize(new PrintAdjustment { OffsetXMm = double.NaN, OffsetYMm = double.PositiveInfinity, EnlargePercent = -2 })
            .Should().Be(PrintAdjust.Zero);
    }

    [Fact]
    public void Steps_move_by_half_a_millimetre_and_stop_at_the_limit()
    {
        var a = PrintAdjust.StepX(null, +1);
        a.OffsetXMm.Should().Be(0.5);
        PrintAdjust.StepY(a, -3).OffsetYMm.Should().Be(-1.5);
        PrintAdjust.StepEnlarge(a, +1).EnlargePercent.Should().Be(0.5);
        PrintAdjust.StepEnlarge(a, -1).EnlargePercent.Should().Be(0);

        var max = new PrintAdjustment { OffsetXMm = 5 };
        PrintAdjust.StepX(max, +1).Should().Be(max);
        PrintAdjust.IsZero(PrintAdjust.StepX(a, -1)).Should().BeTrue();
    }

    [Fact]
    public void Labels_are_in_french()
    {
        PrintAdjust.OffsetXLabel(0).Should().Be("centré");
        PrintAdjust.OffsetXLabel(1.5).Should().Be("1,5 mm vers la droite");
        PrintAdjust.OffsetXLabel(-2).Should().Be("2 mm vers la gauche");
        PrintAdjust.OffsetYLabel(0.5).Should().Be("0,5 mm vers le bas");
        PrintAdjust.OffsetYLabel(-1).Should().Be("1 mm vers le haut");
        PrintAdjust.EnlargeLabel(0).Should().Be("aucun");
        PrintAdjust.EnlargeLabel(2.5).Should().Be("2,5 %");
        PrintAdjust.Summary(new PrintAdjustment { OffsetXMm = -1, EnlargePercent = 1 })
            .Should().Be("Gauche / droite : 1 mm vers la gauche · Haut / bas : centré · Agrandissement : 1 %");
    }

    [Fact]
    public void Portrait_page_on_portrait_paper_keeps_the_offset()
    {
        var page = PrintAdjust.ForPage(new PrintAdjustment { OffsetXMm = 1, OffsetYMm = -2, EnlargePercent = 2 },
            referenceLandscape: false, pageLandscape: false, landscapeAngle: 90);

        page.OffsetX.Should().BeApproximately(OneMm, 1e-9);
        page.OffsetY.Should().BeApproximately(-2 * OneMm, 1e-9);
        page.Scale.Should().BeApproximately(1.02, 1e-9);
        page.IsIdentity.Should().BeFalse();
    }

    [Fact]
    public void Zero_setting_gives_an_identity_page()
        => PrintAdjust.ForPage(null, false, true, 90).IsIdentity.Should().BeTrue();

    [Theory]
    [InlineData(90)]
    [InlineData(270)]
    public void Same_orientation_as_the_reference_keeps_the_offset(int angle)
    {
        // Papier dont le portrait du pilote est en largeur : la photo portrait s'imprime en paysage, comme la page.
        var page = PrintAdjust.ForPage(new PrintAdjustment { OffsetXMm = 1, OffsetYMm = 0.5 },
            referenceLandscape: true, pageLandscape: true, landscapeAngle: angle);

        page.OffsetX.Should().BeApproximately(OneMm, 1e-9);
        page.OffsetY.Should().BeApproximately(0.5 * OneMm, 1e-9);
    }

    [Fact]
    public void Landscape_page_turns_the_offset_at_90_degrees()
    {
        // Paysage à 90° : la page est tournée d'un quart de tour dans le sens inverse des aiguilles d'une montre.
        // « Droite » du papier devient « bas » de la page paysage.
        var right = PrintAdjust.ForPage(new PrintAdjustment { OffsetXMm = 1 }, false, true, 90);
        right.OffsetX.Should().BeApproximately(0, 1e-9);
        right.OffsetY.Should().BeApproximately(OneMm, 1e-9);

        // « Bas » du papier devient « gauche » de la page paysage.
        var down = PrintAdjust.ForPage(new PrintAdjustment { OffsetYMm = 1 }, false, true, 90);
        down.OffsetX.Should().BeApproximately(-OneMm, 1e-9);
        down.OffsetY.Should().BeApproximately(0, 1e-9);
    }

    [Fact]
    public void Landscape_page_turns_the_other_way_at_270_degrees()
    {
        var right = PrintAdjust.ForPage(new PrintAdjustment { OffsetXMm = 1 }, false, true, 270);
        right.OffsetX.Should().BeApproximately(0, 1e-9);
        right.OffsetY.Should().BeApproximately(-OneMm, 1e-9);
    }

    [Fact]
    public void Portrait_page_on_paper_whose_reference_is_landscape_turns_back()
    {
        // La feuille de test s'imprimerait en paysage, la page est en portrait : rotation inverse.
        var page = PrintAdjust.ForPage(new PrintAdjustment { OffsetXMm = 1 }, true, false, 90);
        page.OffsetX.Should().BeApproximately(0, 1e-9);
        page.OffsetY.Should().BeApproximately(-OneMm, 1e-9);
    }
}
