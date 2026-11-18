namespace PolaKiosk.Services;

/// <summary>État de l'appareil photo de la borne, partagé par l'accueil, la prise de vue et le battement de cœur.</summary>
public enum CameraHealth
{
    /// <summary>Pas encore vérifié, ou la vérification n'a pas abouti (délai dépassé).</summary>
    Unknown,
    Present,
    Absent,
}

/// <summary>Vérifie, sans ouvrir de session ni changer de source, que l'appareil choisi est branché.</summary>
public interface ICameraPresenceCheck
{
    Task<bool> IsPresentAsync(CancellationToken cancellationToken);
}

/// <summary>Liste des appareils Canon vus par EDSDK (implémentée par <see cref="EdsdkCameraService"/>).</summary>
public interface ICanonCameraList
{
    /// <summary>Nombre d'appareils listés par EdsGetCameraList. Lève si le SDK ne peut pas être chargé.</summary>
    Task<int> CountCamerasAsync();
}

/// <summary>Canon présent = EDSDK.dll installée ET au moins un appareil listé par EdsGetCameraList.</summary>
public sealed class CanonPresenceCheck : ICameraPresenceCheck
{
    private readonly ICanonCameraList _list;
    private readonly Func<bool> _sdkInstalled;

    public CanonPresenceCheck(ICanonCameraList list, Func<bool>? sdkInstalled = null)
    {
        _list         = list;
        _sdkInstalled = sdkInstalled ?? CameraDetectionService.IsCanonSdkInstalled;
    }

    public async Task<bool> IsPresentAsync(CancellationToken cancellationToken)
    {
        // Sans la DLL, aucun appel EDSDK : il lèverait DllNotFoundException.
        if (!_sdkInstalled()) return false;
        return await _list.CountCamerasAsync().WaitAsync(cancellationToken).ConfigureAwait(false) > 0;
    }
}

/// <summary>Simulation : l'appareil est toujours là.</summary>
public sealed class AlwaysPresentCheck : ICameraPresenceCheck
{
    public Task<bool> IsPresentAsync(CancellationToken cancellationToken) => Task.FromResult(true);
}

/// <summary>Vérification adaptée au service caméra choisi au démarrage (la source ne change jamais ici).</summary>
public static class CameraPresence
{
    public static ICameraPresenceCheck For(ICameraService camera) => camera switch
    {
        ICameraPresenceCheck own => own,                         // webcam
        ICanonCameraList canon   => new CanonPresenceCheck(canon),
        _                        => new AlwaysPresentCheck(),     // simulation
    };

    /// <summary>Appareil nommé dans les journaux (LAB-326) : modèle du Canon s'il a été lu.</summary>
    public static string Describe(ICameraService camera) => camera switch
    {
        EdsdkCameraService canon => string.IsNullOrWhiteSpace(canon.ModelName) ? "Canon (modèle non lu)" : canon.ModelName!,
        WebcamCameraService      => "webcam",
        MockCameraService        => "caméra simulée",
        _                        => "inconnu",
    };
}

/// <summary>
/// Crée la vérification à la première utilisation : le service caméra (et le fil EDSDK) n'est pas
/// construit tant que personne ne vérifie (battement de cœur, tests d'injection).
/// </summary>
public sealed class DeferredPresenceCheck(Func<ICameraPresenceCheck> factory) : ICameraPresenceCheck
{
    private readonly Lazy<ICameraPresenceCheck> _check = new(factory);

    public Task<bool> IsPresentAsync(CancellationToken cancellationToken) => _check.Value.IsPresentAsync(cancellationToken);
}

public interface ICameraHealthService
{
    CameraHealth Status { get; }

    /// <summary>Valeur de p_camera_status du battement de cœur : "ok", "disconnected", ou null si inconnu.</summary>
    string? HeartbeatValue { get; }

    /// <summary>Vérifie maintenant (délai borné). Délai dépassé ou erreur : l'état précédent est gardé.</summary>
    Task<CameraHealth> CheckNowAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// La prise de vue n'a pas pu ouvrir l'appareil (3 tentatives) : absent tout de suite, et pendant
    /// <see cref="CameraHealthService.ReportedAbsentHold"/> même si la liste des appareils le montre encore.
    /// </summary>
    void ReportAbsent();
}

/// <summary>
/// État partagé de l'appareil photo (LAB-263). Une ligne d'erreur (catégorie « camera ») dans les
/// journaux à chaque passage à absent, pas à chaque vérification ; une ligne d'info avec le modèle à
/// la première détection du lancement et au retour de l'appareil (LAB-326).
/// </summary>
public sealed class CameraHealthService : ICameraHealthService
{
    /// <summary>Délai d'une vérification : au-delà, l'état reste celui d'avant.</summary>
    public static readonly TimeSpan DefaultCheckTimeout = TimeSpan.FromSeconds(5);

    /// <summary>Durée pendant laquelle un échec de la prise de vue l'emporte sur la liste des appareils.</summary>
    public static readonly TimeSpan ReportedAbsentHold = TimeSpan.FromSeconds(30);

    private readonly ICameraPresenceCheck _check;
    private readonly IKioskLogService? _log;
    private readonly TimeSpan _timeout;
    private readonly Func<DateTime> _utcNow;
    private readonly Func<string?>? _describeCamera;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _stateLock = new();

    private CameraHealth _status = CameraHealth.Unknown;
    private DateTime _absentUntil = DateTime.MinValue;

    public CameraHealthService(ICameraPresenceCheck check, IKioskLogService? log = null,
        TimeSpan? timeout = null, Func<DateTime>? utcNow = null, Func<string?>? describeCamera = null)
    {
        _describeCamera = describeCamera;
        _check   = check;
        _log     = log;
        _timeout = timeout ?? DefaultCheckTimeout;
        _utcNow  = utcNow ?? (() => DateTime.UtcNow);
    }

    public CameraHealth Status
    {
        get { lock (_stateLock) return _status; }
    }

    public string? HeartbeatValue => ToHeartbeatValue(Status);

    internal static string? ToHeartbeatValue(CameraHealth status) => status switch
    {
        CameraHealth.Present => "ok",
        CameraHealth.Absent  => "disconnected",
        _                    => null,
    };

    public async Task<CameraHealth> CheckNowAsync(CancellationToken cancellationToken = default)
    {
        // Une vérification à la fois : EDSDK passe par un seul fil, inutile d'empiler les demandes.
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            bool present;
            try
            {
                present = await _check.IsPresentAsync(cancellationToken)
                    .WaitAsync(_timeout, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch
            {
                // Délai dépassé (fil EDSDK occupé) ou SDK en erreur : on ne conclut rien.
                return Status;
            }

            Set(present ? CameraHealth.Present : CameraHealth.Absent, fromCheck: true);
            return Status;
        }
        finally
        {
            _gate.Release();
        }
    }

    public void ReportAbsent()
    {
        lock (_stateLock) _absentUntil = _utcNow() + ReportedAbsentHold;
        Set(CameraHealth.Absent, fromCheck: false);
    }

    private void Set(CameraHealth next, bool fromCheck)
    {
        CameraHealth previous;
        lock (_stateLock)
        {
            // L'échec récent de la prise de vue prime : l'appareil listé n'a pas pu être ouvert.
            if (fromCheck && next == CameraHealth.Present && _utcNow() < _absentUntil) return;

            previous = _status;
            _status  = next;
        }

        if (next == CameraHealth.Absent && previous != CameraHealth.Absent)
            _ = _log?.LogErrorAsync("camera",
                "Appareil photo non détecté : la borne affiche « Problème technique ».");
        else if (next == CameraHealth.Present && previous == CameraHealth.Unknown)
            _ = _log?.LogInfoAsync("camera", $"Caméra détectée : {DescribeCamera()}.");
        else if (next == CameraHealth.Present && previous == CameraHealth.Absent)
            _ = _log?.LogInfoAsync("camera", $"Appareil photo de nouveau détecté : {DescribeCamera()}.");
    }

    private string DescribeCamera()
    {
        try { return _describeCamera?.Invoke() is { Length: > 0 } name ? name : "modèle inconnu"; }
        catch { return "modèle inconnu"; }
    }
}
