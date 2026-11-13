namespace PolaKiosk.Services;

public interface ICompositeService
{
    /// <summary>
    /// Zones photo du template (objets <c>isPhotoZone</c> du canvas_json, groupes compris). L'analyse, coûteuse sur un
    /// canvas_json de plusieurs Mo, n'est refaite que si le template ou son contenu change.
    /// </summary>
    Task<IReadOnlyList<PhotoZone>> GetPhotoZonesAsync(Guid templateId, string canvasJson);

    /// <summary>
    /// Assemble la photo brute avec le template et sauvegarde le composite, puis sa vignette
    /// de galerie (<see cref="CompositeThumbnail"/>).
    /// Retourne le chemin du fichier composite généré.
    /// </summary>
    /// <param name="photoPaths">Une photo par zone photo du template. Si moins de photos que de zones, la dernière photo remplit les zones restantes.</param>
    /// <param name="zones">Zones photo du template, obtenues par <see cref="GetPhotoZonesAsync"/>.</param>
    Task<string> CreateCompositeAsync(
        IReadOnlyList<string> photoPaths,
        string templatePngPath,
        IReadOnlyList<PhotoZone> zones,
        string format,
        string compositesDirectory,
        int dpi = 300);

    /// <summary>
    /// Finalise une photo brute (sans template) dans le dossier composites : redimensionne
    /// si nécessaire (côté le plus long borné) et ré-encode en JPEG compressé.
    /// Retourne le chemin du composite généré.
    /// </summary>
    Task<string> CreateFromSinglePhotoAsync(
        string photoPath,
        string compositesDirectory,
        int maxDimension = 2400,
        int jpegQuality = 85);
}
