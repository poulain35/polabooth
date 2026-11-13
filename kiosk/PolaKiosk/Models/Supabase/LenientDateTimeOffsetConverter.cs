using System.Globalization;
using Newtonsoft.Json;

namespace PolaKiosk.Models.Supabase;

/// <summary>
/// Date facultative venue du SaaS (timestamptz) : une valeur absente, vide ou illisible donne null
/// au lieu de faire échouer la lecture de tout l'événement. Une date sans fuseau est lue en UTC.
/// </summary>
public class LenientDateTimeOffsetConverter : JsonConverter<DateTimeOffset?>
{
    public override DateTimeOffset? ReadJson(JsonReader reader, Type objectType, DateTimeOffset? existingValue,
        bool hasExistingValue, JsonSerializer serializer)
        => reader.Value switch
        {
            DateTimeOffset dto => dto,
            DateTime dt        => new DateTimeOffset(dt.Kind == DateTimeKind.Unspecified
                                      ? DateTime.SpecifyKind(dt, DateTimeKind.Utc) : dt),
            string text        => Parse(text),
            _                  => SkipAndNull(reader),
        };

    public override void WriteJson(JsonWriter writer, DateTimeOffset? value, JsonSerializer serializer)
    {
        if (value is { } v) writer.WriteValue(v.ToString("o", CultureInfo.InvariantCulture));
        else writer.WriteNull();
    }

    internal static DateTimeOffset? Parse(string? text)
        => DateTimeOffset.TryParse(text?.Trim(), CultureInfo.InvariantCulture,
               DateTimeStyles.AssumeUniversal, out var value) ? value : null;

    // Objet ou tableau à la place d'une date : on le saute en entier.
    private static DateTimeOffset? SkipAndNull(JsonReader reader)
    {
        reader.Skip();
        return null;
    }
}
