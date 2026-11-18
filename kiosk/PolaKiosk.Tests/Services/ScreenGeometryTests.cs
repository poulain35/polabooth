using System.Windows;
using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Placement de la surface 1920×1080 en UniformToFill centré (LAB-297), en 16:9 et en 16:10.</summary>
public class ScreenGeometryTests
{
    public static TheoryData<double, double, double, double, double> Screens => new()
    {
        // largeur, hauteur, échelle, décalage x, décalage y
        { 1920, 1080, 1.0,          0,                 0 },
        { 1280, 720,  2.0 / 3,      0,                 0 },
        { 1280, 800,  800.0 / 1080, (1280 - 1920 * 800.0 / 1080) / 2, 0 },   // 16:10 : bandes coupées à gauche et à droite
        { 1920, 1200, 1200.0 / 1080, (1920 - 1920 * 1200.0 / 1080) / 2, 0 },
    };

    // largeur, hauteur : 16:9 et 16:10
    public static TheoryData<double, double> Sizes => new() { { 1920, 1080 }, { 1280, 720 }, { 1280, 800 }, { 1920, 1200 } };

    [Theory]
    [MemberData(nameof(Screens))]
    public void The_surface_fills_the_screen_and_is_centred(double w, double h, double scale, double offsetX, double offsetY)
    {
        var g = ScreenGeometry.Fit(w, h);

        g.Scale.Should().BeApproximately(scale, 1e-9);
        g.OffsetX.Should().BeApproximately(offsetX, 1e-9);
        g.OffsetY.Should().BeApproximately(offsetY, 1e-9);
        // La surface couvre tout l'écran, sans bande.
        (1920 * g.Scale).Should().BeGreaterThanOrEqualTo(w - 1e-9);
        (1080 * g.Scale).Should().BeGreaterThanOrEqualTo(h - 1e-9);
    }

    [Theory]
    [MemberData(nameof(Sizes))]
    public void Screen_and_design_points_round_trip(double w, double h)
    {
        var g = ScreenGeometry.Fit(w, h);

        var design = new Point(1180, 420);
        var back = g.ToDesign(g.ToScreen(design));

        back.X.Should().BeApproximately(1180, 1e-9);
        back.Y.Should().BeApproximately(420, 1e-9);
        var centre = g.ToDesign(new Point(w / 2, h / 2));
        centre.X.Should().BeApproximately(960, 1e-9);
        centre.Y.Should().BeApproximately(540, 1e-9);
    }

    [Fact]
    public void A_button_box_is_scaled_and_shifted_on_a_16_10_screen()
    {
        var g = ScreenGeometry.Fit(1280, 800);

        var rect = g.ToScreen(new Rect(1180, 420, 420, 120));

        double scale = 800.0 / 1080, offset = (1280 - 1920 * scale) / 2;
        rect.X.Should().BeApproximately(1180 * scale + offset, 1e-9);
        rect.Y.Should().BeApproximately(420 * scale, 1e-9);
        rect.Width.Should().BeApproximately(420 * scale, 1e-9);
        rect.Height.Should().BeApproximately(120 * scale, 1e-9);
    }

    [Theory]
    [MemberData(nameof(Sizes))]
    public void Touching_a_drawn_button_hits_its_action_and_only_there(double w, double h)
    {
        var g = ScreenGeometry.Fit(w, h);
        IReadOnlyList<ScreenButton> buttons =
        [
            new("print",  1180, 420, 420, 120, "p.png"),
            new("finish", 1460, 900, 300, 100, "f.png"),
        ];

        foreach (var b in buttons)
        {
            var box = g.ToScreen(new Rect(b.X, b.Y, b.W, b.H));
            g.HitAction(buttons, new Point(box.X + box.Width / 2, box.Y + box.Height / 2)).Should().Be(b.Action);
            g.HitAction(buttons, new Point(box.X + 1, box.Y + 1)).Should().Be(b.Action);
            g.HitAction(buttons, new Point(box.Right - 1, box.Bottom - 1)).Should().Be(b.Action);
            g.HitAction(buttons, new Point(box.X - 2, box.Y + box.Height / 2)).Should().NotBe(b.Action);
            g.HitAction(buttons, new Point(box.X + box.Width / 2, box.Y - 2)).Should().NotBe(b.Action);
        }
        g.HitAction(buttons, new Point(w / 2, h / 2)).Should().BeNull();
    }

    [Fact]
    public void A_hidden_button_is_not_hit()
    {
        var g = ScreenGeometry.Fit(1920, 1080);
        IReadOnlyList<ScreenButton> buttons = [new("qr", 100, 100, 200, 200, "q.png")];

        g.HitAction(buttons, new Point(150, 150), isVisible: a => a != "qr").Should().BeNull();
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(-5, 800)]
    public void An_empty_screen_gives_a_neutral_placement(double w, double h)
        => ScreenGeometry.Fit(w, h).Should().Be(new ScreenGeometry(1, 0, 0));
}
