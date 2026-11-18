using System.IO;
using System.Net;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

/// <summary>Lecture des réponses des RPC et fonctions appelées par la borne, sans appel réseau (testée).</summary>
internal static class SupabaseRpcResponses
{
    /// <summary>Erreur 42501 (licence invalide) : PostgREST la rend en 401 pour le rôle anon, 403 sinon.</summary>
    internal static bool IsLicenseRefused(HttpStatusCode status, string body)
        => ParseRpcErrorCode(status, body) == "42501";

    /// <summary>
    /// Code d'une erreur PostgREST (<c>{"code":"22023",…}</c>), sinon « HTTP 503 ». Jamais le message :
    /// il pourrait contenir une donnée de la requête.
    /// </summary>
    internal static string ParseRpcErrorCode(HttpStatusCode status, string body)
    {
        try
        {
            if (JToken.Parse(body) is JObject error
                && error["code"] is JValue { Type: JTokenType.String } code
                && SafeErrorCode.IsMatch((string)code!))
                return (string)code!;
        }
        catch (JsonException) { /* corps non JSON : statut HTTP seul */ }
        return $"HTTP {(int)status}";
    }

    private static readonly System.Text.RegularExpressions.Regex SafeErrorCode = new("^[A-Za-z0-9]{1,16}$");

    /// <summary>Réponse RETURNS BOOLEAN : <c>true</c> seulement (tout autre corps n'est pas un accord).</summary>
    internal static bool IsTrueRpcResponse(string body)
    {
        try { return JToken.Parse(body) is JValue { Type: JTokenType.Boolean } value && (bool)value; }
        catch (JsonException) { return false; }
    }

    internal static PairingCode ParsePairingStart(string body)
    {
        var obj = JsonConvert.DeserializeObject<JObject>(body,
                      new JsonSerializerSettings { DateParseHandling = DateParseHandling.None })
                  ?? throw new InvalidDataException("Réponse de kiosk_pairing_start vide.");
        var id   = obj["pairing_id"]?.ToString();
        var code = obj["code"]?.ToString();
        var exp  = obj["expires_at"]?.ToString();
        if (!Guid.TryParse(id, out var pairingId) || string.IsNullOrWhiteSpace(code)
            || !DateTimeOffset.TryParse(exp, System.Globalization.CultureInfo.InvariantCulture,
                   System.Globalization.DateTimeStyles.AssumeUniversal, out var expiresAt))
            throw new InvalidDataException("Réponse de kiosk_pairing_start incomplète.");
        return new PairingCode(pairingId, code.Trim().ToUpperInvariant(), expiresAt);
    }

    internal static PairingPollResult ParsePairingPoll(string body)
    {
        var obj = JToken.Parse(body) as JObject
                  ?? throw new InvalidDataException("Réponse de kiosk_pairing_poll illisible.");
        var status = obj["status"]?.ToString() switch
        {
            "pending"     => PairingStatus.Pending,
            "expired"     => PairingStatus.Expired,
            "approved"    => PairingStatus.Approved,
            "delivered"   => PairingStatus.Delivered,
            "cancelled"   => PairingStatus.Cancelled,
            "not_found"   => PairingStatus.NotFound,
            "invalid_key" => PairingStatus.InvalidKey,
            _             => PairingStatus.Unknown,
        };
        if (status != PairingStatus.Approved) return new PairingPollResult(status);

        return new PairingPollResult(status,
            Secret:    Text(obj["secret"]),
            LicenseId: Guid.TryParse(obj["license_id"]?.ToString(), out var licenseId) ? licenseId : null,
            Label:     Text(obj["label"]),
            OrgName:   Text(obj["org_name"]),
            OrgId:     Guid.TryParse(obj["org_id"]?.ToString(), out var orgId) ? orgId : null);

        static string? Text(JToken? t)
            => t is JValue { Type: JTokenType.String } v && ((string)v!).Trim() is { Length: > 0 } s ? s : null;
    }

    /// <summary>Réponse de kiosk_get_event : un objet JSON, ou <c>null</c> si le code est inconnu.</summary>
    internal static EventDto? ParseEventRpcResponse(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        // Dates gardées en texte (start_date, end_date) : EventDto les lit avec leur fuseau.
        using var reader = new JsonTextReader(new StringReader(body)) { DateParseHandling = DateParseHandling.None };
        var token = JToken.ReadFrom(reader);
        return token.Type == JTokenType.Object ? token.ToObject<EventDto>() : null;
    }

    /// <summary>
    /// Réponse de kiosk_get_event_request : null sans envoi, sinon { requested_at, event } avec l'événement
    /// sous la forme de kiosk_get_event. requested_at est gardé tel quel pour être renvoyé à l'identique.
    /// </summary>
    internal static EventPushRequest? ParseEventPushResponse(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        using var reader = new JsonTextReader(new StringReader(body)) { DateParseHandling = DateParseHandling.None };
        if (JToken.ReadFrom(reader) is not JObject obj) return null;

        var requestedAt = obj["requested_at"]?.Type == JTokenType.String ? obj["requested_at"]!.Value<string>()!.Trim() : "";
        if (requestedAt.Length == 0 || obj["event"] is not JObject ev) return null;
        var dto = ev.ToObject<EventDto>();
        return dto == null || dto.Id == Guid.Empty ? null : new EventPushRequest(dto, requestedAt);
    }

    /// <summary>
    /// Réponse de kiosk_get_screens : <c>{home, result}</c>, chaque plan publié ou null. Une réponse
    /// vide ou d'une autre forme vaut « rien de publié » ; le plan lui-même est lu plus tard par
    /// <see cref="ScreenLayout.Parse(JToken?)"/>.
    /// </summary>
    internal static PublishedScreens ParseScreensRpcResponse(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return PublishedScreens.None;
        using var reader = new JsonTextReader(new StringReader(body)) { DateParseHandling = DateParseHandling.None };
        return JToken.ReadFrom(reader) is JObject obj
            ? new PublishedScreens(obj["home"] as JObject, obj["result"] as JObject)
            : PublishedScreens.None;
    }

    /// <summary>
    /// Réponse de get_org_contact_by_event. Null si ce n'est pas un objet (événement inconnu).
    /// logo_url absent ou vide : la société n'a pas de logo (LAB-257).
    /// </summary>
    internal static OrgContact? ParseOrgContact(string json)
    {
        if (JToken.Parse(json) is not JObject obj) return null;

        var company = (string?)obj["contact_company"] ?? (string?)obj["name"] ?? "";
        return new OrgContact(company, NullIfBlank((string?)obj["contact_phone"]), NullIfBlank((string?)obj["logo_url"]),
            NullIfBlank((string?)obj["contact_email"]));
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    /// <summary>Réponse de kiosk_get_admin_pin (RETURNS TABLE) : tableau vide si aucun PIN envoyé.</summary>
    internal static AdminPinHash? ParseAdminPinResponse(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        using var reader = new JsonTextReader(new StringReader(body)) { DateParseHandling = DateParseHandling.None };
        var token = JToken.ReadFrom(reader);
        var row = token is JArray { Count: > 0 } array ? array[0] : token as JObject;
        var hash = row?["pin_hash"]?.ToString();
        if (string.IsNullOrWhiteSpace(hash)) return null;

        DateTime? setAt = DateTime.TryParse(row!["pin_set_at"]?.ToString(), System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.RoundtripKind, out var d) ? d : null;
        return new AdminPinHash(hash, setAt);
    }

    /// <summary>
    /// Réponse de kiosk_get_update_request (RETURNS TABLE) : tableau vide sans demande en attente.
    /// requested_at est gardé tel quel (pas de conversion de date) pour être renvoyé à l'identique.
    /// </summary>
    internal static UpdateRequest? ParseUpdateRequestResponse(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        using var reader = new JsonTextReader(new StringReader(body)) { DateParseHandling = DateParseHandling.None };
        var token = JToken.ReadFrom(reader);
        var row = token is JArray { Count: > 0 } array ? array[0] : token as JObject;
        if (row == null) return null;

        string Field(string name) => row[name]?.Type == JTokenType.String ? row[name]!.Value<string>()!.Trim() : "";
        var version     = Field("version");
        var requestedAt = Field("requested_at");
        if (version.Length == 0 || requestedAt.Length == 0) return null;
        return new UpdateRequest(version, Field("exe_url"), Field("sha256").ToLowerInvariant(), requestedAt);
    }

    /// <summary>URL présignée et chemin R2 renvoyés par get-kiosk-upload-url.</summary>
    internal sealed record UploadTarget(string PresignedUrl, string StoragePath, string PublicUrl, string ContentType);

    /// <summary>Réponse de get-kiosk-upload-url ; lève une exception si un champ manque.</summary>
    internal static UploadTarget ParseUploadTarget(string body)
    {
        var obj = JObject.Parse(body);
        string Field(string name)
        {
            var value = obj[name]?.Type == JTokenType.String ? obj[name]!.Value<string>() : null;
            return string.IsNullOrWhiteSpace(value)
                ? throw new InvalidOperationException($"Réponse get-kiosk-upload-url incomplète : {name} manquant.")
                : value;
        }

        return new UploadTarget(Field("presigned_url"), Field("storage_path"), Field("public_url"), Field("content_type"));
    }

    /// <summary>Réponse de kiosk_record_photo : l'UUID de la photo, sérialisé en chaîne JSON.</summary>
    internal static Guid ParsePhotoIdRpcResponse(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return Guid.Empty;
        var token = JToken.Parse(body);
        return token.Type == JTokenType.String && Guid.TryParse(token.Value<string>(), out var id) ? id : Guid.Empty;
    }
}
