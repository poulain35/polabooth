using FluentAssertions;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Règles de l'accueil (LAB-251) : écran 1a, 1b ou 1c, formats, nom et tirage.</summary>
public class HomeScreenTests
{
    private static readonly CaptureFormat[] AllFormats = Enum.GetValues<CaptureFormat>();

    private static HomeConfig Home(bool gif = false, bool boomerang = false, bool photo = true) => new()
    {
        Personalized = true,
        Buttons = new HomeButtonsConfig
        {
            Photo     = new HomeButtonConfig { Enabled = photo,     Label = "Photo" },
            Gif       = new HomeButtonConfig { Enabled = gif,       Label = "GIF" },
            Boomerang = new HomeButtonConfig { Enabled = boomerang, Label = "Boomerang" },
        },
    };

    [Theory]
    [InlineData(false, 1, HomeLayout.Neutral)]
    [InlineData(false, 3, HomeLayout.Neutral)]       // personnalisation désactivée : 1a même avec plusieurs formats
    [InlineData(true,  1, HomeLayout.Personalized)]  // un seul format : 1b
    [InlineData(true,  2, HomeLayout.FormatChoice)]  // au moins deux formats : 1c
    [InlineData(true,  3, HomeLayout.FormatChoice)]
    public void The_screen_depends_on_personalization_and_formats(bool personalized, int formatCount, HomeLayout expected)
    {
        HomeScreen.ResolveLayout(personalized, AllFormats.Take(formatCount).ToList()).Should().Be(expected);
    }

    // Écran du client (LAB-291) : seulement si l'accueil est personnalisé, l'option active et le PNG lisible.
    [Theory]
    [InlineData(true,  1, true,  true,  HomeLayout.CustomDesign)]
    [InlineData(true,  3, true,  true,  HomeLayout.CustomDesign)]  // plusieurs formats : tuiles sur l'écran du client
    [InlineData(false, 1, true,  true,  HomeLayout.Neutral)]       // personnalisation coupée : 1a
    [InlineData(true,  1, false, true,  HomeLayout.Personalized)]  // option coupée : 1b
    [InlineData(true,  1, true,  false, HomeLayout.Personalized)]  // PNG absent ou illisible : 1b (spec D7)
    [InlineData(true,  2, true,  false, HomeLayout.FormatChoice)]  // ... ou 1c
    [InlineData(true,  2, false, false, HomeLayout.FormatChoice)]
    public void The_client_screen_needs_personalization_the_option_and_a_readable_png(
        bool personalized, int formatCount, bool clientDesign, bool hasCustomDesign, HomeLayout expected)
    {
        HomeScreen.ResolveLayout(personalized, AllFormats.Take(formatCount).ToList(), clientDesign, hasCustomDesign)
            .Should().Be(expected);
    }

    // Écran de l'organisation (LAB-297) : priorité écran du client > écran de l'organisation > 1a / 1b / 1c.
    [Theory]
    [InlineData(true,  1, true,  true,  true,  HomeLayout.CustomDesign)]  // le client gagne
    [InlineData(true,  3, true,  true,  true,  HomeLayout.CustomDesign)]
    [InlineData(true,  1, false, true,  true,  HomeLayout.OrgDesign)]     // option du client coupée
    [InlineData(true,  1, true,  false, true,  HomeLayout.OrgDesign)]     // écran du client absent ou illisible
    [InlineData(false, 1, true,  true,  true,  HomeLayout.OrgDesign)]     // non personnalisé : pas de client, mais l'org (fond neutre)
    [InlineData(false, 3, false, false, true,  HomeLayout.OrgDesign)]
    [InlineData(true,  2, false, false, true,  HomeLayout.OrgDesign)]     // plusieurs formats : l'org passe avant 1c
    [InlineData(false, 1, false, false, false, HomeLayout.Neutral)]       // rien en cache : écrans standard
    [InlineData(true,  1, false, false, false, HomeLayout.Personalized)]
    [InlineData(true,  2, false, false, false, HomeLayout.FormatChoice)]
    public void The_org_screen_comes_after_the_client_screen_and_before_the_standard_ones(
        bool personalized, int formatCount, bool clientDesign, bool hasCustomDesign, bool hasOrgDesign, HomeLayout expected)
    {
        HomeScreen.ResolveLayout(personalized, AllFormats.Take(formatCount).ToList(), clientDesign, hasCustomDesign, hasOrgDesign)
            .Should().Be(expected);
    }

    [Theory]
    [InlineData(HomeLayout.OrgDesign,    1, true)]   // spec D5 : toucher n'importe où démarre
    [InlineData(HomeLayout.OrgDesign,    2, true)]
    [InlineData(HomeLayout.Neutral,      1, true)]
    [InlineData(HomeLayout.Personalized, 1, true)]
    [InlineData(HomeLayout.FormatChoice, 2, false)]
    [InlineData(HomeLayout.CustomDesign, 1, true)]   // pastille : tout l'écran démarre
    [InlineData(HomeLayout.CustomDesign, 2, false)]  // tuiles : seules elles démarrent
    public void The_whole_screen_starts_unless_tiles_are_shown(HomeLayout layout, int formatCount, bool expected)
    {
        HomeScreen.IsWholeScreenTappable(layout, formatCount).Should().Be(expected);
    }

    [Fact]
    public void Only_formats_the_kiosk_can_shoot_are_offered()
    {
        // Le GIF est activé dans le SaaS, mais la borne ne sait faire que la photo : 1b, pas 1c.
        var formats = HomeScreen.EnabledFormats(Home(gif: true), HomeScreen.SupportedFormats);

        formats.Should().Equal(CaptureFormat.Photo);
        HomeScreen.ResolveLayout(true, formats).Should().Be(HomeLayout.Personalized);
    }

    [Fact]
    public void A_format_added_to_the_kiosk_switches_the_home_to_tiles()
    {
        var formats = HomeScreen.EnabledFormats(Home(gif: true, boomerang: true), AllFormats);

        formats.Should().Equal(CaptureFormat.Photo, CaptureFormat.Gif, CaptureFormat.Boomerang);
        HomeScreen.ResolveLayout(true, formats).Should().Be(HomeLayout.FormatChoice);
    }

    [Fact]
    public void Photo_stays_offered_when_no_format_is_usable()
    {
        HomeScreen.EnabledFormats(Home(photo: false), HomeScreen.SupportedFormats).Should().Equal(CaptureFormat.Photo);
        HomeScreen.EnabledFormats(null, HomeScreen.SupportedFormats).Should().Equal(CaptureFormat.Photo);
    }

    [Fact]
    public void Tiles_take_the_saas_label_and_the_first_one_stands_out()
    {
        var home = Home(gif: true);
        home.Buttons.Gif.Label = "  ";
        home.Buttons.Photo.Label = " Photo souvenir ";

        var tiles = HomeScreen.Tiles([CaptureFormat.Photo, CaptureFormat.Video, CaptureFormat.Gif], home);

        tiles.Should().Equal(
            new HomeFormatTile(CaptureFormat.Photo, "Photo souvenir", "Imprimée et partagée", IsPrimary: true),
            new HomeFormatTile(CaptureFormat.Video, "Vidéo",          "Un message filmé",     IsPrimary: false),
            new HomeFormatTile(CaptureFormat.Gif,   "GIF",            "Animé, à partager",    IsPrimary: false));
    }

    [Theory]
    [InlineData("Camille & Thomas", "Mariage Camille et Thomas", "Camille & Thomas")]
    [InlineData("  ",               "Mariage Camille et Thomas", "Mariage Camille et Thomas")]
    [InlineData(null,               " Soirée Orange ",           "Soirée Orange")]
    public void The_name_is_display_name_or_else_the_event_name(string? displayName, string eventName, string expected)
    {
        HomeScreen.DisplayName(new HomeConfig { DisplayName = displayName }, eventName).Should().Be(expected);
    }

    [Fact]
    public void The_print_keeps_the_design_proportions_and_labels_the_first_photo_zone()
    {
        var canvas = CompositeService.FullFrameZone("portrait");
        var zone = new PhotoZone(40, 50, canvas.Width - 80, 300);

        var layout = HomeScreen.PrintLayout("portrait", [zone], 440, 530)!;

        double scale = Math.Min(440.0 / canvas.Width, 530.0 / canvas.Height);
        layout.Width.Should().BeApproximately(canvas.Width * scale, 0.001);
        layout.Height.Should().BeApproximately(canvas.Height * scale, 0.001);
        (layout.Width <= 440 && layout.Height <= 530).Should().BeTrue();
        layout.LabelLeft.Should().BeApproximately(40 * scale + 14, 0.001);
        layout.LabelBottom.Should().BeApproximately((canvas.Height - 350) * scale + 14, 0.001);
    }

    [Fact]
    public void The_print_label_sits_in_the_corner_without_photo_zone()
    {
        var layout = HomeScreen.PrintLayout("stripV", [], 440, 530)!;

        layout.LabelLeft.Should().Be(14);
        layout.LabelBottom.Should().Be(14);
    }

    [Fact]
    public void An_unknown_format_has_no_print()
    {
        HomeScreen.PrintLayout("hexagone", [], 440, 530).Should().BeNull();
    }

    // ── Marque sans logo (LAB-257) ────────────────────────────────────────────

    [Theory]
    [InlineData("Studio Lumière", "Studio Lumière")]
    [InlineData("  Studio Lumière ", "Studio Lumière")]
    [InlineData("", "Photobooth")]
    [InlineData("   ", "Photobooth")]
    [InlineData(null, "Photobooth")]
    public void Without_logo_the_company_name_shows_otherwise_the_brand(string? company, string expected)
    {
        HomeScreen.BrandName(company).Should().Be(expected);
    }

    [Theory]
    [InlineData("Studio Lumière", "Mon Photobooth", "Studio Lumière")]
    [InlineData(null, " Mon Photobooth ", "Mon Photobooth")]
    [InlineData("", "", "Photobooth")]
    public void Without_company_the_instance_name_shows(string? company, string? instance, string expected)
    {
        HomeScreen.BrandName(company, instance).Should().Be(expected);
    }
}
