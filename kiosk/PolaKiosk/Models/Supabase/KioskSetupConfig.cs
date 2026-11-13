using Newtonsoft.Json;

namespace PolaKiosk.Models.Supabase;

/// <summary>
/// Config globale de l'écran de saisie du code (stockée dans Supabase Storage, hors événement).
/// Seule l'image de fond est lue : les couleurs de la borne sont fixes (LAB-249), les champs de
/// couleur que le SaaS écrit encore dans ce fichier sont ignorés.
/// </summary>
public class KioskSetupConfig
{
    [JsonProperty("bg_type")]
    public string BgType { get; set; } = ""; // "image" = image de fond ; toute autre valeur = fond crème

    [JsonProperty("bg_image_url")]
    public string? BgImageUrl { get; set; }
}
