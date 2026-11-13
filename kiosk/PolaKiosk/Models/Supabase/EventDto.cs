using Newtonsoft.Json;

namespace PolaKiosk.Models.Supabase;

public class EventDto
{
    [JsonProperty("id")]
    public Guid Id { get; set; }

    [JsonProperty("org_id")]
    public Guid OrgId { get; set; }

    [JsonProperty("name")]
    public string Name { get; set; } = "";

    [JsonProperty("access_code")]
    public string AccessCode { get; set; } = "";

    /// <summary>Début de l'événement (timestamptz, LAB-250). Null si absent ou illisible.</summary>
    [JsonProperty("start_date")]
    [JsonConverter(typeof(LenientDateTimeOffsetConverter))]
    public DateTimeOffset? StartDate { get; set; }

    /// <summary>Fin de l'événement (timestamptz, LAB-250). Null si absente ou illisible.</summary>
    [JsonProperty("end_date")]
    [JsonConverter(typeof(LenientDateTimeOffsetConverter))]
    public DateTimeOffset? EndDate { get; set; }

    [JsonProperty("form_config")]
    public KioskConfigDto? FormConfig { get; set; }
}
