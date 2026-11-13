using System.Runtime.ExceptionServices;
using System.Windows;
using FluentAssertions;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.Controls;

// LAB-248 : anneau du compte à rebours (maquette 2) et apparition du chiffre ;
// LAB-260 : chiffre centré sur son contour réel.
public class LiveViewCountdownTests
{
    private const double Outer = CountdownGeometry.RingRadius + CountdownGeometry.RingThickness / 2;

    [Fact]
    public void Arc_is_empty_when_countdown_is_over()
    {
        CountdownGeometry.Arc(0).IsEmpty().Should().BeTrue();
    }

    [Fact]
    public void Arc_is_a_full_ring_at_start()
    {
        var bounds = CountdownGeometry.Arc(1).Bounds;
        bounds.Width.Should().BeApproximately(2 * Outer, 0.5);
        bounds.Height.Should().BeApproximately(2 * Outer, 0.5);
    }

    [Fact]
    public void Quarter_arc_starts_at_top_and_turns_clockwise()
    {
        // Un quart de tour depuis midi, dans le sens des aiguilles d'une montre : quart haut-droit.
        var c = CountdownGeometry.Center;
        var bounds = CountdownGeometry.Arc(0.25).Bounds;
        bounds.Left.Should().BeGreaterThan(c.X - CountdownGeometry.RingThickness);
        bounds.Bottom.Should().BeLessThan(c.Y + CountdownGeometry.RingThickness);
        bounds.Top.Should().BeApproximately(c.Y - Outer, 0.5);
        bounds.Right.Should().BeApproximately(c.X + Outer, 0.5);
    }

    [Fact]
    public void Arc_thins_out_at_the_very_end()
    {
        // Sur la toute fin, le trait s'affine : pas de point rond qui disparaît d'un coup.
        var tiny = CountdownGeometry.Arc(CountdownGeometry.ThinningTail / 4).Bounds;
        tiny.Height.Should().BeLessThan(CountdownGeometry.RingThickness / 2);
    }

    [Fact]
    public void Ring_empties_over_the_whole_countdown()
    {
        var total = TimeSpan.FromSeconds(3);
        CountdownGeometry.Progress(TimeSpan.Zero, total).Should().Be(1);
        CountdownGeometry.Progress(TimeSpan.FromSeconds(1.5), total).Should().BeApproximately(0.5, 1e-9);
        CountdownGeometry.Progress(TimeSpan.FromSeconds(3), total).Should().Be(0);
        CountdownGeometry.Progress(TimeSpan.FromSeconds(9), total).Should().Be(0); // flash : anneau vide
    }

    [Theory]
    [InlineData("1")]
    [InlineData("3")]
    [InlineData("5")]
    [InlineData("9")]
    [InlineData("10")]
    public void Digit_outline_starts_at_origin_so_alignment_centers_the_glyph(string text) => RunSta(() =>
    {
        // Le Path est centré par sa boîte (0, 0, largeur, hauteur) : le contour doit y commencer,
        // sans la marge que la police garde au-dessus et en dessous des chiffres.
        var bounds = CountdownGeometry.Digit(text, KioskFonts.Title, 1).Bounds;
        bounds.X.Should().BeApproximately(0, 0.01);
        bounds.Y.Should().BeApproximately(0, 0.01);
        bounds.Width.Should().BeGreaterThan(20);
        // Chiffres alignés sur la hauteur des capitales : nettement moins que la taille de police.
        bounds.Height.Should().BeInRange(100, CountdownGeometry.DigitFontSize * 0.85);
    });

    [Fact]
    public void Text_pops_from_70_to_106_then_settles_at_100_percent()
    {
        var start = CountdownGeometry.Pop(TimeSpan.Zero);
        start.Scale.Should().BeApproximately(0.7, 1e-9);
        start.Opacity.Should().Be(0);

        var peak = CountdownGeometry.Pop(CountdownGeometry.PopDuration * 0.6);
        peak.Scale.Should().BeApproximately(1.06, 1e-9);
        peak.Opacity.Should().Be(1);

        var end = CountdownGeometry.Pop(TimeSpan.FromSeconds(2));
        end.Scale.Should().BeApproximately(1, 1e-9);
        end.Opacity.Should().Be(1);
    }

    private static void RunSta(Action action)
    {
        ExceptionDispatchInfo? error = null;
        var thread = new Thread(() =>
        {
            try
            {
                _ = Application.Current; // enregistre le schéma pack:// des polices embarquées
                action();
            }
            catch (Exception ex) { error = ExceptionDispatchInfo.Capture(ex); }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        error?.Throw();
    }
}
