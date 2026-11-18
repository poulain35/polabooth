using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

/// <summary>
/// Design approuvé, autres cadres validés et écran d'accueil du client : même lecture pour la RPC
/// kiosk_get_approved_design et pour le fichier .pola (testée).
/// </summary>
internal static class ApprovedDesignReader
{
    /// <summary>Réponse de kiosk_get_approved_design : null sans design approuvé, sinon la ligne du design.</summary>
    internal static TemplateDto? ParseApprovedDesignRpcResponse(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        using var reader = new JsonTextReader(new StringReader(body)) { DateParseHandling = DateParseHandling.None };
        return JToken.ReadFrom(reader) is JObject obj && obj["id"]?.Type is JTokenType.String
            ? ParseApprovedDesign(obj)
            : null;
    }

    /// <summary>
    /// Ligne client_designs (id, format, canvas_json, final_png_url, label) : même lecture pour la
    /// synchro en ligne et pour le design embarqué dans un fichier .pola. L'écran d'accueil validé
    /// (home_design, LAB-291) est lu dans la réponse de la RPC ; le .pola le porte à sa racine.
    /// Les autres cadres validés (frames, LAB-315) sont lus de façon tolérante : un cadre sans id
    /// lisible ou sans PNG est ignoré, sans faire échouer le design principal.
    /// </summary>
    internal static TemplateDto ParseApprovedDesign(JToken d)
    {
        var design = ParseFrame(d, 1);
        design.HomeDesign = ParseHomeDesign(d["home_design"]);
        design.Frames     = ParseFrames(d["frames"], design.Id);
        return design;
    }

    /// <summary>Cadres proposés à l'invité au plus : le design principal et 3 autres.</summary>
    internal const int MaxFrames = 4;

    private static TemplateDto ParseFrame(JToken d, int fallbackSlot)
    {
        var slot = d["slot"] is { Type: JTokenType.Integer } s ? s.Value<long>() : fallbackSlot;
        return new TemplateDto
        {
            Id           = d["id"]!.ToObject<Guid>(),
            Name         = d["label"] is { Type: JTokenType.String } l && ((string?)l)?.Trim() is { Length: > 0 } label
                               ? label
                               : $"Cadre {slot}",
            Format       = d["format"]?.ToString() is { Length: > 0 } format ? format : "portrait",
            CanvasJson   = d["canvas_json"] is { Type: not JTokenType.Null } canvas ? canvas.ToString() : "{}",
            ThumbnailUrl = d["final_png_url"]?.Type == JTokenType.Null ? null : d["final_png_url"]?.ToString(),
        };
    }

    internal static List<TemplateDto> ParseFrames(JToken? token, Guid mainId)
    {
        var frames = new List<TemplateDto>();
        if (token is not JArray array) return frames;
        foreach (var item in array)
        {
            if (frames.Count >= MaxFrames - 1) break;
            if (item is not JObject frame
                || frame["id"]?.Type != JTokenType.String || !Guid.TryParse((string?)frame["id"], out var id)
                || id == Guid.Empty || id == mainId || frames.Any(f => f.Id == id)
                || frame["final_png_url"]?.Type != JTokenType.String
                || string.IsNullOrWhiteSpace((string?)frame["final_png_url"]))
                continue;
            frames.Add(ParseFrame(frame, frames.Count + 2));
        }
        return frames;
    }

    /// <summary>
    /// Écran d'accueil validé (<c>{ id, final_png_url }</c>), lu de façon tolérante : absent, null,
    /// sans id lisible ou sans URL, il vaut null (la borne garde alors l'accueil habituel).
    /// </summary>
    internal static HomeDesignDto? ParseHomeDesign(JToken? token)
        => token is JObject home
           && home["id"]?.Type == JTokenType.String && Guid.TryParse((string?)home["id"], out var id) && id != Guid.Empty
           && home["final_png_url"]?.Type == JTokenType.String && (string?)home["final_png_url"] is { } url
           && !string.IsNullOrWhiteSpace(url)
            ? new HomeDesignDto(id, url)
            : null;
}
