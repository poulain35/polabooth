namespace PolaKiosk.Services;

/// <summary>Bilan d'un passage d'envoi des impressions : des nombres seulement.</summary>
public sealed record PrintLogSendSummary(int Sent, int Failed, int Skipped, int Rejected = 0)
{
    public static readonly PrintLogSendSummary None = new(0, 0, 0);
}

/// <summary>
/// File des impressions (table locale PrintLogs) envoyée par la RPC kiosk_record_print (LAB-230).
/// Le compteur contractuel local (PrintCounts, PrintLogs) n'est jamais modifié ici : seul
/// <c>Synced</c> passe à true quand la RPC répond <c>true</c>, ou sur un refus définitif
/// (<c>22023</c>) pour sortir la ligne de la file sans toucher au compteur.
/// </summary>
public interface IPrintLogSyncService
{
    /// <summary>
    /// Envoie les impressions non envoyées, de la plus ancienne à la plus récente. Un seul passage à la
    /// fois : un appel pendant un passage en cours rend la main sans rien envoyer (la boucle de 2 minutes
    /// reprend la file). Une erreur réseau arrête le passage ; un refus d'identification ou une erreur serveur
    /// laisse la ligne pour le cycle suivant ; un refus définitif (<c>22023</c>) la sort de la file.
    /// </summary>
    Task<PrintLogSendSummary> SendPendingAsync();

    /// <summary>
    /// Essai d'envoi en arrière-plan juste après une impression, si la borne est en ligne. Ne bloque pas
    /// et ne lève jamais : une erreur est journalisée.
    /// </summary>
    void SendSoon();
}
