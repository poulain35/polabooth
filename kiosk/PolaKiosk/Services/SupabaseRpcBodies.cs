using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

/// <summary>Corps JSON des RPC de la borne (noms = arguments SQL), sans appel réseau (testés).</summary>
internal static class SupabaseRpcBodies
{
    internal static string BuildGetEventBody(string accessCode, string machineId, string secret)
        => JsonConvert.SerializeObject(new { p_code = accessCode, p_machine_id = machineId, p_secret = secret });

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

    internal static string BuildScreensBody(string machineId, string secret, Guid eventId)
        => JsonConvert.SerializeObject(new { p_event_id = eventId, p_machine_id = machineId, p_secret = secret });

    internal static string BuildApprovedDesignBody(string machineId, string secret, Guid eventId)
        => JsonConvert.SerializeObject(new { p_machine_id = machineId, p_secret = secret, p_event_id = eventId });

    internal static string BuildCredentialsBody(string machineId, string secret)
        => JsonConvert.SerializeObject(new { p_machine_id = machineId, p_secret = secret });

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

    /// <summary>
    /// Paramètres de la RPC kiosk_ack_camera_request (noms = arguments SQL) : valeurs non nulles seulement
    /// (clés tv, av, iso, wb, kelvin), raison coupée à 500 caractères. requested_at renvoyé à l'identique.
    /// </summary>
    internal static string BuildCameraAckBody(string machineId, string secret, string requestedAt, string status,
        CameraExposureValues? values, string? error)
        => JsonConvert.SerializeObject(new
        {
            p_machine_id   = machineId,
            p_secret       = secret,
            p_requested_at = requestedAt,
            p_status       = status,
            p_values       = values == null ? null : CameraReport.Values(values),
            p_error        = string.IsNullOrWhiteSpace(error) ? null
                           : error.Length > MaxUpdateErrorLength ? error[..MaxUpdateErrorLength] : error,
        });

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
                event_id    = l.EventId,   // LAB-326 : null sans événement
                session_id  = l.SessionId, // null hors séance
            }),
        });

    // LAB-114 : la clé anon n'a plus d'accès direct à la table photos. La RPC SECURITY DEFINER
    // kiosk_record_photo vérifie la licence du poste, le couple (événement, code d'accès), le chemin R2
    // (dossier de l'événement) et l'URL publique, puis insère la ligne (source/status fixés serveur).
    // LAB-213 : un chemin déjà enregistré renvoie la ligne existante (pas de doublon au renvoi).
    // LAB-231 : p_captured_at = début de la séance (heure de la borne), pas l'heure d'envoi ; le serveur
    // met NULL une heure hors des bornes de l'événement (horloge déréglée).
    /// <summary>Paramètres de la RPC kiosk_record_photo (noms = arguments SQL).</summary>
    // LAB-237 : une animation ajoute p_media_type, p_thumbnail_path (affiche), p_duration_ms, p_width et
    // p_height ; une photo n'envoie que les paramètres d'avant (corps inchangé, défaut 'photo' côté SQL).
    internal static string BuildRecordPhotoBody(string accessCode, Guid eventId, string storagePath, string photoUrl,
        DateTime capturedAtUtc, string machineId, string secret, RecordedMedia? media = null)
    {
        var body = new JObject
        {
            ["p_code"]         = accessCode,
            ["p_event_id"]     = eventId,
            ["p_storage_path"] = storagePath,
            ["p_photo_url"]    = photoUrl,
            ["p_machine_id"]   = machineId,
            ["p_secret"]       = secret,
            ["p_captured_at"]  = ToUtcIso(capturedAtUtc),
        };
        if (media != null)
        {
            body["p_media_type"]     = media.MediaType;
            body["p_thumbnail_path"] = media.ThumbnailPath;
            body["p_duration_ms"]    = media.DurationMs;
            body["p_width"]          = media.Width;
            body["p_height"]         = media.Height;
        }
        return body.ToString(Formatting.None);
    }

    /// <summary>Paramètres d'une animation pour kiosk_record_photo (LAB-237). Largeur et hauteur : les deux ou aucune.</summary>
    internal sealed record RecordedMedia(string MediaType, string ThumbnailPath, int? DurationMs, int? Width, int? Height);

    /// <summary>
    /// Heure UTC à la milliseconde avec <c>Z</c>. SQLite rend les dates sans genre (Unspecified) : elles
    /// sont toujours écrites en UTC par la borne, donc lues comme telles.
    /// </summary>
    internal static string ToUtcIso(DateTime utc)
        => DateTime.SpecifyKind(utc, DateTimeKind.Utc)
            .ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
}
