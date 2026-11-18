using System.Windows.Media;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Une carte de l'écran de choix du cadre (LAB-315) : miniature décodée (PNG troué posé sur du
/// sauge), nom, nombre de poses et taille de la miniature à la proportion du cadre.
/// </summary>
public sealed record FrameTile(
    Guid TemplateId,
    string Name,
    string Format,
    int PhotoCount,
    ImageSource Image,
    double ImageWidth,
    double ImageHeight)
{
    public string PhotoCountText => FrameChoice.PhotoCountText(PhotoCount);
}

/// <summary>Cadre de l'événement prêt à être proposé : son modèle, ses zones photo et sa miniature (null si illisible).</summary>
public sealed record FrameCandidate(TemplateEntity Template, int ZoneCount, ImageSource? Image);

/// <summary>Règles du choix du cadre par l'invité (LAB-315), sans état ni affichage.</summary>
public static class FrameChoice
{
    /// <summary>Cartes au plus : le design principal et 3 autres cadres.</summary>
    public const int MaxTiles = 4;

    /// <summary>Boîte de la miniature dans une carte (pixels de la surface 1280×800).</summary>
    public const double ThumbnailMaxWidth = 220, ThumbnailMaxHeight = 300;

    /// <summary>
    /// L'option est active et au moins deux cadres sont utilisables : sinon pas d'écran de choix,
    /// le parcours garde le cadre unique (premier cadre).
    /// </summary>
    public static bool ShouldAsk(FrameChoiceConfig? config, int usableCount)
        => config?.Enabled == true && usableCount >= 2;

    /// <summary>Cadres dans l'ordre de l'événement : design principal, puis les autres dans l'ordre reçu.</summary>
    public static IReadOnlyList<TemplateEntity> Ordered(IEnumerable<TemplateEntity> templates)
        => templates.OrderBy(t => t.SortOrder ?? 0).ThenBy(t => t.Id).ToList();

    /// <summary>
    /// Cadre de la séance : celui choisi par l'invité s'il existe encore, sinon le premier cadre de
    /// l'événement (cadre unique, choix coupé ou cadre retiré entre-temps). Null sans cadre.
    /// </summary>
    public static TemplateEntity? Pick(IEnumerable<TemplateEntity> templates, Guid? selectedId)
    {
        var ordered = Ordered(templates);
        return (selectedId is { } id ? ordered.FirstOrDefault(t => t.Id == id) : null) ?? ordered.FirstOrDefault();
    }

    /// <summary>Poses de la prise de vue : une par zone photo, une seule (plein cadre) sans zone.</summary>
    public static int PhotoCount(int zoneCount) => Math.Max(1, zoneCount);

    public static string PhotoCountText(int photoCount) => photoCount <= 1 ? "1 photo" : $"{photoCount} photos";

    /// <summary>
    /// Cartes de l'écran de choix : les cadres dont la miniature est lisible, dans l'ordre, 4 au plus.
    /// Format inconnu : proportion d'un 10×15 portrait.
    /// </summary>
    public static IReadOnlyList<FrameTile> Tiles(IEnumerable<FrameCandidate> candidates)
        => candidates
            .Where(c => c.Image != null)
            .Take(MaxTiles)
            .Select(c =>
            {
                var (width, height) = ThumbnailSize(c.Template.Format);
                return new FrameTile(c.Template.Id, c.Template.Name, c.Template.Format,
                    PhotoCount(c.ZoneCount), c.Image!, width, height);
            })
            .ToList();

    /// <summary>Miniature à la proportion du tirage, la plus grande qui tient dans sa boîte.</summary>
    public static (double Width, double Height) ThumbnailSize(string format)
    {
        var canvas = PrintFormats.FindOrDefault(format).Canvas;

        var scale = Math.Min(ThumbnailMaxWidth / canvas.Width, ThumbnailMaxHeight / canvas.Height);
        return (Math.Round(canvas.Width * scale), Math.Round(canvas.Height * scale));
    }
}
