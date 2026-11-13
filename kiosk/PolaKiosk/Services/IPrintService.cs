namespace PolaKiosk.Services;

public interface IPrintService
{
    /// <summary>
    /// Envoie le composite à l'imprimante. Le compteur et le journal locaux sont écrits à l'envoi
    /// (imprimante vérifiée), avant d'attendre la fin de l'impression : une impression qui dépasse
    /// le délai reste comptée. Lève <see cref="PrintBusyException"/> tant que le travail précédent
    /// n'est pas terminé, <see cref="TimeoutException"/> si l'imprimante ne répond pas dans le délai.
    /// Ne vérifie pas les plafonds : l'appelant passe d'abord par <see cref="CanPrintAsync"/>.
    /// </summary>
    Task PrintAsync(string compositePath, string printerName, string paperFormat, Guid sessionId, Guid eventId,
        int copies = 1, string? compositeUrl = null, string? machineId = null);

    Task<int> GetSessionPrintCountAsync(Guid sessionId);
    Task<int> GetEventPrintCountAsync(Guid eventId);

    /// <summary>Impressions encore autorisées (le plus petit des deux plafonds), ou null si aucun plafond.</summary>
    Task<int?> GetRemainingPrintsAsync(Guid eventId, int? maxPrintsPerEvent, Guid sessionId, int? maxPrintsPerPhoto);

    Task<bool> CanPrintAsync(Guid eventId, int? maxPrintsPerEvent, Guid sessionId, int? maxPrintsPerPhoto);

    /// <summary>Liste les imprimantes disponibles sur le système.</summary>
    List<string> GetAvailablePrinters();

    /// <summary>Nom de l'imprimante par défaut de Windows (chaîne vide si aucune).</summary>
    string GetDefaultPrinterName();

    /// <summary>État matériel de l'imprimante : ready | offline | paper_out | paper_jam | error | not_found | unknown.</summary>
    string GetPrinterStatus(string? printerName);
}
