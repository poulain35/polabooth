using PolaKiosk.Models.LocalDb;

namespace PolaKiosk.Services;

public interface ISessionService
{
    /// <summary>
    /// Enregistre la séance dès que le montage est terminé (Uploaded = false) et mémorise son
    /// identifiant dans le .share.json du montage. <paramref name="capturedAtUtc"/> : début de la
    /// séance, envoyé tel quel à kiosk_record_photo, même des heures plus tard (LAB-231).
    /// <paramref name="stageInSameTransaction"/> ajoute au contexte ce qui s'écrit avec la séance
    /// (consentement photo, LAB-223). Retourne l'identifiant de séance.
    /// </summary>
    Task<Guid> RecordSessionAsync(Guid sessionId, Guid eventId, DateTime capturedAtUtc,
        string photoPath, string compositePath, Action<AppDbContext>? stageInSameTransaction = null);

    /// <summary>
    /// Valide une photo en attente (questionnaire obligatoire) : une transaction écrit la séance
    /// avec ses chemins définitifs et ce que <paramref name="stageInSameTransaction"/> ajoute au
    /// contexte (réponse, LAB-225 ; consentement photo, LAB-223), puis les fichiers passent de <c>pending\{sessionId}\</c> à
    /// <c>originals\</c> et <c>composites\</c>. <paramref name="capturedAtUtc"/> : début de la séance
    /// (avant le questionnaire), pas l'heure de validation. Retourne le chemin du montage à afficher.
    /// Ne lève pas : un échec d'écriture est journalisé et l'écran résultat rattache la séance.
    /// </summary>
    Task<string> CommitPendingSessionAsync(Guid sessionId, Guid eventId, string eventName,
        DateTime capturedAtUtc, string photoPath, string compositePath, Action<AppDbContext>? stageInSameTransaction = null);

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
    /// Envoie la séance (R2 + kiosk_record_photo) si ce n'est pas déjà fait, puis la marque envoyée.
    /// Lève une exception si l'envoi échoue : la séance reste en attente.
    /// </summary>
    Task<(string PublicUrl, Guid PhotoId)> UploadSessionAsync(Guid sessionId);

    /// <summary>Identifiant de séance d'un montage rouvert depuis la galerie (stable d'une ouverture à l'autre).</summary>
    Task<Guid> ResolveSessionIdAsync(string compositePath);

    /// <summary>Renvoie toutes les séances en attente. Ne lève jamais. Retourne le nombre envoyées.</summary>
    Task<int> UploadPendingSessionsAsync();
}

/// <summary>Bilan du nettoyage des photos en attente au démarrage.</summary>
public sealed record PendingCleanupResult(int Completed, int Discarded, int Failed);
