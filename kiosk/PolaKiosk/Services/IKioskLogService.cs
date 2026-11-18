namespace PolaKiosk.Services;

public interface IKioskLogService
{
    Task LogErrorAsync(string context, string message, string? stackTrace = null);
    Task LogWarningAsync(string context, string message);
    Task LogInfoAsync(string context, string message);

    /// <summary>
    /// Avertissement écrit au plus une fois par 24 h (même catégorie, même message), redémarrages compris
    /// (LAB-326) : pour un rappel répété à chaque lancement.
    /// </summary>
    Task LogWarningOncePerDayAsync(string context, string message);

    /// <summary>
    /// Journal écrit avant ce lancement (fatal.log, LAB-332) : identifiant et heure d'origine donnés par
    /// l'appelant, événement actif, sans séance. Enregistré en local seulement : il part avec la synchro
    /// habituelle. True si la ligne est en base (déjà présente comprise), false si l'écriture a échoué.
    /// </summary>
    Task<bool> RecordPastAsync(Guid id, string level, string context, string message, string? stackTrace,
        DateTime occurredAtUtc);

    /// <summary>Envoie les logs non synchronisés vers Supabase.</summary>
    Task UploadPendingAsync();
}
