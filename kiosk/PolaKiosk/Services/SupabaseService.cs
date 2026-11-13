using System.Net.Http;
using System.Net.Http.Headers;
using System.IO;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

public class SupabaseService : ISupabaseService
{
    private readonly HttpClient _http;
    private readonly string _supabaseUrl;
    private readonly string _anonKey;
    private readonly IKioskCredentials _credentials;
    private readonly IServiceScopeFactory _scopeFactory;

    // LAB-213 : envoi direct vers R2 par URL présignée, sans les en-têtes Supabase (apikey, Bearer) :
    // la signature de l'URL suffit et R2 n'a pas à recevoir la clé anon.
    private readonly HttpClient _r2;

    public SupabaseService(AppSettings settings, IKioskCredentials credentials, IServiceScopeFactory scopeFactory)
        : this(settings, credentials, scopeFactory, new HttpClientHandler()) { }

    // Tests : réponses HTTP simulées.
    internal SupabaseService(AppSettings settings, IKioskCredentials credentials, IServiceScopeFactory scopeFactory,
        HttpMessageHandler handler)
    {
        _supabaseUrl = settings.Supabase.Url.TrimEnd('/');
        _anonKey = settings.Supabase.AnonKey;
        _credentials = credentials;
        _scopeFactory = scopeFactory;

        _http = new HttpClient(handler);
        _http.DefaultRequestHeaders.Add("apikey", _anonKey);
        _http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", _anonKey);

        _r2 = new HttpClient(handler, disposeHandler: false);
    }

    // LAB-112 : la clé anon n'a plus de lecture directe sur la table events. Le code d'accès est
    // exigé par la RPC SECURITY DEFINER kiosk_get_event (pas de lecture par id : les id d'événement
    // sont visibles ailleurs, ex. table photos). LAB-242 : la licence de la borne aussi, et seuls les
    // événements de son compte sont renvoyés.
    public async Task<EventDto?> GetEventByCodeAsync(string accessCode, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_get_event",
            BuildGetEventBody(accessCode, _credentials.MachineId, _credentials.Secret), ct);
        if (!response.IsSuccessStatusCode && IsLicenseRefused(response.StatusCode, await ReadBodyAsync(response)))
            throw new KioskLicenseRefusedException();
        await EnsureSuccessOrThrowAsync(response, "Lecture de l'événement");
        return ParseEventRpcResponse(await response.Content.ReadAsStringAsync(ct));
    }

    internal static string BuildGetEventBody(string accessCode, string machineId, string secret)
        => JsonConvert.SerializeObject(new { p_code = accessCode, p_machine_id = machineId, p_secret = secret });

    /// <summary>Erreur 42501 (licence invalide) : PostgREST la rend en 401 pour le rôle anon, 403 sinon.</summary>
    internal static bool IsLicenseRefused(System.Net.HttpStatusCode status, string body)
        => ParseRpcErrorCode(status, body) == "42501";

    private static async Task<string> ReadBodyAsync(HttpResponseMessage response)
    {
        try { return await response.Content.ReadAsStringAsync(); }
        catch { return ""; }
    }

    // ── Association de la borne (LAB-242 / LAB-244) ───────────────────────────────

    public async Task<PairingCode> StartPairingAsync(string machineName, string appVersion, string deviceKeyHash,
        CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_pairing_start",
            BuildPairingStartBody(_credentials.MachineId, machineName, appVersion, deviceKeyHash), ct);
        if (!response.IsSuccessStatusCode
            && ((int)response.StatusCode == 429
                || ParseRpcErrorCode(response.StatusCode, await ReadBodyAsync(response)) == "PT429"))
            throw new PairingRateLimitedException();
        await EnsureSuccessOrThrowAsync(response, "Demande de code d'association");
        return ParsePairingStart(await response.Content.ReadAsStringAsync(ct));
    }

    internal static string BuildPairingStartBody(string machineId, string machineName, string appVersion, string deviceKeyHash)
        => JsonConvert.SerializeObject(new
        {
            p_machine_id      = machineId,
            p_machine_name    = Truncate(machineName, 200),
            p_app_version     = Truncate(appVersion, 50),
            p_device_key_hash = deviceKeyHash,
        });

    private static string Truncate(string? value, int max)
    {
        var v = (value ?? "").Trim();
        return v.Length > max ? v[..max] : v;
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

    public async Task<PairingPollResult> PollPairingAsync(Guid pairingId, string deviceKey, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_pairing_poll",
            JsonConvert.SerializeObject(new { p_pairing_id = pairingId, p_device_key = deviceKey }), ct);
        await EnsureSuccessOrThrowAsync(response, "Suivi de l'association");
        return ParsePairingPoll(await response.Content.ReadAsStringAsync(ct));
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

    // LAB-246 : la clé publique ne lit plus client_designs ; la RPC vérifie la licence de la borne
    // et ne renvoie que le design d'un événement de son compte.
    public async Task<TemplateDto?> GetApprovedDesignAsync(Guid eventId, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_get_approved_design",
            BuildApprovedDesignBody(_credentials.MachineId, _credentials.Secret, eventId), ct);
        if (!response.IsSuccessStatusCode && IsLicenseRefused(response.StatusCode, await ReadBodyAsync(response)))
            throw new KioskLicenseRefusedException();
        await EnsureSuccessOrThrowAsync(response, "Lecture du design approuvé");
        return ParseApprovedDesignRpcResponse(await response.Content.ReadAsStringAsync(ct));
    }

    internal static string BuildApprovedDesignBody(string machineId, string secret, Guid eventId)
        => JsonConvert.SerializeObject(new { p_machine_id = machineId, p_secret = secret, p_event_id = eventId });

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
    /// Ligne client_designs (id, format, canvas_json, final_png_url) : même lecture pour la synchro
    /// en ligne et pour le design embarqué dans un fichier .pola.
    /// </summary>
    internal static TemplateDto ParseApprovedDesign(JToken d) => new()
    {
        Id           = d["id"]!.ToObject<Guid>(),
        Name         = "Design client",
        Format       = d["format"]?.ToString() is { Length: > 0 } format ? format : "portrait",
        CanvasJson   = d["canvas_json"] is { Type: not JTokenType.Null } canvas ? canvas.ToString() : "{}",
        ThumbnailUrl = d["final_png_url"]?.Type == JTokenType.Null ? null : d["final_png_url"]?.ToString(),
    };

    /// <summary>
    /// Envoie le montage sur Cloudflare R2 puis l'enregistre dans la table photos (LAB-213) :
    /// 1. URL PUT présignée demandée à get-kiosk-upload-url (licence + code d'accès vérifiés) ;
    /// 2. PUT du fichier sur R2 ;
    /// 3. enregistrement par kiosk_record_photo avec le chemin R2 et l'heure de début de la séance.
    /// Chaque étape fait partie de l'envoi : un échec lève une exception et la séance reste en attente.
    /// Le chemin R2 dépend de la séance : un renvoi écrase le même objet et retrouve la même ligne photos.
    /// Retourne l'URL publique R2 et l'ID Supabase de la photo.
    /// </summary>
    public async Task<(string PublicUrl, Guid PhotoId)> UploadPhotoAsync(Guid sessionId, Guid eventId, string compositePath,
        DateTime capturedAtUtc)
    {
        if (!File.Exists(compositePath))
            throw new FileNotFoundException("Composite introuvable.", compositePath);

        var accessCode = await GetLocalAccessCodeAsync(eventId);
        var fileBytes = await File.ReadAllBytesAsync(compositePath);

        // 1. URL d'envoi R2
        var target = await RequestUploadUrlAsync(accessCode, eventId, sessionId, Path.GetFileName(compositePath), fileBytes.Length);

        // 2. Envoi du fichier (type et taille liés à la signature)
        using (var content = new ByteArrayContent(fileBytes))
        {
            content.Headers.ContentType = new MediaTypeHeaderValue(target.ContentType);
            using var putResponse = await _r2.PutAsync(target.PresignedUrl, content);
            await EnsureSuccessOrThrowAsync(putResponse, "Envoi R2 photo");
        }

        // 3. Enregistrement dans la table photos : sans lui, la photo n'apparaît ni dans la galerie
        //    ni via le QR. Un échec laisse la séance en attente, elle sera renvoyée.
        using var response = await PostRpcAsync("kiosk_record_photo", BuildRecordPhotoBody(
            accessCode, eventId, target.StoragePath, target.PublicUrl, capturedAtUtc, _credentials.MachineId, _credentials.Secret));
        await EnsureSuccessOrThrowAsync(response, "Enregistrement photo");
        var photoId = ParsePhotoIdRpcResponse(await response.Content.ReadAsStringAsync());

        return (target.PublicUrl, photoId);
    }

    /// <summary>URL présignée et chemin R2 renvoyés par get-kiosk-upload-url.</summary>
    internal sealed record UploadTarget(string PresignedUrl, string StoragePath, string PublicUrl, string ContentType);

    private async Task<UploadTarget> RequestUploadUrlAsync(string accessCode, Guid eventId, Guid sessionId, string fileName, long length)
    {
        var url = $"{_supabaseUrl}/functions/v1/get-kiosk-upload-url";
        var body = JsonConvert.SerializeObject(new
        {
            access_code    = accessCode,
            event_id       = eventId,
            machine_id     = _credentials.MachineId,
            secret         = _credentials.Secret,
            session_id     = sessionId,
            filename       = fileName,
            content_length = length,
        });
        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        using var response = await _http.PostAsync(url, content);
        await EnsureSuccessOrThrowAsync(response, "URL d'envoi photo");
        return ParseUploadTarget(await response.Content.ReadAsStringAsync());
    }

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

    private async Task<string> GetLocalAccessCodeAsync(Guid eventId)
    {
        string? accessCode;
        using (var scope = _scopeFactory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            accessCode = (await db.Events.FindAsync(eventId))?.AccessCode;
        }
        if (string.IsNullOrWhiteSpace(accessCode))
            throw new InvalidOperationException($"Code d'accès inconnu localement pour l'événement {eventId}.");
        return accessCode;
    }

    // Lève une exception détaillée (statut HTTP + corps de réponse) au lieu du message
    // générique de EnsureSuccessStatusCode, pour que les logs kiosk remontent la vraie cause.
    private static async Task EnsureSuccessOrThrowAsync(HttpResponseMessage response, string context)
    {
        if (response.IsSuccessStatusCode) return;

        string body = "";
        try { body = await response.Content.ReadAsStringAsync(); } catch { }
        if (body.Length > 500) body = body[..500];

        throw new HttpRequestException(
            $"{context} : {(int)response.StatusCode} {response.ReasonPhrase}. {body}".Trim(),
            null, response.StatusCode);
    }

    public async Task<OrgContact?> GetOrgContactByEventAsync(Guid eventId, CancellationToken ct = default)
    {
        // RPC SECURITY DEFINER → accessible par l'anon key sans exposer la table organizations
        var url  = $"{_supabaseUrl}/rest/v1/rpc/get_org_contact_by_event";
        var body = System.Text.Json.JsonSerializer.Serialize(new { p_event_id = eventId });

        using var content = new System.Net.Http.StringContent(body, System.Text.Encoding.UTF8, "application/json");
        using var response = await _http.PostAsync(url, content, ct);
        if (!response.IsSuccessStatusCode) return null;

        return ParseOrgContact(await response.Content.ReadAsStringAsync(ct));
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

    /// <summary>Appelle une fonction Postgres (RPC) via PostgREST. Le caller lit/dispose la réponse.</summary>
    public async Task<HttpResponseMessage> PostRpcAsync(string functionName, string jsonBody, CancellationToken ct = default)
    {
        var url = $"{_supabaseUrl}/rest/v1/rpc/{functionName}";
        using var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        return await _http.PostAsync(url, content, ct);
    }

    // LAB-197 : PIN admin de la borne, renvoyé une fois « envoyé » depuis le SaaS (page Licences).
    public async Task<AdminPinHash?> GetAdminPinAsync(CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_get_admin_pin", JsonConvert.SerializeObject(new
        {
            p_machine_id = _credentials.MachineId,
            p_secret     = _credentials.Secret,
        }), ct);
        await EnsureSuccessOrThrowAsync(response, "Lecture du PIN admin");
        return ParseAdminPinResponse(await response.Content.ReadAsStringAsync(ct));
    }

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

    // LAB-200 : la borne ne se met à jour que sur demande depuis le SaaS (page Licences, « Mettre à jour »).
    public async Task<UpdateRequest?> GetUpdateRequestAsync(CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_get_update_request", JsonConvert.SerializeObject(new
        {
            p_machine_id = _credentials.MachineId,
            p_secret     = _credentials.Secret,
        }), ct);
        await EnsureSuccessOrThrowAsync(response, "Lecture de la demande de mise à jour");
        return ParseUpdateRequestResponse(await response.Content.ReadAsStringAsync(ct));
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

    public async Task ReportUpdateFailureAsync(string version, string? requestedAt, string error, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_report_update_failure",
            BuildUpdateFailureBody(_credentials.MachineId, _credentials.Secret, version, requestedAt, error), ct);
        await EnsureSuccessOrThrowAsync(response, "Signalement de l'échec de mise à jour");
    }

    internal const int MaxUpdateErrorLength = 500;

    /// <summary>Paramètres de la RPC kiosk_report_update_failure (noms = arguments SQL).</summary>
    internal static string BuildUpdateFailureBody(string machineId, string secret, string version, string? requestedAt, string error)
        => JsonConvert.SerializeObject(new
        {
            p_machine_id   = machineId,
            p_secret       = secret,
            p_version      = version,
            p_error        = error.Length > MaxUpdateErrorLength ? error[..MaxUpdateErrorLength] : error,
            p_requested_at = requestedAt,
        });

    // LAB-245 : événement envoyé sur la borne depuis le SaaS (fiche événement ou page Licences).
    public async Task<EventPushRequest?> GetEventPushRequestAsync(CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_get_event_request",
            BuildCredentialsBody(_credentials.MachineId, _credentials.Secret), ct);
        if (!response.IsSuccessStatusCode && IsLicenseRefused(response.StatusCode, await ReadBodyAsync(response)))
            throw new KioskLicenseRefusedException();
        await EnsureSuccessOrThrowAsync(response, "Lecture de l'événement envoyé");
        return ParseEventPushResponse(await response.Content.ReadAsStringAsync(ct));
    }

    internal static string BuildCredentialsBody(string machineId, string secret)
        => JsonConvert.SerializeObject(new { p_machine_id = machineId, p_secret = secret });

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

    public async Task<bool> AckEventPushAsync(Guid eventId, string requestedAt, string? error, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_ack_event_request",
            BuildEventPushAckBody(_credentials.MachineId, _credentials.Secret, eventId, requestedAt, error), ct);
        if (!response.IsSuccessStatusCode && IsLicenseRefused(response.StatusCode, await ReadBodyAsync(response)))
            throw new KioskLicenseRefusedException();
        await EnsureSuccessOrThrowAsync(response, "Confirmation de l'événement envoyé");
        var body = (await response.Content.ReadAsStringAsync(ct)).Trim();
        return string.Equals(body, "true", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Paramètres de la RPC kiosk_ack_event_request (noms = arguments SQL).</summary>
    internal static string BuildEventPushAckBody(string machineId, string secret, Guid eventId, string requestedAt, string? error)
        => JsonConvert.SerializeObject(new
        {
            p_machine_id   = machineId,
            p_secret       = secret,
            p_event_id     = eventId,
            p_error        = string.IsNullOrWhiteSpace(error) ? null
                           : error.Length > MaxUpdateErrorLength ? error[..MaxUpdateErrorLength] : error,
            p_requested_at = requestedAt,
        });

    // LAB-225 : réponse au questionnaire, même contrôle de licence que kiosk_record_photo. Le corps
    // d'une erreur n'est jamais remonté (il pourrait citer une donnée) : seul son code l'est.
    public async Task<GuestResponseSendResult> RecordGuestResponseAsync(GuestResponseRecord record, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_record_guest_response",
            BuildGuestResponseBody(record, _credentials.MachineId, _credentials.Secret), ct);
        if (response.IsSuccessStatusCode) return GuestResponseSendResult.Ok;

        string body = "";
        try { body = await response.Content.ReadAsStringAsync(ct); } catch { }
        return GuestResponseSendResult.Rejected(ParseRpcErrorCode(response.StatusCode, body));
    }

    /// <summary>Paramètres de la RPC kiosk_record_guest_response (noms = arguments SQL).</summary>
    internal static string BuildGuestResponseBody(GuestResponseRecord r, string machineId, string secret)
        => JsonConvert.SerializeObject(new
        {
            p_code              = r.AccessCode,
            p_event_id          = r.EventId,
            p_machine_id        = machineId,
            p_secret            = secret,
            p_response_id       = r.Id,
            p_answered_at       = ToUtcIso(r.AnsweredAtUtc),
            p_answers           = r.Answers,
            p_questions         = r.Questions,
            p_marketing_consent = r.MarketingConsent,
            p_consent_text      = r.ConsentText,
            p_notice_hash       = r.NoticeHash,
            p_session_ids       = r.SessionIds,
        });

    public async Task<PhotoConsentSendResult> RecordPhotoConsentAsync(PhotoConsentRecord record, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_record_photo_consent",
            BuildPhotoConsentBody(record, _credentials.MachineId, _credentials.Secret), ct);
        if (response.IsSuccessStatusCode) return PhotoConsentSendResult.Ok;

        string body = "";
        try { body = await response.Content.ReadAsStringAsync(ct); } catch { }
        return PhotoConsentSendResult.Rejected(ParseRpcErrorCode(response.StatusCode, body));
    }

    /// <summary>Paramètres de la RPC kiosk_record_photo_consent (noms = arguments SQL).</summary>
    internal static string BuildPhotoConsentBody(PhotoConsentRecord r, string machineId, string secret)
        => JsonConvert.SerializeObject(new
        {
            p_code         = r.AccessCode,
            p_event_id     = r.EventId,
            p_machine_id   = machineId,
            p_secret       = secret,
            p_consent_id   = r.Id,
            p_session_id   = r.SessionId,
            p_consented_at = ToUtcIso(r.ConsentedAtUtc),
            p_consent_text = r.ConsentText,
        });

    private static readonly System.Text.RegularExpressions.Regex SafeErrorCode = new("^[A-Za-z0-9]{1,16}$");

    /// <summary>
    /// Code d'une erreur PostgREST (<c>{"code":"22023",…}</c>), sinon « HTTP 503 ». Jamais le message :
    /// il pourrait contenir une donnée de la requête.
    /// </summary>
    internal static string ParseRpcErrorCode(System.Net.HttpStatusCode status, string body)
    {
        try
        {
            if (JToken.Parse(body) is JObject error
                && error["code"] is JValue { Type: JTokenType.String } code
                && SafeErrorCode.IsMatch((string)code!))
                return (string)code!;
        }
        catch (JsonException) { }
        return $"HTTP {(int)status}";
    }

    public async Task DownloadAssetAsync(string storageUrl, string localPath, CancellationToken ct = default)
    {
        var bytes = await _http.GetByteArrayAsync(storageUrl, ct);
        Directory.CreateDirectory(Path.GetDirectoryName(localPath)!);
        await File.WriteAllBytesAsync(localPath, bytes, ct);
    }

    public async Task SendKioskPhotoEmailAsync(Guid eventId, string to, string photoUrl)
    {
        var url  = $"{_supabaseUrl}/functions/v1/send-kiosk-photo";
        var body = JsonConvert.SerializeObject(new { event_id = eventId, to, photo_url = photoUrl });
        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        var response = await _http.PostAsync(url, content);
        if (!response.IsSuccessStatusCode)
        {
            var err = await response.Content.ReadAsStringAsync();
            throw new Exception($"Envoi échoué ({(int)response.StatusCode}) : {err}");
        }
    }

    // LAB-230 : plus d'INSERT anon sur print_logs. La RPC vérifie la licence et le couple
    // (événement, code) et renvoie true aussi pour une impression déjà enregistrée (ON CONFLICT (id)).
    public async Task<PrintLogSendResult> RecordPrintAsync(PrintLogRecord record, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_record_print",
            BuildRecordPrintBody(record, _credentials.MachineId, _credentials.Secret), ct);

        string body = "";
        try { body = await response.Content.ReadAsStringAsync(ct); } catch { }
        if (!response.IsSuccessStatusCode)
            return PrintLogSendResult.Rejected(ParseRpcErrorCode(response.StatusCode, body));
        return IsTrueRpcResponse(body) ? PrintLogSendResult.Ok : PrintLogSendResult.Rejected(PrintLogSendResult.UnexpectedBodyCode);
    }

    /// <summary>Paramètres de la RPC kiosk_record_print (noms = arguments SQL).</summary>
    internal static string BuildRecordPrintBody(PrintLogRecord r, string machineId, string secret)
        => JsonConvert.SerializeObject(new
        {
            p_code       = r.AccessCode,
            p_event_id   = r.EventId,
            p_id         = r.Id,
            p_session_id = r.SessionId,
            p_copies     = r.Copies,
            p_printed_at = ToUtcIso(r.PrintedAtUtc),
            p_machine_id = machineId,
            p_secret     = secret,
        });

    // LAB-278 : plus d'INSERT anon sur kiosk_logs. La RPC vérifie la licence, limite le débit par borne
    // (PT429), borne les champs et ignore un id déjà reçu (ON CONFLICT (id) DO NOTHING). Elle renvoie le
    // nombre de lignes insérées : un lot de doublons peut renvoyer 0 et reste un succès.
    public async Task<KioskLogSendResult> RecordLogsAsync(IReadOnlyList<KioskLogRecord> logs, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_record_logs",
            BuildRecordLogsBody(logs, _credentials.MachineId, _credentials.Secret), ct);
        if (response.IsSuccessStatusCode) return KioskLogSendResult.Ok;

        string body = "";
        try { body = await response.Content.ReadAsStringAsync(ct); } catch { }
        return KioskLogSendResult.Rejected(ParseRpcErrorCode(response.StatusCode, body));
    }

    /// <summary>Paramètres de la RPC kiosk_record_logs (noms = arguments SQL ; machine_id jamais dans les lignes).</summary>
    internal static string BuildRecordLogsBody(IReadOnlyList<KioskLogRecord> logs, string machineId, string secret)
        => JsonConvert.SerializeObject(new
        {
            p_machine_id = machineId,
            p_secret     = secret,
            p_logs       = logs.Select(l => new
            {
                id          = l.Id,
                level       = l.Level,
                context     = l.Context,
                message     = l.Message,
                stack_trace = l.StackTrace,
                app_version = l.AppVersion,
                occurred_at = ToUtcIso(l.OccurredAtUtc),
            }),
        });

    /// <summary>Réponse RETURNS BOOLEAN : <c>true</c> seulement (tout autre corps n'est pas un accord).</summary>
    internal static bool IsTrueRpcResponse(string body)
    {
        try { return JToken.Parse(body) is JValue { Type: JTokenType.Boolean } value && (bool)value; }
        catch (JsonException) { return false; }
    }

    // LAB-114 : la clé anon n'a plus d'accès direct à la table photos. La RPC SECURITY DEFINER
    // kiosk_record_photo vérifie la licence du poste, le couple (événement, code d'accès), le chemin R2
    // (dossier de l'événement) et l'URL publique, puis insère la ligne (source/status fixés serveur).
    // LAB-213 : un chemin déjà enregistré renvoie la ligne existante (pas de doublon au renvoi).
    // LAB-231 : p_captured_at = début de la séance (heure de la borne), pas l'heure d'envoi ; le serveur
    // met NULL une heure hors des bornes de l'événement (horloge déréglée).
    /// <summary>Paramètres de la RPC kiosk_record_photo (noms = arguments SQL).</summary>
    internal static string BuildRecordPhotoBody(string accessCode, Guid eventId, string storagePath, string photoUrl,
        DateTime capturedAtUtc, string machineId, string secret)
        => JsonConvert.SerializeObject(new
        {
            p_code         = accessCode,
            p_event_id     = eventId,
            p_storage_path = storagePath,
            p_photo_url    = photoUrl,
            p_machine_id   = machineId,
            p_secret       = secret,
            p_captured_at  = ToUtcIso(capturedAtUtc),
        });

    /// <summary>
    /// Heure UTC à la milliseconde avec <c>Z</c>. SQLite rend les dates sans genre (Unspecified) : elles
    /// sont toujours écrites en UTC par la borne, donc lues comme telles.
    /// </summary>
    internal static string ToUtcIso(DateTime utc)
        => DateTime.SpecifyKind(utc, DateTimeKind.Utc)
            .ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>Réponse de kiosk_record_photo : l'UUID de la photo, sérialisé en chaîne JSON.</summary>
    internal static Guid ParsePhotoIdRpcResponse(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return Guid.Empty;
        var token = JToken.Parse(body);
        return token.Type == JTokenType.String && Guid.TryParse(token.Value<string>(), out var id) ? id : Guid.Empty;
    }
}
