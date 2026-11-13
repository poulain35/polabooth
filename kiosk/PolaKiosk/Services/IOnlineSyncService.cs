namespace PolaKiosk.Services;

/// <summary>Travaux à faire quand le réseau est là. Aucune méthode ne lève d'exception.</summary>
public interface IOnlineSyncService
{
    /// <summary>Envois en attente : séances photo, réponses au questionnaire, journaux d'impression, journaux kiosk.</summary>
    Task UploadPendingAsync();

    /// <summary>
    /// Resynchronise la config de l'écran de saisie puis l'événement actif (s'il y en a un).
    /// Retourne false si la synchro est annulée ou échoue.
    /// </summary>
    Task<bool> ResyncAsync(CancellationToken ct = default);

    /// <summary>Au retour du réseau : envois en attente, resynchro, puis PIN admin. Un seul passage à la fois.</summary>
    Task RunAsync();
}
