namespace PolaKiosk.Services;

/// <summary>Résultat d'une vérification de licence.</summary>
public enum LicenseStatus
{
    /// <summary>Validée en ligne, ou hors ligne par le cache signé encore dans sa période de grâce.</summary>
    Valid,
    /// <summary>Refusée par le serveur (borne retirée ou désactivée, secret inconnu) ou aucun secret : association requise.</summary>
    Refused,
    /// <summary>Serveur injoignable (réseau, délai, erreur HTTP) et pas de cache valide : rien n'est refusé, nouvel essai plus tard.</summary>
    Unverified,
}

public interface ILicenseService
{
    string MachineId { get; }
    string? LastError { get; }

    /// <summary>
    /// Vérification complète (démarrage, écran d'association) : en ligne d'abord, puis le cache signé si le
    /// serveur ne répond pas. Une licence valide envoie aussi le heartbeat et relit le PIN admin.
    /// </summary>
    Task<LicenseStatus> CheckAsync();

    /// <summary>
    /// Contrôle de fond : true seulement si le serveur a répondu que la licence est refusée. Une coupure
    /// réseau ou une erreur serveur rend false : elle ne renvoie jamais la borne à l'association.
    /// </summary>
    Task<bool> IsRefusedOnlineAsync();

    Task SendHeartbeatAsync();
}
