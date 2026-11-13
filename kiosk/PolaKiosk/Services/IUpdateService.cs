namespace PolaKiosk.Services;

/// <summary>
/// Mise à jour demandée pour cette borne depuis le SaaS (page Licences, « Mettre à jour »).
/// <paramref name="Sha256"/> = empreinte attendue de l'installeur (hex). <paramref name="RequestedAt"/> =
/// horodatage de la demande, tel que renvoyé par le serveur : une nouvelle demande en a un autre.
/// </summary>
public record UpdateRequest(string Version, string ExeUrl, string Sha256, string RequestedAt);

public interface IUpdateService
{
    /// <summary>Version installée.</summary>
    string CurrentVersion { get; }

    /// <summary>
    /// Demande de mise à jour en attente (RPC kiosk_get_update_request), ou null : aucune demande,
    /// version déjà installée, demande déjà en échec, données invalides (échec signalé) ou hors ligne.
    /// Signale d'abord au SaaS un échec pas encore remonté. Ne lève pas, sauf annulation par l'appelant.
    /// </summary>
    Task<UpdateRequest?> GetPendingRequestAsync(CancellationToken ct = default);

    /// <summary>
    /// Télécharge l'installeur (flux vers fichier), vérifie son SHA-256 puis lance apply-update.ps1.
    /// True = installation lancée, l'app doit se fermer. False = empreinte fausse, rien d'installé.
    /// Lève une exception si le téléchargement ou le lancement échoue (aucun verrou laissé).
    /// </summary>
    Task<bool> ApplyAsync(UpdateRequest request, CancellationToken ct = default);

    /// <summary>
    /// Enregistre l'échec de cette demande (plus aucun essai sans nouvelle demande) et le signale au SaaS
    /// (RPC kiosk_report_update_failure), à nouveau plus tard si le réseau manque. Ne lève jamais.
    /// </summary>
    Task ReportFailureAsync(UpdateRequest request, string error, CancellationToken ct = default);
}
