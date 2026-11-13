namespace PolaKiosk.Services;

/// <summary>
/// Prise de vue Canon en attente de sa photo. Un transfert qui arrive sans prise en attente
/// (photo arrivée après le délai, déclenchement manuel) est refusé : il ne doit ni se perdre
/// dans une prise abandonnée ni être attribué à la prise suivante.
/// </summary>
internal sealed class CaptureSlot
{
    private readonly object _lock = new();
    private PendingCapture? _current;

    public PendingCapture Begin(string outputDirectory)
    {
        lock (_lock)
        {
            _current?.Fail(new InvalidOperationException("Prise de vue remplacée par une nouvelle."));
            _current = new PendingCapture(outputDirectory);
            return _current;
        }
    }

    /// <summary>
    /// Prise à laquelle attribuer la photo reçue, ou null si aucune n'attend (transfert à annuler).
    /// La prise est retirée : un second transfert pour la même prise est refusé.
    /// </summary>
    public PendingCapture? Claim()
    {
        lock (_lock)
        {
            var capture = _current;
            _current = null;
            return capture is { IsCompleted: false } ? capture : null;
        }
    }

    /// <summary>Met fin à la prise (délai dépassé, erreur) : une photo qui arriverait ensuite sera refusée.</summary>
    public void Expire(PendingCapture capture, Exception reason)
    {
        lock (_lock)
        {
            if (_current == capture) _current = null;
        }
        capture.Fail(reason);
    }

    /// <summary>Fait échouer la prise en attente éventuelle (appareil déconnecté, arrêt).</summary>
    public void Cancel(Exception reason)
    {
        PendingCapture? capture;
        lock (_lock)
        {
            capture = _current;
            _current = null;
        }
        capture?.Fail(reason);
    }
}

internal sealed class PendingCapture(string outputDirectory)
{
    private readonly TaskCompletionSource<string> _tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public string OutputDirectory { get; } = outputDirectory;
    public Task<string> Task => _tcs.Task;
    public bool IsCompleted => _tcs.Task.IsCompleted;

    public void Complete(string path) => _tcs.TrySetResult(path);
    public void Fail(Exception reason) => _tcs.TrySetException(reason);
}
