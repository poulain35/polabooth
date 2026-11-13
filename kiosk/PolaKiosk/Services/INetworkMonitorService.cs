namespace PolaKiosk.Services;

public interface INetworkMonitorService
{
    bool IsOnline { get; }

    /// <summary>Déclenché quand la connectivité revient après une période hors ligne.</summary>
    event EventHandler NetworkRestored;

    /// <summary>Déclenché quand la connectivité est perdue.</summary>
    event EventHandler NetworkLost;

    /// <summary>
    /// Contrôle immédiat (ping Supabase, 5 s au plus) : met à jour <see cref="IsOnline"/>
    /// et lève les événements en cas de changement. Ne lève jamais d'exception.
    /// </summary>
    Task<bool> CheckNowAsync(CancellationToken ct = default);

    void Start();
    void Stop();
}
