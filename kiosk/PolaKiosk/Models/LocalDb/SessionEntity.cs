namespace PolaKiosk.Models.LocalDb;

public class SessionEntity
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }
    public DateTime CapturedAt { get; set; }
    public string PhotoPath { get; set; } = "";
    public string? CompositePath { get; set; }
    public bool Uploaded { get; set; } = false;

    /// <summary>Cadre du montage (LAB-315) : la réimpression depuis la galerie reprend son papier.</summary>
    public Guid? TemplateId { get; set; }
}
