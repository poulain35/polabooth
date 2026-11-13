namespace PolaKiosk.Models.LocalDb;

public class SessionEntity
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }
    public DateTime CapturedAt { get; set; }
    public string PhotoPath { get; set; } = "";
    public string? CompositePath { get; set; }
    public bool ConsentGiven { get; set; }
    public bool Uploaded { get; set; } = false;
}
