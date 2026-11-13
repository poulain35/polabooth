namespace PolaKiosk.Models.LocalDb;

public class KioskLogEntity
{
    public Guid     Id          { get; set; } = Guid.NewGuid();
    public string   MachineId   { get; set; } = "";
    /// <summary>error | warning | info</summary>
    public string   Level       { get; set; } = "error";
    /// <summary>camera | print | upload | sync | license | composite | app | task</summary>
    public string?  Context     { get; set; }
    public string   Message     { get; set; } = "";
    public string?  StackTrace  { get; set; }
    public string?  AppVersion  { get; set; }
    public DateTime OccurredAt  { get; set; } = DateTime.UtcNow;
    public bool     Synced      { get; set; } = false;
}
