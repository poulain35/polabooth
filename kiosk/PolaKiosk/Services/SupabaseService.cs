using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.IO;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using static PolaKiosk.Services.ApprovedDesignReader;
using static PolaKiosk.Services.SupabaseRpcBodies;
using static PolaKiosk.Services.SupabaseRpcResponses;

namespace PolaKiosk.Services;

public class SupabaseService : ISupabaseService
{
    private readonly HttpClient _http;
    private readonly string _supabaseUrl;
    private readonly string _anonKey;
    private readonly IKioskCredentials _credentials;
    private readonly IServiceScopeFactory _scopeFactory;

    // Sans les en-têtes Supabase (apikey, Bearer) : téléchargement d'un fichier hébergé ailleurs que sur
    // Supabase (LAB-394).
    private readonly HttpClient _external;

    // Envois sur R2 par URL présignée, sans en-têtes Supabase non plus (la signature suffit, LAB-213).
    // Délai par requête selon la taille du fichier (UploadTimeout, LAB-237), pas les
    // 100 s par défaut du HttpClient, trop courtes pour un clip sur une 4G faible.
    private readonly HttpClient _upload;

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

        _external = new HttpClient(handler, disposeHandler: false);
        _upload   = new HttpClient(handler, disposeHandler: false) { Timeout = Timeout.InfiniteTimeSpan };
    }

    /// <summary>Taille maximale d'un fichier téléchargé (fond, logo, image ou police d'un écran, cadre).</summary>
    internal const long MaxAssetBytes = 50L * 1024 * 1024;

    internal const string AssetTooLargeMessage = "Fichier trop volumineux (plus de 50 Mo) : téléchargement refusé.";

    // LAB-112 : la clé anon n'a plus de lecture directe sur la table events. Le code d'accès est
    // exigé par la RPC SECURITY DEFINER kiosk_get_event (pas de lecture par id : les id d'événement
    // sont visibles ailleurs, ex. table photos). LAB-242 : la licence de la borne aussi, et seuls les
    // événements de son compte sont renvoyés.
    public Task<EventDto?> GetEventByCodeAsync(string accessCode, CancellationToken ct = default)
        => CallRpcAsync("kiosk_get_event", BuildGetEventBody(accessCode, _credentials.MachineId, _credentials.Secret),
            "Lecture de l'événement", ParseEventRpcResponse, ct, LicenseRefusal);

    private static Exception? LicenseRefusal(HttpStatusCode status, string body)
        => IsLicenseRefused(status, body) ? new KioskLicenseRefusedException() : null;

    private static async Task<string> ReadBodyAsync(HttpResponseMessage response, CancellationToken ct = default)
    {
        try { return await response.Content.ReadAsStringAsync(ct); }
        catch { return ""; }
    }

    /// <summary>Code de l'erreur d'une réponse RPC en échec (jamais son message, voir <see cref="ParseRpcErrorCode"/>).</summary>
    private static async Task<string> ReadRpcErrorCodeAsync(HttpResponseMessage response, CancellationToken ct)
        => ParseRpcErrorCode(response.StatusCode, await ReadBodyAsync(response, ct));

    /// <summary>
    /// Appel RPC dont l'échec lève une exception : <paramref name="refusal"/> peut d'abord changer une
    /// réponse en erreur en exception propre (licence refusée, débit dépassé) ; sinon
    /// <see cref="HttpRequestException"/> détaillée (<paramref name="context"/>, statut, corps). Rend le corps.
    /// </summary>
    private async Task<string> CallRpcAsync(string functionName, string jsonBody, string context, CancellationToken ct,
        Func<HttpStatusCode, string, Exception?>? refusal = null)
    {
        using var response = await PostRpcAsync(functionName, jsonBody, ct);
        if (!response.IsSuccessStatusCode && refusal?.Invoke(response.StatusCode, await ReadBodyAsync(response)) is { } refused)
            throw refused;
        await EnsureSuccessOrThrowAsync(response, context);
        return await response.Content.ReadAsStringAsync(ct);
    }

    /// <summary>Appel RPC comme ci-dessus, puis lecture du corps par <paramref name="parse"/>.</summary>
    private async Task<T> CallRpcAsync<T>(string functionName, string jsonBody, string context, Func<string, T> parse,
        CancellationToken ct, Func<HttpStatusCode, string, Exception?>? refusal = null)
        => parse(await CallRpcAsync(functionName, jsonBody, context, ct, refusal));

    /// <summary>Appelle une Edge Function Supabase (POST JSON). L'appelant lit et libère la réponse.</summary>
    private async Task<HttpResponseMessage> PostFunctionAsync(string functionName, string jsonBody, CancellationToken ct = default)
    {
        using var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        return await _http.PostAsync($"{_supabaseUrl}/functions/v1/{functionName}", content, ct);
    }

    // ── Association de la borne (LAB-242 / LAB-244) ───────────────────────────────

    public Task<PairingCode> StartPairingAsync(string machineName, string appVersion, string deviceKeyHash,
        CancellationToken ct = default)
        => CallRpcAsync("kiosk_pairing_start",
            BuildPairingStartBody(_credentials.MachineId, machineName, appVersion, deviceKeyHash),
            "Demande de code d'association", ParsePairingStart, ct,
            (status, body) => (int)status == 429 || ParseRpcErrorCode(status, body) == "PT429"
                ? new PairingRateLimitedException() : null);

    public Task<PairingPollResult> PollPairingAsync(Guid pairingId, string deviceKey, CancellationToken ct = default)
        => CallRpcAsync("kiosk_pairing_poll",
            JsonConvert.SerializeObject(new { p_pairing_id = pairingId, p_device_key = deviceKey }),
            "Suivi de l'association", ParsePairingPoll, ct);

    // LAB-246 : la clé publique ne lit plus client_designs ; la RPC vérifie la licence de la borne
    // et ne renvoie que le design d'un événement de son compte.
    public Task<TemplateDto?> GetApprovedDesignAsync(Guid eventId, CancellationToken ct = default)
        => CallRpcAsync("kiosk_get_approved_design", BuildApprovedDesignBody(_credentials.MachineId, _credentials.Secret, eventId),
            "Lecture du design approuvé", ParseApprovedDesignRpcResponse, ct, LicenseRefusal);

    public Task<PublishedScreens> GetScreensAsync(Guid eventId, CancellationToken ct = default)
        => CallRpcAsync("kiosk_get_screens", BuildScreensBody(_credentials.MachineId, _credentials.Secret, eventId),
            "Lecture des écrans de la borne", ParseScreensRpcResponse, ct, LicenseRefusal);

    /// <summary>
    /// Envoie le montage sur Cloudflare R2 puis l'enregistre dans la table photos (LAB-213) :
    /// 1. URL PUT présignée demandée à get-kiosk-upload-url (licence + code d'accès vérifiés) ;
    /// 2. PUT du fichier sur R2, en flux ;
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
        var length = new FileInfo(compositePath).Length;

        // 1. URL d'envoi R2
        var target = await RequestUploadUrlAsync(accessCode, eventId, sessionId, Path.GetFileName(compositePath), length);

        // 2. Envoi du fichier (type et taille liés à la signature)
        await PutFileAsync(target, compositePath, length, video: false, "Envoi R2 photo");

        // 3. Enregistrement dans la table photos : sans lui, la photo n'apparaît ni dans la galerie
        //    ni via le QR. Un échec laisse la séance en attente, elle sera renvoyée.
        var photoId = await CallRpcAsync("kiosk_record_photo", BuildRecordPhotoBody(
                accessCode, eventId, target.StoragePath, target.PublicUrl, capturedAtUtc, _credentials.MachineId, _credentials.Secret),
            "Enregistrement photo", ParsePhotoIdRpcResponse, CancellationToken.None, MediaRefusal);

        return (target.PublicUrl, photoId);
    }

    /// <summary>
    /// Envoie l'animation d'une séance GIF (LAB-237) : affiche (<c>kind = poster</c>, toujours
    /// <c>{séance}/poster.jpg</c>), puis clip MP4 (<c>kind = media</c>), chacun en flux par son URL
    /// présignée, puis une seule ligne photos (<c>media_type = gif</c>, affiche, durée, taille). Même
    /// séance = mêmes chemins R2 et même ligne au renvoi.
    /// </summary>
    public async Task<(string PublicUrl, Guid PhotoId)> UploadAnimationAsync(Guid sessionId, Guid eventId, AnimationClip clip,
        DateTime capturedAtUtc)
    {
        if (!File.Exists(clip.VideoPath))  throw new FileNotFoundException("Clip introuvable.", clip.VideoPath);
        if (!File.Exists(clip.PosterPath)) throw new FileNotFoundException("Affiche introuvable.", clip.PosterPath);

        var accessCode   = await GetLocalAccessCodeAsync(eventId);
        var posterLength = new FileInfo(clip.PosterPath).Length;
        var videoLength  = new FileInfo(clip.VideoPath).Length;

        var poster = await RequestUploadUrlAsync(accessCode, eventId, sessionId, AnimationService.PosterFileName,
            posterLength, UploadKindPoster);
        await PutFileAsync(poster, clip.PosterPath, posterLength, video: false, "Envoi R2 affiche");

        var video = await RequestUploadUrlAsync(accessCode, eventId, sessionId, AnimationService.VideoFileName,
            videoLength, UploadKindMedia);
        await PutFileAsync(video, clip.VideoPath, videoLength, video: true, "Envoi R2 animation");

        var sized = clip is { Width: > 0, Height: > 0 };
        var media = new RecordedMedia(SessionMediaType.Gif, poster.StoragePath,
            clip.DurationMs > 0 ? clip.DurationMs : null,
            sized ? clip.Width : null,
            sized ? clip.Height : null);
        var photoId = await CallRpcAsync("kiosk_record_photo", BuildRecordPhotoBody(
                accessCode, eventId, video.StoragePath, video.PublicUrl, capturedAtUtc, _credentials.MachineId,
                _credentials.Secret, media),
            "Enregistrement animation", ParsePhotoIdRpcResponse, CancellationToken.None, MediaRefusal);

        return (video.PublicUrl, photoId);
    }

    internal const string UploadKindMedia  = "media";
    internal const string UploadKindPoster = "poster";

    // 22023 : donnée refusée, définitif. Licence ou événement (P0001), réseau : la séance reste en attente.
    private static Exception? MediaRefusal(HttpStatusCode status, string body)
        => ParseRpcErrorCode(status, body) == MediaRecordRejectedException.InvalidDataCode
            ? new MediaRecordRejectedException(MediaRecordRejectedException.InvalidDataCode) : null;

    /// <summary>
    /// Délai d'un envoi sur R2 selon la taille (LAB-237) : 32 Ko/s au moins (4G faible), jamais moins de
    /// 100 s pour une image (ancien délai du HttpClient) ni de 10 min pour un clip, une heure au plus.
    /// </summary>
    internal static TimeSpan UploadTimeout(long bytes, bool video)
    {
        var minimum  = video ? TimeSpan.FromMinutes(10) : TimeSpan.FromSeconds(100);
        var bySize   = TimeSpan.FromSeconds(Math.Max(0, bytes) / (32.0 * 1024));
        var duration = bySize > minimum ? bySize : minimum;
        return duration > TimeSpan.FromHours(1) ? TimeSpan.FromHours(1) : duration;
    }

    // PUT en flux (jamais le fichier entier en mémoire), taille annoncée = taille signée.
    private async Task PutFileAsync(UploadTarget target, string path, long length, bool video, string context)
    {
        var delay = UploadTimeout(length, video);
        using var timeout = new CancellationTokenSource(delay);
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        using var content = new StreamContent(stream, 81920);
        content.Headers.ContentType   = new MediaTypeHeaderValue(target.ContentType);
        content.Headers.ContentLength = length;
        try
        {
            using var putResponse = await _upload.PutAsync(target.PresignedUrl, content, timeout.Token);
            await EnsureSuccessOrThrowAsync(putResponse, context);
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
            throw new TimeoutException($"{context} : délai de {delay.TotalSeconds:0} s dépassé.");
        }
    }

    private async Task<UploadTarget> RequestUploadUrlAsync(string accessCode, Guid eventId, Guid sessionId, string fileName,
        long length, string? kind = null)
    {
        // Sans kind (photo) : corps identique à avant LAB-237.
        var request = new JObject
        {
            ["access_code"]    = accessCode,
            ["event_id"]       = eventId,
            ["machine_id"]     = _credentials.MachineId,
            ["secret"]         = _credentials.Secret,
            ["session_id"]     = sessionId,
            ["filename"]       = fileName,
            ["content_length"] = length,
        };
        if (kind != null) request["kind"] = kind;
        using var response = await PostFunctionAsync("get-kiosk-upload-url", request.ToString(Formatting.None));
        await EnsureSuccessOrThrowAsync(response, "URL d'envoi photo");
        return ParseUploadTarget(await response.Content.ReadAsStringAsync());
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
        try { body = await response.Content.ReadAsStringAsync(); } catch { /* corps illisible : statut seul */ }
        if (body.Length > 500) body = body[..500];

        throw new HttpRequestException(
            $"{context} : {(int)response.StatusCode} {response.ReasonPhrase}. {body}".Trim(),
            null, response.StatusCode);
    }

    public async Task<OrgContact?> GetOrgContactByEventAsync(Guid eventId, CancellationToken ct = default)
    {
        // RPC SECURITY DEFINER → accessible par l'anon key sans exposer la table organizations
        using var response = await PostRpcAsync("get_org_contact_by_event",
            JsonConvert.SerializeObject(new { p_event_id = eventId }), ct);
        if (!response.IsSuccessStatusCode) return null;

        return ParseOrgContact(await response.Content.ReadAsStringAsync(ct));
    }

    /// <summary>Appelle une fonction Postgres (RPC) via PostgREST. Le caller lit/dispose la réponse.</summary>
    public async Task<HttpResponseMessage> PostRpcAsync(string functionName, string jsonBody, CancellationToken ct = default)
    {
        var url = $"{_supabaseUrl}/rest/v1/rpc/{functionName}";
        using var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        return await _http.PostAsync(url, content, ct);
    }

    // LAB-197 : PIN admin de la borne, renvoyé une fois « envoyé » depuis le SaaS (page Licences).
    public Task<AdminPinHash?> GetAdminPinAsync(CancellationToken ct = default)
        => CallRpcAsync("kiosk_get_admin_pin", BuildCredentialsBody(_credentials.MachineId, _credentials.Secret),
            "Lecture du PIN admin", ParseAdminPinResponse, ct);

    // LAB-200 : la borne ne se met à jour que sur demande depuis le SaaS (page Licences, « Mettre à jour »).
    public Task<UpdateRequest?> GetUpdateRequestAsync(CancellationToken ct = default)
        => CallRpcAsync("kiosk_get_update_request", BuildCredentialsBody(_credentials.MachineId, _credentials.Secret),
            "Lecture de la demande de mise à jour", ParseUpdateRequestResponse, ct);

    public Task ReportUpdateFailureAsync(string version, string? requestedAt, string error, CancellationToken ct = default)
        => CallRpcAsync("kiosk_report_update_failure",
            BuildUpdateFailureBody(_credentials.MachineId, _credentials.Secret, version, requestedAt, error),
            "Signalement de l'échec de mise à jour", ct);

    // LAB-245 : événement envoyé sur la borne depuis le SaaS (fiche événement ou page Licences).
    public Task<EventPushRequest?> GetEventPushRequestAsync(CancellationToken ct = default)
        => CallRpcAsync("kiosk_get_event_request", BuildCredentialsBody(_credentials.MachineId, _credentials.Secret),
            "Lecture de l'événement envoyé", ParseEventPushResponse, ct, LicenseRefusal);

    public Task<bool> AckEventPushAsync(Guid eventId, string requestedAt, string? error, CancellationToken ct = default)
        => CallRpcAsync("kiosk_ack_event_request",
            BuildEventPushAckBody(_credentials.MachineId, _credentials.Secret, eventId, requestedAt, error),
            "Confirmation de l'événement envoyé",
            body => string.Equals(body.Trim(), "true", StringComparison.OrdinalIgnoreCase), ct, LicenseRefusal);

    // LAB-428 : réglages de l'appareil photo demandés depuis le SaaS (Bornes › État › Appareil photo).
    public Task<CameraSettingsRequest?> GetCameraRequestAsync(CancellationToken ct = default)
        => CallRpcAsync("kiosk_get_camera_request", BuildCredentialsBody(_credentials.MachineId, _credentials.Secret),
            "Lecture des réglages de l'appareil demandés", ParseCameraRequestResponse, ct, LicenseRefusal);

    public Task<bool> AckCameraRequestAsync(string requestedAt, string status, CameraExposureValues? values, string? error,
        CancellationToken ct = default)
        => CallRpcAsync("kiosk_ack_camera_request",
            BuildCameraAckBody(_credentials.MachineId, _credentials.Secret, requestedAt, status, values, error),
            "Confirmation des réglages de l'appareil",
            body => string.Equals(body.Trim(), "true", StringComparison.OrdinalIgnoreCase), ct, LicenseRefusal);

    // LAB-225 : réponse au questionnaire, même contrôle de licence que kiosk_record_photo. Le corps
    // d'une erreur n'est jamais remonté (il pourrait citer une donnée) : seul son code l'est.
    public async Task<GuestResponseSendResult> RecordGuestResponseAsync(GuestResponseRecord record, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_record_guest_response",
            BuildGuestResponseBody(record, _credentials.MachineId, _credentials.Secret), ct);
        return response.IsSuccessStatusCode
            ? GuestResponseSendResult.Ok
            : GuestResponseSendResult.Rejected(await ReadRpcErrorCodeAsync(response, ct));
    }

    public async Task<PhotoConsentSendResult> RecordPhotoConsentAsync(PhotoConsentRecord record, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_record_photo_consent",
            BuildPhotoConsentBody(record, _credentials.MachineId, _credentials.Secret), ct);
        return response.IsSuccessStatusCode
            ? PhotoConsentSendResult.Ok
            : PhotoConsentSendResult.Rejected(await ReadRpcErrorCodeAsync(response, ct));
    }

    /// <summary>
    /// Fichier téléchargé en flux, au plus <see cref="MaxAssetBytes"/>, puis substitué au fichier final
    /// (jamais de fichier à moitié écrit). Les en-têtes Supabase ne partent que vers le Supabase de la borne.
    /// </summary>
    public async Task DownloadAssetAsync(string storageUrl, string localPath, CancellationToken ct = default)
    {
        var client = IsSupabaseUrl(storageUrl) ? _http : _external;
        using var response = await client.GetAsync(storageUrl, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > MaxAssetBytes)
            throw new FileTooLargeException(AssetTooLargeMessage);

        await using var input = new BoundedReadStream(await response.Content.ReadAsStreamAsync(ct), MaxAssetBytes,
            AssetTooLargeMessage);
        await AtomicFile.WriteAsync(localPath, (output, c) => input.CopyToAsync(output, c), ct);
    }

    /// <summary>Même schéma, même hôte et même port que l'adresse Supabase de la borne.</summary>
    internal bool IsSupabaseUrl(string url)
        => Uri.TryCreate(url, UriKind.Absolute, out var uri)
           && Uri.TryCreate(_supabaseUrl, UriKind.Absolute, out var supabase)
           && Uri.Compare(uri, supabase, UriComponents.SchemeAndServer, UriFormat.Unescaped,
                  StringComparison.OrdinalIgnoreCase) == 0;

    public async Task SendKioskPhotoEmailAsync(Guid eventId, string to, string photoUrl)
    {
        var body = JsonConvert.SerializeObject(new { event_id = eventId, to, photo_url = photoUrl });
        using var response = await PostFunctionAsync("send-kiosk-photo", body);
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

        var body = await ReadBodyAsync(response, ct);
        if (!response.IsSuccessStatusCode)
            return PrintLogSendResult.Rejected(ParseRpcErrorCode(response.StatusCode, body));
        return IsTrueRpcResponse(body) ? PrintLogSendResult.Ok : PrintLogSendResult.Rejected(PrintLogSendResult.UnexpectedBodyCode);
    }

    // LAB-278 : plus d'INSERT anon sur kiosk_logs. La RPC vérifie la licence, limite le débit par borne
    // (PT429), borne les champs et ignore un id déjà reçu (ON CONFLICT (id) DO NOTHING). Elle renvoie le
    // nombre de lignes insérées : un lot de doublons peut renvoyer 0 et reste un succès.
    public async Task<KioskLogSendResult> RecordLogsAsync(IReadOnlyList<KioskLogRecord> logs, CancellationToken ct = default)
    {
        using var response = await PostRpcAsync("kiosk_record_logs",
            BuildRecordLogsBody(logs, _credentials.MachineId, _credentials.Secret), ct);
        return response.IsSuccessStatusCode
            ? KioskLogSendResult.Ok
            : KioskLogSendResult.Rejected(await ReadRpcErrorCodeAsync(response, ct));
    }
}
