using System.Runtime.ExceptionServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.Input;
using FluentAssertions;
using PolaKiosk.Services;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.Controls;

/// <summary>
/// Contrôle des écrans composés (LAB-297) : les boutons sont là où le plan les dessine, sur un écran
/// 16:9 comme 16:10, et réagissent selon leur état (actif, grisé, masqué).
/// </summary>
public class DesignedScreenTests
{
    private static void RunSta(Action action)
    {
        ExceptionDispatchInfo? error = null;
        var thread = new Thread(() =>
        {
            try
            {
                _ = Application.Current; // schéma pack:// (polices embarquées)
                action();
            }
            catch (Exception ex) { error = ExceptionDispatchInfo.Capture(ex); }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        error?.Throw();
    }

    private static BitmapSource Pixel(int w = 4, int h = 4)
    {
        var pixels = Enumerable.Repeat((byte)0xFF, w * h * 4).ToArray();
        var bmp = BitmapSource.Create(w, h, 96, 96, PixelFormats.Bgra32, null, pixels, w * 4);
        bmp.Freeze();
        return bmp;
    }

    private const string ResultPlan = """
    {"version":7,"kind":"result","size":{"w":1920,"h":1080},"background":"bg.png",
     "buttons":[{"action":"print","x":1180,"y":420,"w":420,"h":120,"image":"p.png"},
                {"action":"email","x":1180,"y":600,"w":200,"h":120,"image":"e.png"},
                {"action":"qr","x":1400,"y":600,"w":200,"h":120,"image":"q.png"},
                {"action":"finish","x":1460,"y":900,"w":300,"h":100,"image":"f.png"},
                {"action":"copies_minus","x":900,"y":420,"w":120,"h":120,"image":"m.png"}],
     "texts":[{"variable":"countdown","x":140,"y":960,"w":600,"h":50,"size":30}],
     "slots":[{"slot":"photo_preview","x":140,"y":120,"w":594,"h":810,"angle":-2,"radius":8}]}
    """;

    private const string HomePlan = """
    {"version":3,"kind":"home","size":{"w":1920,"h":1080},"background":"bg.png","background_neutral":"n.png",
     "buttons":[{"action":"start","x":760,"y":820,"w":400,"h":130,"image":"s.png"}],
     "texts":[{"variable":"event_name","x":360,"y":420,"w":1200,"h":220,"font":"Fraunces","size":110,"max_lines":2,
               "align":"center","personalized_only":true},
              {"variable":"event_date","x":660,"y":660,"w":600,"h":60,"size":36,"uppercase":true,"char_spacing":200}]}
    """;

    private static (DesignedScreen Screen, Border Host) Mount(string plan, double w, double h, out ScreenContent content,
        ImageSource? background = null, ImageSource? neutral = null)
    {
        var layout = ScreenLayout.Parse(plan)!;
        content = ScreenContent.Create(layout, background ?? Pixel(), neutral,
            layout.Buttons.ToDictionary(b => b.Action, _ => (ImageSource)Pixel()));
        var screen = new DesignedScreen { ContentModel = content };
        var host = new Border { Width = w, Height = h, Child = screen };
        Layout(host);
        return (screen, host);
    }

    private static void Layout(FrameworkElement host)
    {
        host.Measure(new Size(host.Width, host.Height));
        host.Arrange(new Rect(0, 0, host.Width, host.Height));
        host.UpdateLayout();
    }

    /// <summary>Élément touché au point donné (le plus haut qui accepte le toucher).</summary>
    private static DependencyObject? Hit(Visual host, Point point)
        => VisualTreeHelper.HitTest(host, point)?.VisualHit;

    private static bool IsInside(DependencyObject? hit, DependencyObject target)
    {
        for (var node = hit; node != null; node = VisualTreeHelper.GetParent(node))
            if (node == target) return true;
        return false;
    }

    public static TheoryData<double, double> Screens => new()
    {
        { 1920, 1080 }, { 1280, 720 }, { 1280, 800 }, { 1920, 1200 },
    };

    [Theory]
    [MemberData(nameof(Screens))]
    public void Each_button_is_drawn_and_touchable_exactly_where_the_geometry_says(double w, double h) => RunSta(() =>
    {
        var (screen, host) = Mount(ResultPlan, w, h, out var content);
        var geometry = ScreenGeometry.Fit(w, h);

        foreach (var button in content.Layout.Buttons)
        {
            var expected = geometry.ToScreen(new Rect(button.X, button.Y, button.W, button.H));
            var box = screen.ButtonBox(button.Action)!;

            var topLeft = box.TranslatePoint(new Point(0, 0), host);
            var bottomRight = box.TranslatePoint(new Point(box.ActualWidth, box.ActualHeight), host);
            topLeft.X.Should().BeApproximately(expected.X, 0.5, button.Action);
            topLeft.Y.Should().BeApproximately(expected.Y, 0.5, button.Action);
            bottomRight.X.Should().BeApproximately(expected.Right, 0.5, button.Action);
            bottomRight.Y.Should().BeApproximately(expected.Bottom, 0.5, button.Action);

            var centre = new Point(expected.X + expected.Width / 2, expected.Y + expected.Height / 2);
            IsInside(Hit(host, centre), screen.ButtonOf(button.Action)!)
                .Should().BeTrue($"le centre de {button.Action} doit toucher ce bouton");
            geometry.HitAction(content.Layout.Buttons, centre).Should().Be(button.Action);
        }
    });

    [Fact]
    public void A_disabled_button_is_veiled_and_swallows_the_touch() => RunSta(() =>
    {
        var (screen, host) = Mount(ResultPlan, 1280, 800, out _);
        var runs = new List<string>();
        screen.ActionCommand = new RelayCommand<string>(a => runs.Add(a!));
        screen.ActionStates = new Dictionary<string, ScreenActionState>
        {
            ["email"] = ScreenActionState.Disabled,
            ["qr"] = ScreenActionState.Hidden,
        };
        Layout(host);

        screen.ButtonOf("email")!.IsEnabled.Should().BeFalse();
        var veil = screen.VeilOf("email")!;
        veil.Visibility.Should().Be(Visibility.Visible);
        veil.Opacity.Should().Be(0.6);
        ((SolidColorBrush)veil.Fill).Color.Should().Be(Color.FromRgb(0xF7, 0xF1, 0xE7));

        var g = ScreenGeometry.Fit(1280, 800);
        var centre = g.ToScreen(new Point(1280, 660));
        IsInside(Hit(host, centre), veil).Should().BeTrue();

        // Un appui sur le voile est absorbé : l'écran dessous ne le reçoit pas.
        var down = new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left) { RoutedEvent = UIElement.MouseDownEvent };
        veil.RaiseEvent(down);
        down.Handled.Should().BeTrue();

        screen.ButtonBox("qr")!.Visibility.Should().Be(Visibility.Collapsed);
        screen.ButtonOf("print")!.IsEnabled.Should().BeTrue();
        screen.VeilOf("print")!.Visibility.Should().Be(Visibility.Collapsed);
        runs.Should().BeEmpty();
    });

    [Fact]
    public void An_active_button_runs_its_action() => RunSta(() =>
    {
        var (screen, _) = Mount(ResultPlan, 1920, 1080, out _);
        var runs = new List<string>();
        screen.ActionCommand = new RelayCommand<string>(a => runs.Add(a!));

        screen.ButtonOf("print")!.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));

        runs.Should().Equal("print");
    });

    [Fact]
    public void A_pressed_button_shrinks_to_97_percent() => RunSta(() =>
    {
        var (screen, _) = Mount(ResultPlan, 1920, 1080, out _);
        var button = screen.ButtonOf("print")!;

        typeof(ButtonBase).GetMethod("SetIsPressed", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!
            .Invoke(button, [true]);

        var scale = (ScaleTransform)button.RenderTransform;
        scale.ScaleX.Should().Be(0.97);
        scale.ScaleY.Should().Be(0.97);
    });

    [Fact]
    public void Live_texts_show_their_value_and_hide_when_empty() => RunSta(() =>
    {
        var (screen, host) = Mount(ResultPlan, 1920, 1080, out _);

        screen.TextValues = new Dictionary<string, string> { ["countdown"] = "Retour à l'accueil dans 12 s" };
        Layout(host);
        var block = screen.TextOf("countdown")!;
        block.Text.Should().Be("Retour à l'accueil dans 12 s");
        ((FrameworkElement)block.Parent).Visibility.Should().Be(Visibility.Visible);

        screen.TextValues = new Dictionary<string, string> { ["countdown"] = "" };
        ((FrameworkElement)block.Parent).Visibility.Should().Be(Visibility.Collapsed);
    });

    [Fact]
    public void A_neutral_home_uses_the_neutral_background_and_hides_personalized_texts() => RunSta(() =>
    {
        var full = Pixel(8, 8);
        var neutral = Pixel(6, 6);
        var (screen, _) = Mount(HomePlan, 1920, 1080, out _, full, neutral);
        screen.TextValues = new Dictionary<string, string> { ["event_name"] = "Camille & Thomas", ["event_date"] = "samedi 12 juin" };

        var background = (Image)screen.SurfaceCanvas.Children[1];
        background.Source.Should().BeSameAs(full);
        ((FrameworkElement)screen.TextOf("event_name")!.Parent).Visibility.Should().Be(Visibility.Visible);

        screen.Personalized = false;

        background.Source.Should().BeSameAs(neutral);
        ((FrameworkElement)screen.TextOf("event_name")!.Parent).Visibility.Should().Be(Visibility.Collapsed);
        ((FrameworkElement)screen.TextOf("event_date")!.Parent).Visibility.Should().Be(Visibility.Visible);
        screen.TextOf("event_date")!.Text.Should().Be(string.Join(' ', "SAMEDI 12 JUIN".EnumerateRunes()));
    });

    [Fact]
    public void Each_live_text_is_written_in_its_resolved_font() => RunSta(() =>
    {
        const string plan = """
        {"version":4,"kind":"home","size":{"w":1920,"h":1080},"background":"bg.png","buttons":[],
         "texts":[{"variable":"event_name","x":360,"y":420,"w":1200,"h":220,"font":"Pacifico","weight":300,"font_file":"f.ttf"},
                  {"variable":"event_date","x":660,"y":660,"w":600,"h":60,"font":"Lobster","weight":800,"font_file":"g.ttf"}]}
        """;
        var layout = ScreenLayout.Parse(plan)!;
        var loaded = new FontFamily("Comic Sans MS");
        var content = ScreenContent.Create(layout, Pixel(), null, new Dictionary<string, ImageSource>(),
            new Dictionary<string, FontFamily> { ["f.ttf"] = loaded });
        var screen = new DesignedScreen { ContentModel = content };
        var host = new Border { Width = 1920, Height = 1080, Child = screen };
        screen.TextValues = new Dictionary<string, string> { ["event_name"] = "Camille", ["event_date"] = "12 juin" };
        Layout(host);

        var name = screen.TextOf("event_name")!;
        name.FontFamily.Should().BeSameAs(loaded);
        name.FontWeight.Should().Be(FontWeight.FromOpenTypeWeight(300));
        var date = screen.TextOf("event_date")!;
        date.FontFamily.Should().BeSameAs(KioskFonts.Text, "police non chargée : DM Sans");
        date.FontWeight.Should().Be(FontWeights.Bold, "graisse DM Sans la plus proche de 800");
    });

    [Fact]
    public void A_long_name_is_reduced_to_fit_its_box() => RunSta(() =>
    {
        var (screen, _) = Mount(HomePlan, 1920, 1080, out _);

        screen.TextValues = new Dictionary<string, string> { ["event_name"] = "Camille" };
        var shortSize = screen.TextOf("event_name")!.FontSize;
        screen.TextValues = new Dictionary<string, string>
        {
            ["event_name"] = "Mariage de Marie-Charlotte de La Villemarqué et Jean-Baptiste Kerguélen-Trémarec",
        };
        var block = screen.TextOf("event_name")!;

        shortSize.Should().Be(110);
        block.FontSize.Should().BeLessThan(110);
        block.MaxHeight.Should().BeLessThanOrEqualTo(2 * Math.Round(block.FontSize * 1.16) + 0.01);
        block.TextWrapping.Should().Be(TextWrapping.Wrap);
        block.TextTrimming.Should().Be(TextTrimming.CharacterEllipsis);
    });

    [Fact]
    public void A_transparent_plan_shows_the_event_background_underneath() => RunSta(() =>
    {
        const string plan = """
        {"version":1,"kind":"home","size":{"w":1920,"h":1080},"background":null,"transparent_background":true}
        """;
        var layout = ScreenLayout.Parse(plan)!;
        var underlay = Pixel(10, 10);
        var screen = new DesignedScreen
        {
            ContentModel = ScreenContent.Create(layout, null, null, new Dictionary<string, ImageSource>()),
            UnderlayImage = underlay,
        };

        ((Image)screen.SurfaceCanvas.Children[0]).Source.Should().BeSameAs(underlay);

        // Fond opaque : l'image de l'événement est cachée.
        var opaque = new DesignedScreen
        {
            ContentModel = ScreenContent.Create(ScreenLayout.Parse(HomePlan)!, Pixel(), null, new Dictionary<string, ImageSource>()),
            UnderlayImage = underlay,
        };
        ((Image)opaque.SurfaceCanvas.Children[0]).Source.Should().BeNull();
    });

    [Fact]
    public void A_slot_shows_its_image_tilted_and_rounded() => RunSta(() =>
    {
        var (screen, _) = Mount(ResultPlan, 1920, 1080, out _);
        var photo = Pixel(30, 40);

        screen.SlotImages = new Dictionary<string, ImageSource?> { ["photo_preview"] = photo };

        var slot = screen.SlotOf("photo_preview")!;
        ((ImageBrush)slot.Fill).ImageSource.Should().BeSameAs(photo);
        ((ImageBrush)slot.Fill).Stretch.Should().Be(Stretch.UniformToFill);
        ((RotateTransform)slot.RenderTransform).Angle.Should().Be(-2);
        slot.RadiusX.Should().Be(8);
    });
}
