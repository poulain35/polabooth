namespace PolaKiosk.Models.LocalDb;

public class TemplateEntity
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }
    public string Name { get; set; } = "";
    public string Format { get; set; } = "";
    public string CanvasJson { get; set; } = "{}";
    public string? ThumbnailPath { get; set; }
}
