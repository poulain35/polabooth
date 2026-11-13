using System.IO;
using Newtonsoft.Json;

namespace PolaKiosk.Services;

/// <summary>Contenu du fichier « .share.json » posé à côté d'un montage.</summary>
public record ShareInfo(Guid? SessionId, string? Url, Guid PhotoId)
{
    public bool IsShared => !string.IsNullOrEmpty(Url);
}

/// <summary>
/// Fichier compagnon d'un montage : identifiant de séance (dès le montage), puis URL publique et
/// photoId une fois l'envoi réussi. Permet de rouvrir la photo depuis la galerie avec la même séance.
/// </summary>
public static class ShareInfoFile
{
    public static string PathFor(string compositePath) => compositePath + ".share.json";

    public static ShareInfo? Read(string compositePath)
    {
        try
        {
            var path = PathFor(compositePath);
            if (!File.Exists(path)) return null;

            var dto = JsonConvert.DeserializeObject<Dto>(File.ReadAllText(path));
            if (dto == null) return null;

            Guid? sessionId = Guid.TryParse(dto.SessionId, out var s) ? s : null;
            var photoId = Guid.TryParse(dto.PhotoId, out var p) ? p : Guid.Empty;
            return new ShareInfo(sessionId, dto.Url, photoId);
        }
        catch { return null; }
    }

    public static void Write(string compositePath, ShareInfo info)
    {
        var dto = new Dto
        {
            SessionId = info.SessionId?.ToString(),
            Url       = info.Url,
            PhotoId   = info.PhotoId == Guid.Empty ? null : info.PhotoId.ToString(),
        };
        AtomicFile.WriteAllText(PathFor(compositePath), JsonConvert.SerializeObject(dto));
    }

    // Noms de propriétés identiques à l'ancien format ({ url, photoId }) : rétrocompatible.
    private class Dto
    {
        [JsonProperty("sessionId", NullValueHandling = NullValueHandling.Ignore)] public string? SessionId { get; set; }
        [JsonProperty("url", NullValueHandling = NullValueHandling.Ignore)]       public string? Url { get; set; }
        [JsonProperty("photoId", NullValueHandling = NullValueHandling.Ignore)]   public string? PhotoId { get; set; }
    }
}
