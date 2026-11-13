using System.Runtime.ExceptionServices;
using System.Windows;
using System.Windows.Media;
using FluentAssertions;

namespace PolaKiosk.Tests.Fonts;

// LAB-249 : les polices de la borne sont embarquées. Un nom de famille faux ou un fichier absent
// ne lève aucune erreur dans WPF (repli silencieux sur Segoe UI) : on vérifie que chaque graisse
// utilisée vient bien des fichiers de l'application.
public class KioskFontsTests
{
    private static void RunSta(Action action)
    {
        ExceptionDispatchInfo? error = null;
        var thread = new Thread(() =>
        {
            try
            {
                // Le constructeur statique d'Application enregistre le schéma pack:// et les ressources.
                _ = Application.Current;
                action();
            }
            catch (Exception ex) { error = ExceptionDispatchInfo.Capture(ex); }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        error?.Throw();
    }

    private static GlyphTypeface Resolve(FontFamily family, FontWeight weight)
    {
        var typeface = new Typeface(family, FontStyles.Normal, weight, FontStretches.Normal);
        typeface.TryGetGlyphTypeface(out var glyphs).Should().BeTrue("la police doit se charger depuis les ressources");
        return glyphs;
    }

    public static TheoryData<string, string, string> Faces => new()
    {
        { "title", "Normal",   "Fraunces72ptSuperSoft-SemiBold.ttf" },
        { "title", "SemiBold", "Fraunces72ptSuperSoft-SemiBold.ttf" },
        { "text",  "Normal",   "DMSans-Regular.ttf" },
        { "text",  "Medium",   "DMSans-Medium.ttf" },
        { "text",  "SemiBold", "DMSans-SemiBold.ttf" },
        { "text",  "Bold",     "DMSans-Bold.ttf" },
    };

    [Theory]
    [MemberData(nameof(Faces))]
    public void Each_weight_comes_from_the_embedded_file(string font, string weight, string file) => RunSta(() =>
    {
        var (family, name) = font == "title"
            ? (KioskFonts.Title, KioskFonts.TitleFamilyName)
            : (KioskFonts.Text, KioskFonts.TextFamilyName);
        var fontWeight = (FontWeight)new FontWeightConverter().ConvertFromString(weight)!;

        var glyphs = Resolve(family, fontWeight);

        // WPF met en minuscules le chemin des ressources
        glyphs.FontUri.ToString().Should().StartWithEquivalentOf(KioskFonts.FolderUri)
            .And.EndWithEquivalentOf(file, "aucune police système ne doit remplacer la police embarquée");
        glyphs.FamilyNames.Values.Should().Contain(name);
    });

    [Theory]
    [InlineData("title")]
    [InlineData("text")]
    public void Fonts_cover_french_characters(string font) => RunSta(() =>
    {
        var glyphs = Resolve(font == "title" ? KioskFonts.Title : KioskFonts.Text, FontWeights.SemiBold);

        foreach (var c in "éèêëàâçîïôûùœÉÀÇ’«»€…")
            glyphs.CharacterToGlyphMap.Should().ContainKey(c, $"le caractère « {c} » doit exister");
    });
}
