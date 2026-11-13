namespace PolaKiosk.Services;

/// <summary>
/// Verrou nommé de la session Windows : une seule instance de PolaKiosk à la fois (raccourci lancé
/// pendant que le watchdog relance l'app, double clic…). Deux instances se disputeraient la caméra,
/// la base locale et l'écran.
/// </summary>
public sealed class SingleInstance : IDisposable
{
    public const string DefaultName = @"Local\PolaKiosk.Instance";

    private readonly Mutex _mutex;

    private SingleInstance(Mutex mutex) => _mutex = mutex;

    /// <summary>Le verrou si aucune autre instance ne le détient, sinon null. À libérer sur le même fil.</summary>
    public static SingleInstance? TryAcquire(string name = DefaultName)
    {
        var mutex = new Mutex(false, name);
        bool owned;
        try { owned = mutex.WaitOne(0); }
        catch (AbandonedMutexException) { owned = true; } // instance précédente arrêtée brutalement : verrou repris
        if (owned) return new SingleInstance(mutex);

        mutex.Dispose();
        return null;
    }

    public void Dispose()
    {
        try { _mutex.ReleaseMutex(); }
        catch (ApplicationException) { /* pas détenu par ce fil : Windows le libère à la fin du processus */ }
        _mutex.Dispose();
    }
}
