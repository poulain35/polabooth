namespace PolaKiosk.ViewModels;

/// <summary>
/// Paramètres de l'écran résultat. <paramref name="FromGallery"/> : photo rouverte depuis la galerie
/// de l'accueil (pas de « Refaire les photos »). <paramref name="PhotoCount"/> : nombre de photos de la
/// séance (« Refaire la photo » quand il n'y en a qu'une). <paramref name="VideoPath"/> : clip de
/// l'animation (GIF, LAB-237), joué en boucle à la place de l'aperçu ; le montage reste celui qui
/// s'imprime. <paramref name="AnimationUnavailable"/> : GIF dont l'animation a échoué (montage photo seul).
/// </summary>
public record ResultParameters(
    Guid SessionId,
    Guid EventId,
    string EventName,
    string CompositePath,
    string AccessCode = "",
    int? MaxPrintsPerEvent = null,
    int? MaxPrintsPerPhoto = null,
    string PrinterName = "",
    string PaperFormat = "4x6",
    Models.Supabase.EmailShareConfig? EmailConfig = null,
    Models.Supabase.ResultConfig? ResultCfg = null,
    bool FromGallery = false,
    int PhotoCount = 1,
    string? VideoPath = null,
    bool AnimationUnavailable = false
);
