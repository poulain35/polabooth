using System.Windows.Media;

namespace PolaKiosk;

/// <summary>
/// Polices de l'identité de la borne (LAB-249), embarquées en ressources (Assets/Fonts) :
/// elles s'affichent même si elles ne sont pas installées sur le PC. Exposées dans App.xaml
/// sous les clés <c>KioskTitleFont</c> et <c>KioskTextFont</c>.
/// </summary>
/// <remarks>
/// WPF ne lit pas les axes des polices variables : on embarque des instances statiques.
/// Le nom après « # » doit être exactement le nom de famille inscrit dans le fichier,
/// sinon WPF retombe en silence sur Segoe UI (vérifié par KioskFontsTests).
/// </remarks>
public static class KioskFonts
{
    /// <summary>Dossier des polices, avec le nom de l'assembly : résolu aussi hors de l'application (tests).</summary>
    public const string FolderUri = "pack://application:,,,/PolaKiosk;component/Assets/Fonts/";

    /// <summary>Titres : Fraunces, instance statique « 72pt SuperSoft » (SOFT = 100), graisse SemiBold (600).</summary>
    public const string TitleFamilyName = "Fraunces 72pt SuperSoft";

    /// <summary>Textes : DM Sans (Regular, Medium, SemiBold, Bold).</summary>
    public const string TextFamilyName = "DM Sans";

    public static FontFamily Title { get; } = Create(TitleFamilyName);

    public static FontFamily Text { get; } = Create(TextFamilyName);

    private static FontFamily Create(string familyName) => new(new Uri(FolderUri), "./#" + familyName);
}
