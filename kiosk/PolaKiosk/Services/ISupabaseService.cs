using PolaKiosk.Models;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

public interface ISupabaseService
{
    /// <summary>
    /// Événement par code d'accès via la RPC kiosk_get_event (machine + secret de la borne), ou null si le
    /// code ne correspond à aucun événement du compte de la borne. Lève <see cref="KioskLicenseRefusedException"/>
    /// si le serveur refuse la licence.
    /// </summary>
    Task<EventDto?> GetEventByCodeAsync(string accessCode, CancellationToken ct = default);

    /// <summary>
    /// Demande un code d'association (RPC kiosk_pairing_start) avec l'empreinte de la clé K. Lève
    /// <see cref="PairingRateLimitedException"/> si trop de codes ont été demandés depuis cette adresse.
    /// </summary>
    Task<PairingCode> StartPairingAsync(string machineName, string appVersion, string deviceKeyHash,
        CancellationToken ct = default);

    /// <summary>Suivi d'un code d'association (RPC kiosk_pairing_poll) avec la clé K en hexadécimal.</summary>
    Task<PairingPollResult> PollPairingAsync(Guid pairingId, string deviceKey, CancellationToken ct = default);

    /// <summary>
    /// Design approuvé d'un événement du compte de la borne (RPC kiosk_get_approved_design, licence vérifiée)
    /// sous forme de TemplateDto, ou null si absent. Licence refusée : <see cref="KioskLicenseRefusedException"/>.
    /// </summary>
    Task<TemplateDto?> GetApprovedDesignAsync(Guid eventId, CancellationToken ct = default);

    /// <summary>
    /// Écrans composés publiés par l'organisation de l'événement (RPC kiosk_get_screens, licence vérifiée,
    /// LAB-297) : le plan brut de l'accueil et du partage, avec les adresses complètes des images, ou null
    /// si rien n'est publié. Licence refusée : <see cref="KioskLicenseRefusedException"/>.
    /// </summary>
    Task<PublishedScreens> GetScreensAsync(Guid eventId, CancellationToken ct = default);

    /// <summary>
    /// Envoie le composite sur Cloudflare R2 (URL présignée de get-kiosk-upload-url) puis l'enregistre dans la
    /// table photos (kiosk_record_photo) avec <paramref name="capturedAtUtc"/>, l'heure de début de la séance
    /// (pas celle de l'envoi). Lève une exception si une étape échoue. Un renvoi de la même séance
    /// réutilise le même chemin R2 et la même ligne photos (pas de doublon).
    /// </summary>
    Task<(string PublicUrl, Guid PhotoId)> UploadPhotoAsync(Guid sessionId, Guid eventId, string compositePath,
        DateTime capturedAtUtc);

    /// <summary>
    /// Fiche contact du loueur (nom, téléphone, URL du logo) via la RPC get_org_contact_by_event
    /// (accessible anon). Null si la RPC échoue ou ne renvoie rien : la borne garde ce qu'elle a.
    /// </summary>
    Task<OrgContact?> GetOrgContactByEventAsync(Guid eventId, CancellationToken ct = default);

    /// <summary>Envoie la photo par email via la Edge Function send-kiosk-photo.</summary>
    Task SendKioskPhotoEmailAsync(Guid eventId, string to, string photoUrl);

    /// <summary>
    /// Envoie une impression (RPC kiosk_record_print, idempotente sur son id) : accepté si la RPC renvoie
    /// <c>true</c>, y compris pour un doublon. Un refus est rendu avec son code seulement ; une erreur réseau
    /// lève une exception.
    /// </summary>
    Task<PrintLogSendResult> RecordPrintAsync(PrintLogRecord record, CancellationToken ct = default);

    /// <summary>
    /// Envoie un lot de journaux (RPC kiosk_record_logs, 100 lignes au plus, idempotente sur l'id de chaque
    /// ligne) : toute réponse 2xx accepte le lot. Un refus est rendu avec son code seulement ; une erreur
    /// réseau lève une exception.
    /// </summary>
    Task<KioskLogSendResult> RecordLogsAsync(IReadOnlyList<KioskLogRecord> logs, CancellationToken ct = default);

    /// <summary>
    /// Dernier PIN admin envoyé à la borne depuis le SaaS (RPC kiosk_get_admin_pin), ou null si aucun.
    /// Lève une exception en cas d'erreur réseau ou serveur.
    /// </summary>
    Task<AdminPinHash?> GetAdminPinAsync(CancellationToken ct = default);

    /// <summary>
    /// Mise à jour demandée pour cette borne depuis le SaaS (RPC kiosk_get_update_request), ou null si aucune.
    /// Lève une exception en cas d'erreur réseau ou serveur.
    /// </summary>
    Task<UpdateRequest?> GetUpdateRequestAsync(CancellationToken ct = default);

    /// <summary>
    /// Signale au SaaS l'échec de la mise à jour demandée le <paramref name="requestedAt"/> (RPC
    /// kiosk_report_update_failure, message tronqué à 500 caractères). Lève une exception en cas d'erreur.
    /// </summary>
    Task ReportUpdateFailureAsync(string version, string? requestedAt, string error, CancellationToken ct = default);

    /// <summary>
    /// LAB-245 : événement envoyé sur cette borne depuis le SaaS (RPC kiosk_get_event_request), ou null
    /// sans envoi en attente. Lève <see cref="KioskLicenseRefusedException"/> si la licence est refusée, une
    /// autre exception en cas d'erreur réseau ou serveur.
    /// </summary>
    Task<EventPushRequest?> GetEventPushRequestAsync(CancellationToken ct = default);

    /// <summary>
    /// LAB-245 : confirme l'envoi du <paramref name="requestedAt"/> (RPC kiosk_ack_event_request) :
    /// événement affiché si <paramref name="error"/> est vide, sinon raison de l'échec (500 caractères au
    /// plus). Renvoie false si l'envoi a été annulé ou remplacé entre-temps. Lève une exception en cas d'erreur.
    /// </summary>
    Task<bool> AckEventPushAsync(Guid eventId, string requestedAt, string? error, CancellationToken ct = default);

    /// <summary>
    /// LAB-428 : réglages de l'appareil photo demandés depuis le SaaS (RPC kiosk_get_camera_request), ou
    /// null sans demande en attente. Lève <see cref="KioskLicenseRefusedException"/> si la licence est
    /// refusée, une autre exception en cas d'erreur réseau ou serveur.
    /// </summary>
    Task<CameraSettingsRequest?> GetCameraRequestAsync(CancellationToken ct = default);

    /// <summary>
    /// LAB-428 : résultat de la demande <paramref name="requestedAt"/> (RPC kiosk_ack_camera_request) :
    /// <paramref name="status"/> « applied » avec les valeurs relues sur l'appareil, ou « refused » avec
    /// la raison (500 caractères au plus). Renvoie false si la demande a été remplacée ou close entre-temps.
    /// </summary>
    Task<bool> AckCameraRequestAsync(string requestedAt, string status, CameraExposureValues? values, string? error,
        CancellationToken ct = default);

    /// <summary>
    /// Envoie une réponse au questionnaire (RPC kiosk_record_guest_response, idempotente sur son id).
    /// Un refus du serveur est rendu avec son code seulement ; une erreur réseau lève une exception.
    /// </summary>
    Task<GuestResponseSendResult> RecordGuestResponseAsync(GuestResponseRecord record, CancellationToken ct = default);

    /// <summary>
    /// Envoie un consentement photo (RPC kiosk_record_photo_consent, idempotente sur son id).
    /// Un refus du serveur est rendu avec son code seulement ; une erreur réseau lève une exception.
    /// </summary>
    Task<PhotoConsentSendResult> RecordPhotoConsentAsync(PhotoConsentRecord record, CancellationToken ct = default);

    /// <summary>Télécharge un fichier (Storage public) vers un chemin local.</summary>
    Task DownloadAssetAsync(string storageUrl, string localPath, CancellationToken ct = default);
}

/// <summary>Plans publiés des écrans composés (JSON brut du SaaS), null si rien n'est publié pour l'écran.</summary>
public sealed record PublishedScreens(Newtonsoft.Json.Linq.JObject? Home, Newtonsoft.Json.Linq.JObject? Result)
{
    public static PublishedScreens None { get; } = new(null, null);

    /// <summary>Plan publié d'un écran (<see cref="ScreenLayout.KindHome"/> ou <see cref="ScreenLayout.KindResult"/>).</summary>
    public Newtonsoft.Json.Linq.JObject? For(string kind) => kind == ScreenLayout.KindHome ? Home : Result;
}
