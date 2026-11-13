namespace PolaKiosk.Models.LocalDb;

public class EventEntity
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string AccessCode { get; set; } = "";
    public string FormConfigJson { get; set; } = "{}";

    /// <summary>Début et fin de l'événement (LAB-250), affichés sur l'accueil. Null = pas de date.</summary>
    public DateTimeOffset? StartDate { get; set; }
    public DateTimeOffset? EndDate { get; set; }

    public DateTime SyncedAt { get; set; }
}
