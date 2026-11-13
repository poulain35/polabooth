namespace PolaKiosk.Models.Supabase;

/// <summary>
/// Design client approuvé de l'événement (client_designs), lu en ligne ou depuis un fichier .pola
/// par <c>SupabaseService.ParseApprovedDesign</c>.
/// </summary>
public class TemplateDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Format { get; set; } = "";
    public string CanvasJson { get; set; } = "{}";

    /// <summary>PNG percé aux zones photo (final_png_url).</summary>
    public string? ThumbnailUrl { get; set; }
}
