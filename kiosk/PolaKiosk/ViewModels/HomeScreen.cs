using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>Écrans d'accueil de la borne (LAB-251, maquettes 1a, 1b, 1c ; écran du client, LAB-291).</summary>
public enum HomeLayout
{
    /// <summary>1a : accueil neutre, « Touchez l'écran pour commencer ».</summary>
    Neutral,
    /// <summary>1b : nom et date de l'événement en grand, tout l'écran démarre.</summary>
    Personalized,
    /// <summary>1c : nom et date, puis une tuile par format ; seules les tuiles démarrent.</summary>
    FormatChoice,
    /// <summary>
    /// Écran d'accueil créé par le client (LAB-291), en plein écran. Par-dessus : la pastille « Touchez
    /// l'écran » (un format, tout l'écran démarre) ou les tuiles (plusieurs formats, seules elles démarrent).
    /// </summary>
    CustomDesign,
    /// <summary>
    /// Écran d'accueil composé par l'admin pour toutes les bornes de l'organisation (LAB-297), en
    /// 1920×1080. Tout l'écran démarre la séance (spec D5) ; le bouton « Photos » ouvre la galerie.
    /// Accueil non personnalisé : fond neutre, textes « personnalisé seulement » masqués (spec D7).
    /// </summary>
    OrgDesign,
}

/// <summary>Formats de prise de vue proposés à l'accueil, dans l'ordre des tuiles.</summary>
public enum CaptureFormat
{
    Photo,
    Video,
    Gif,
    Boomerang,
}

/// <summary>Tuile de format de l'écran 1c. <see cref="IsPrimary"/> : la première, en vert forêt.</summary>
public record HomeFormatTile(CaptureFormat Format, string Title, string Subtitle, bool IsPrimary);

/// <summary>Règles pures de l'accueil : choix de l'écran, formats, nom affiché.</summary>
public static class HomeScreen
{
    /// <summary>
    /// Formats que la borne sait réaliser (GIF depuis LAB-237). Boomerang et vidéo s'ajoutent ici quand
    /// la prise de vue les gère : l'accueil passe alors de lui-même à l'écran 1c.
    /// </summary>
    public static readonly IReadOnlyList<CaptureFormat> SupportedFormats = [CaptureFormat.Photo, CaptureFormat.Gif];

    /// <summary>Format animé (encodé en MP4 par ffmpeg) : proposé seulement si l'encodage est prêt.</summary>
    public static bool IsAnimated(CaptureFormat format) => format is CaptureFormat.Gif or CaptureFormat.Boomerang;

    /// <summary>
    /// Formats réalisables maintenant : sans encodage prêt (ffmpeg ou encodeur H.264 absent), les formats
    /// animés sont masqués jusqu'au redémarrage (spec LAB-207, cas limites).
    /// </summary>
    public static IReadOnlyList<CaptureFormat> ShootableFormats(bool animationsReady)
        => animationsReady ? SupportedFormats : SupportedFormats.Where(f => !IsAnimated(f)).ToList();

    /// <summary>
    /// Écran de l'accueil, dans l'ordre : écran du client, écran de l'organisation, puis 1a / 1b / 1c.
    /// <paramref name="clientDesign"/> : option home.client_design ; <paramref name="hasCustomDesign"/> :
    /// l'écran validé du client est en cache et lisible (seulement si l'accueil est personnalisé).
    /// <paramref name="hasOrgDesign"/> : l'écran composé par l'admin est en cache et lisible, utilisé que
    /// l'accueil soit personnalisé ou non (LAB-297). Sans eux, l'accueil reste 1a / 1b / 1c (spec D7).
    /// </summary>
    public static HomeLayout ResolveLayout(bool personalized, IReadOnlyCollection<CaptureFormat> formats,
        bool clientDesign = false, bool hasCustomDesign = false, bool hasOrgDesign = false)
        => personalized && clientDesign && hasCustomDesign ? HomeLayout.CustomDesign
         : hasOrgDesign ? HomeLayout.OrgDesign
         : !personalized ? HomeLayout.Neutral
         : formats.Count >= 2 ? HomeLayout.FormatChoice
         : HomeLayout.Personalized;

    /// <summary>
    /// Tout l'écran démarre la séance (1a, 1b, écran du client avec un seul format, écran de
    /// l'organisation) ; sinon seules les tuiles de format démarrent (1c, écran du client avec
    /// plusieurs formats). L'écran de l'organisation n'a pas de tuiles : il démarre le premier format.
    /// </summary>
    public static bool IsWholeScreenTappable(HomeLayout layout, int formatCount) => layout switch
    {
        HomeLayout.FormatChoice => false,
        HomeLayout.CustomDesign => formatCount < 2,
        _                       => true,
    };

    /// <summary>
    /// Formats actifs dans la config (home.buttons) que la borne sait réaliser, dans l'ordre des
    /// tuiles. Jamais vide : sans format utilisable, la photo reste proposée.
    /// </summary>
    public static IReadOnlyList<CaptureFormat> EnabledFormats(HomeConfig? home, IReadOnlyCollection<CaptureFormat> supported)
    {
        var buttons = home?.Buttons ?? new HomeButtonsConfig();
        var enabled = new List<CaptureFormat>();
        foreach (var format in Enum.GetValues<CaptureFormat>())
        {
            bool on = format switch
            {
                CaptureFormat.Photo     => buttons.Photo.Enabled,
                CaptureFormat.Gif       => buttons.Gif.Enabled,
                CaptureFormat.Boomerang => buttons.Boomerang.Enabled,
                _                       => false, // la vidéo n'a pas encore de réglage dans le SaaS
            };
            if (on && supported.Contains(format)) enabled.Add(format);
        }
        return enabled.Count > 0 ? enabled : [CaptureFormat.Photo];
    }

    /// <summary>Tuiles de l'écran 1c, titre repris du libellé du SaaS (sinon le nom du format).</summary>
    public static IReadOnlyList<HomeFormatTile> Tiles(IReadOnlyList<CaptureFormat> formats, HomeConfig? home)
    {
        var buttons = home?.Buttons ?? new HomeButtonsConfig();
        return formats.Select((format, i) =>
        {
            var (label, fallback, subtitle) = format switch
            {
                CaptureFormat.Photo     => (buttons.Photo.Label,     "Photo",     "Imprimée et partagée"),
                CaptureFormat.Video     => ("",                      "Vidéo",     "Un message filmé"),
                CaptureFormat.Gif       => (buttons.Gif.Label,       "GIF",       "Animé, à partager"),
                _                       => (buttons.Boomerang.Label, "Boomerang", "Joué en boucle"),
            };
            var title = string.IsNullOrWhiteSpace(label) ? fallback : label.Trim();
            return new HomeFormatTile(format, title, subtitle, IsPrimary: i == 0);
        }).ToList();
    }

    /// <summary>Nom de l'accueil personnalisé : display_name s'il est rempli, sinon le nom de l'événement.</summary>
    public static string DisplayName(HomeConfig? home, string eventName)
        => home?.DisplayName?.Trim() is { Length: > 0 } name ? name : eventName.Trim();

    /// <summary>Nom affiché quand ni la société ni l'instance n'en donnent un (open core L7).</summary>
    public const string DefaultBrandName = "Photobooth";

    /// <summary>
    /// Nom en haut à gauche de l'accueil quand la société n'a pas de logo (LAB-257) :
    /// contact_company, sinon le nom de l'instance (<c>Contact.CompanyName</c>), sinon « Photobooth ».
    /// </summary>
    public static string BrandName(string? company, string? instanceName = null)
        => company?.Trim() is { Length: > 0 } name ? name
         : instanceName?.Trim() is { Length: > 0 } fallback ? fallback
         : DefaultBrandName;

    /// <summary>
    /// Taille du tirage (design de l'événement) dans un cadre donné, à ses proportions, et place de
    /// l'étiquette « Liste des photos prises » : en bas à gauche de la première zone photo, sinon du
    /// tirage. Null si le format est inconnu.
    /// </summary>
    public static PrintPreviewLayout? PrintLayout(string format, IReadOnlyList<PhotoZone> zones,
        double maxWidth, double maxHeight, double labelInset = 14)
    {
        if (PrintFormats.Find(format) is not { } printFormat) return null;
        var canvas = printFormat.Canvas;

        double scale = Math.Min(maxWidth / canvas.Width, maxHeight / canvas.Height);
        double width = canvas.Width * scale, height = canvas.Height * scale;

        var zone = zones.Count > 0 ? zones[0] : canvas;
        double left   = Math.Clamp(zone.Left * scale, 0, width);
        double bottom = Math.Clamp((canvas.Height - zone.Top - zone.Height) * scale, 0, height);
        return new PrintPreviewLayout(width, height, left + labelInset, bottom + labelInset);
    }
}

/// <summary>Taille du tirage affiché et marge de l'étiquette (depuis le bas à gauche), en pixels d'écran.</summary>
public record PrintPreviewLayout(double Width, double Height, double LabelLeft, double LabelBottom);
