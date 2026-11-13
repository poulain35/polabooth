namespace PolaKiosk.Models.LocalDb;

public class PrintLogEntity
{
    public Guid     Id           { get; set; } = Guid.NewGuid();
    public Guid     EventId      { get; set; }
    public Guid     SessionId    { get; set; }
    public string?  CompositeUrl { get; set; }
    public int      Copies       { get; set; } = 1;
    public string?  MachineId    { get; set; }
    public DateTime PrintedAt    { get; set; } = DateTime.UtcNow;
    public bool     Synced       { get; set; } = false;
}
