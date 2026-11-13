namespace PolaKiosk.Services;

/// <summary>
/// Compte les reprises après une erreur d'affichage. Au-delà de <c>maxPerWindow</c> reprises sur
/// la fenêtre glissante, l'erreur se répète en boucle : mieux vaut quitter et laisser le watchdog relancer.
/// </summary>
public class RecoveryLimiter
{
    private readonly int _maxPerWindow;
    private readonly TimeSpan _window;
    private readonly Queue<DateTime> _recent = new();
    private readonly object _gate = new();

    public RecoveryLimiter(int maxPerWindow, TimeSpan window)
    {
        _maxPerWindow = maxPerWindow;
        _window       = window;
    }

    /// <summary>Enregistre une reprise ; false si la limite est dépassée.</summary>
    public bool TryRecover(DateTime now)
    {
        lock (_gate)
        {
            while (_recent.Count > 0 && now - _recent.Peek() > _window)
                _recent.Dequeue();
            _recent.Enqueue(now);
            return _recent.Count <= _maxPerWindow;
        }
    }
}
