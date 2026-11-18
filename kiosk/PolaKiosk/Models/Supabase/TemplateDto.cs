namespace PolaKiosk.Models.Supabase;

/// <summary>
/// Design client approuvé de l'événement (client_designs), lu en ligne ou depuis un fichier .pola
/// par <c>ApprovedDesignReader.ParseApprovedDesign</c>.
/// </summary>
public class TemplateDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Format { get; set; } = "";
    public string CanvasJson { get; set; } = "{}";

    /// <summary>PNG percé aux zones photo (final_png_url).</summary>
    public string? ThumbnailUrl { get; set; }

    /// <summary>
    /// LAB-291 : écran d'accueil créé par le client et validé (1920×1080), renvoyé par
    /// kiosk_get_approved_design seulement si home.personalized et home.client_design sont vrais.
    /// Null sinon : la borne efface l'écran gardé en cache.
    /// </summary>
    public HomeDesignDto? HomeDesign { get; set; }

    /// <summary>
    /// LAB-315 : les autres cadres validés (frames), dans l'ordre reçu (slot). Vide si le choix du
    /// cadre est coupé. Un cadre de cette liste n'a jamais lui-même de cadres ni d'écran d'accueil.
    /// </summary>
    public List<TemplateDto> Frames { get; set; } = [];
}

/// <summary>Écran d'accueil validé (client_designs de type « home ») : son id et son PNG plein écran.</summary>
public record HomeDesignDto(Guid Id, string FinalPngUrl);
