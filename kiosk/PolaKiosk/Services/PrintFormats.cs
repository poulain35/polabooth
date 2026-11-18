namespace PolaKiosk.Services;

/// <summary>
/// Format d'un tirage : canvas de l'éditeur SaaS (px), taille physique (mm) et papier envoyé à l'imprimante.
/// </summary>
public sealed record PrintFormat(string Key, int CanvasWidth, int CanvasHeight, float WidthMm, float HeightMm, string Paper)
{
    /// <summary>Zone couvrant tout le canvas (modèle sans zone photo, aperçus).</summary>
    public PhotoZone Canvas => new(0, 0, CanvasWidth, CanvasHeight);
}

/// <summary>Seule table des formats de tirage de la borne (LAB-401).</summary>
public static class PrintFormats
{
    public const string Default = "portrait";

    private static readonly Dictionary<string, PrintFormat> All = new()
    {
        ["portrait"]  = new("portrait",  400, 600, 100f, 150f, PrintSetupPlanner.SheetFormat),
        ["landscape"] = new("landscape", 600, 400, 150f, 100f, PrintSetupPlanner.SheetFormat),
        ["stripV"]    = new("stripV",    200, 600,  50f, 150f, PrintSetupPlanner.StripFormat),
        ["stripH"]    = new("stripH",    600, 200, 150f,  50f, PrintSetupPlanner.StripFormat),
    };

    /// <summary>Format connu, ou null.</summary>
    public static PrintFormat? Find(string? format)
        => format != null && All.TryGetValue(format, out var f) ? f : null;

    /// <summary>Format connu ; lève <see cref="ArgumentException"/> sinon (assemblage du tirage).</summary>
    public static PrintFormat Get(string format)
        => Find(format) ?? throw new ArgumentException($"Format inconnu : {format}");

    /// <summary>Format connu, sinon portrait (affichage).</summary>
    public static PrintFormat FindOrDefault(string? format) => Find(format) ?? All[Default];
}
