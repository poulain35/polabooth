using System.IO;
using System.Windows;
using System.Windows.Media;
using FluentAssertions;
using PolaKiosk.Services;
using SkiaSharp;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// LAB-331 : polices des textes vivants. Chargées depuis le cache de l'écran (une copie, le nom de
/// famille lu dans le fichier) ; absentes ou illisibles, DM Sans à la graisse la plus proche, sans
/// jamais empêcher l'écran. Chargement hors du fil d'affichage, comme dans la borne.
/// </summary>
public class ScreenFontsTests : IDisposable
{
    private static readonly string FontFixture =
        Path.Combine(AppContext.BaseDirectory, "Fixtures", "fonts", "Fraunces72ptSuperSoft-SemiBold.ttf");

    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    private string ScreenDir => Path.Combine(_dir.Path, "screens", "home");

    private static string Plan(string fontFile) => $$"""
    {"version":2,"kind":"home","size":{"w":1920,"h":1080},"background":"bg.png",
     "buttons":[],
     "texts":[{"variable":"event_name","x":0,"y":0,"w":800,"h":200,"font":"Pacifico","weight":800,"font_file":"{{fontFile}}"},
              {"variable":"event_date","x":0,"y":300,"w":800,"h":60,"font":"fraunces"}]}
    """;

    private CachedScreen Screen(string fontFile = "font-0.ttf", byte[]? font = null, string hash = "")
    {
        Directory.CreateDirectory(ScreenDir);
        using (var bitmap = new SKBitmap(8, 6))
        {
            bitmap.Erase(SKColors.Coral);
            using var image = SKImage.FromBitmap(bitmap);
            using var data = image.Encode(SKEncodedImageFormat.Png, 100);
            File.WriteAllBytes(Path.Combine(ScreenDir, "bg.png"), data.ToArray());
        }
        if (font != null) File.WriteAllBytes(Path.Combine(ScreenDir, fontFile), font);
        return new CachedScreen(ScreenLayout.Parse(Plan(fontFile))!, ScreenDir, hash);
    }

    private static byte[] RealFont() => File.ReadAllBytes(FontFixture);

    [Fact]
    public void A_font_file_is_loaded_from_a_copy_with_the_family_name_read_in_the_file()
    {
        var screen = Screen(font: RealFont());

        var content = ScreenContent.Load(screen, out var error)!;

        error.Should().BeNull();
        content.FontWarnings.Should().BeEmpty();
        var font = content.FontFor(screen.Layout.Texts[0]);
        font.Weight.Should().Be(800, "la graisse du plan est gardée");
        font.Family.Should().NotBeSameAs(KioskFonts.Text);
        new Typeface(font.Family, FontStyles.Normal, FontWeights.Normal, FontStretches.Normal)
            .TryGetGlyphTypeface(out var glyphs).Should().BeTrue();
        var copies = ScreenCache.FontCopiesDirectory(ScreenDir, "home");
        Path.GetFullPath(glyphs.FontUri.LocalPath).Should().StartWithEquivalentOf(Path.GetFullPath(copies),
            "WPF lit la copie, jamais le fichier du dossier de l'écran (qui doit pouvoir être échangé)");
        File.Exists(Path.Combine(ScreenDir, "font-0.ttf")).Should().BeTrue();
    }

    [Fact]
    public void A_missing_font_gives_dm_sans_at_the_nearest_weight_and_keeps_the_screen()
    {
        var screen = Screen();

        var content = ScreenContent.Load(screen, out var error);

        content.Should().NotBeNull(error);
        content!.FontWarnings.Should().ContainSingle().Which.Should().Be("police « Pacifico » absente (font-0.ttf)");
        content.FontFor(screen.Layout.Texts[0]).Should().Be(new ScreenFont(KioskFonts.Text, 700));
        content.FontFor(screen.Layout.Texts[1]).Should().Be(new ScreenFont(KioskFonts.Title, 600), "Fraunces reste embarquée");
    }

    [Theory]
    [InlineData(new byte[] { 0, 1, 0, 0, 9, 9, 9, 9 })]   // en-tête TrueType, contenu abîmé
    [InlineData(new byte[] { 0x77, 0x4F, 0x46, 0x32, 0, 0, 0, 0 })] // wOF2
    public void An_unreadable_font_gives_dm_sans_without_crashing(byte[] bytes)
    {
        var screen = Screen(font: bytes);

        var content = ScreenContent.Load(screen, out var error);

        content.Should().NotBeNull(error);
        content!.FontWarnings.Should().ContainSingle().Which.Should().StartWith("police « Pacifico » illisible");
        content.FontFor(screen.Layout.Texts[0]).Should().Be(new ScreenFont(KioskFonts.Text, 700));
    }

    [Theory]
    [InlineData("../x.ttf")]
    [InlineData("a/b.ttf")]
    public void A_font_name_outside_the_screen_folder_is_never_read(string name)
    {
        ScreenContent.LoadFont(ScreenDir, "home", name, out var copy, out var reason).Should().BeNull();
        copy.Should().BeNull();
        reason.Should().Be("absente");
    }

    [Fact]
    public void A_font_that_arrives_later_is_taken_by_the_cached_load()
    {
        var hash = "h-" + Guid.NewGuid().ToString("N");
        var screen = Screen(hash: hash);
        ScreenContent.LoadCached(screen, out _)!.FontWarnings.Should().HaveCount(1);
        ScreenContent.LoadCached(screen, out _)!.FontWarnings.Should().HaveCount(1, "même état : version déjà chargée");

        File.WriteAllBytes(Path.Combine(ScreenDir, "font-0.ttf"), RealFont());

        ScreenContent.LoadCached(screen, out _)!.FontWarnings.Should().BeEmpty("la police arrivée depuis est chargée");
    }

    [Fact]
    public void Copies_of_other_versions_are_removed()
    {
        var stale = Path.Combine(ScreenCache.FontCopiesDirectory(ScreenDir, "home"), "0123456789ABCDEF");
        Directory.CreateDirectory(stale);
        File.WriteAllBytes(Path.Combine(stale, "old.ttf"), [0, 1, 0, 0]);

        ScreenContent.Load(Screen(font: RealFont()), out _)!.FontWarnings.Should().BeEmpty();

        Directory.Exists(stale).Should().BeFalse();
        Directory.GetDirectories(ScreenCache.FontCopiesDirectory(ScreenDir, "home")).Should().ContainSingle();
    }

    [Theory]
    [InlineData(new byte[] { 0, 1, 0, 0, 1 }, true)]
    [InlineData(new byte[] { 0x74, 0x72, 0x75, 0x65 }, true)]  // « true » (TrueType Mac)
    [InlineData(new byte[] { 0x4F, 0x54, 0x54, 0x4F }, true)]  // « OTTO » (OpenType CFF)
    [InlineData(new byte[] { 0x77, 0x4F, 0x46, 0x46 }, false)] // wOFF : WPF ne le lit pas
    [InlineData(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, false)] // PNG
    [InlineData(new byte[] { 0, 1, 0 }, false)]
    public void Only_truetype_and_opentype_files_are_fonts(byte[] head, bool expected)
    {
        var path = _dir.File("f.bin");
        File.WriteAllBytes(path, head);

        ScreenCache.IsFontFile(path).Should().Be(expected);
        ScreenCache.IsFontFile(_dir.File("absent.ttf")).Should().BeFalse();
    }
}
