using PolaKiosk.Models.LocalDb;

namespace PolaKiosk.Services;

public interface ISessionService
{
    /// <summary>
    /// Enregistre la séance dès que le montage est terminé (Uploaded = false) et mémorise son
    /// identifiant dans le .share.json du montage. <paramref name="capturedAtUtc"/> : début de la
    /// séance, envoyé tel quel à kiosk_record_photo, même des heures plus tard (LAB-231).
    /// <paramref name="stageInSameTransaction"/> ajoute au contexte ce qui s'écrit avec la séance
    /// (consentement photo, LAB-223). <paramref name="templateId"/> : cadre appliqué au montage
    /// (LAB-315), null pour une photo seule. <paramref name="animation"/> : clip et affiche d'un GIF
    /// (LAB-237), envoyés à la place du montage, qui reste celui de l'impression. Retourne l'identifiant de séance.
    /// </summary>
    Task<Guid> RecordSessionAsync(Guid sessionId, Guid eventId, DateTime capturedAtUtc,
        string photoPath, string compositePath, Action<AppDbContext>? stageInSameTransaction = null,
        Guid? templateId = null, AnimationClip? animation = null);

    /// <summary>
    /// Valide une photo en attente (questionnaire obligatoire) : une transaction écrit la séance
    /// avec ses chemins définitifs et ce que <paramref name="stageInSameTransaction"/> ajoute au
    /// contexte (réponse, LAB-225 ; consentement photo, LAB-223), puis les fichiers passent de <c>pending\{sessionId}\</c> à
    /// <c>originals\</c> et <c>composites\</c>. <paramref name="capturedAtUtc"/> : début de la séance
    /// (avant le questionnaire), pas l'heure de validation. <paramref name="animation"/> (chemins du dossier
    /// d'attente) suit les fichiers : la séance garde les chemins définitifs. Retourne le chemin du montage à afficher.
    /// Ne lève pas : un échec d'écriture est journalisé et l'écran résultat rattache la séance.
    /// </summary>
    Task<string> CommitPendingSessionAsync(Guid sessionId, Guid eventId, string eventName,
        DateTime capturedAtUtc, string photoPath, string compositePath, Action<AppDbContext>? stageInSameTransaction = null,
        Guid? templateId = null, AnimationClip? animation = null);

    /// <summary>
    /// Supprime le dossier d'attente d'une séance abandonnée (poses et montage). Ne lève pas :
    /// false si un fichier est verrouillé, le nettoyage du démarrage le reprendra.
    /// </summary>
    bool DiscardPendingSession(Guid sessionId);

    /// <summary>
    /// Au démarrage, avant tout envoi : termine le déplacement des séances validées (séance en
    /// base), supprime les autres dossiers d'attente. Journalise des nombres seulement. Ne lève pas.
    /// </summary>
    Task<PendingCleanupResult> CleanupPendingAsync();

    /// <summary>
    /// Garantit qu'une séance existe pour ce montage (photo rouverte depuis la galerie, montage
    /// remplacé par sa version avec effet). Sans effet si tout est déjà en place.
    /// </summary>
    Task AttachCompositeAsync(Guid sessionId, Guid eventId, string compositePath);

    /// <summary>
    /// Envoie la séance (R2 + kiosk_record_photo) si ce n'est pas déjà fait, puis la marque envoyée :
    /// le montage d'une photo, le clip et son affiche d'un GIF (LAB-237). Un seul envoi à la fois par
    /// séance ; deux séances différentes partent en parallèle (un clip lent ne retient pas le QR suivant).
    /// Lève une exception si l'envoi échoue : la séance reste en attente. Refus définitif du serveur
    /// (22023) : <see cref="MediaRecordRejectedException"/>, séance retirée de la file, fichiers gardés.
    /// </summary>
    Task<(string PublicUrl, Guid PhotoId)> UploadSessionAsync(Guid sessionId);

    /// <summary>Identifiant de séance d'un montage rouvert depuis la galerie (stable d'une ouverture à l'autre).</summary>
    Task<Guid> ResolveSessionIdAsync(string compositePath);

    /// <summary>Cadre appliqué au montage de la séance (LAB-315) ; null si inconnu (photo seule, séance d'avant le choix).</summary>
    Task<Guid?> GetSessionTemplateIdAsync(Guid sessionId);

    /// <summary>
    /// Renvoie toutes les séances en attente, les photos avant les animations (plus lourdes). Ne lève
    /// jamais. Retourne le nombre envoyées.
    /// </summary>
    Task<int> UploadPendingSessionsAsync();
}

/// <summary>Bilan du nettoyage des photos en attente au démarrage.</summary>
public sealed record PendingCleanupResult(int Completed, int Discarded, int Failed);
