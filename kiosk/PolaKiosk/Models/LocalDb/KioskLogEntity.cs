namespace PolaKiosk.Models.LocalDb;

public class KioskLogEntity
{
    public Guid     Id          { get; set; } = Guid.NewGuid();
    public string   MachineId   { get; set; } = "";
    /// <summary>error | warning | info</summary>
    public string   Level       { get; set; } = "error";
    /// <summary>camera | print | upload | sync | license | composite | app | task | startup…</summary>
    public string?  Context     { get; set; }
    public string   Message     { get; set; } = "";
    public string?  StackTrace  { get; set; }
    public string?  AppVersion  { get; set; }
    /// <summary>Événement actif à l'écriture (LAB-326), null sans événement.</summary>
    public Guid?    EventId     { get; set; }
    /// <summary>Séance photo en cours à l'écriture (LAB-326), null hors séance.</summary>
    public Guid?    SessionId   { get; set; }
    public DateTime OccurredAt  { get; set; } = DateTime.UtcNow;
    /// <summary>Envoyé au SaaS, ou à ne jamais envoyer (journal local seulement, LAB-326).</summary>
    public bool     Synced      { get; set; } = false;
}
