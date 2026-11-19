using PolaKiosk.Models;

namespace PolaKiosk.Services;

public interface ICameraService
{
    Task InitializeAsync();
    Task StartLiveViewAsync(Action<byte[]> frameCallback);
    Task StopLiveViewAsync();
    Task<string> CaptureAsync(string outputDirectory);
    Task ShutdownAsync();
    bool IsConnected { get; }

    // ── Réglages d'exposition (LAB-427) : Canon seulement, webcam et caméra simulée disent « non disponible » ──

    bool SupportsExposureSettings { get; }

    /// <summary>Mode, valeurs actuelles et valeurs permises ; null si non disponible (autre caméra, appareil absent).</summary>
    Task<CameraExposureState?> ReadExposureAsync();

    /// <summary>
    /// Applique les valeurs non nulles (mode M seulement), relit et renvoie l'état obtenu. Refus (molette
    /// pas sur M, valeur hors liste, refus de l'appareil) : <see cref="CameraExposureException"/> avec un
    /// message en français et l'état relu (valeurs précédentes gardées).
    /// </summary>
    Task<CameraExposureState?> ApplyExposureAsync(CameraExposureValues values);

    /// <summary>
    /// Comme <see cref="ReadExposureAsync"/>, même session fermée (accueil) : le Canon ouvre une session
    /// courte le temps de la lecture, sans jamais gêner une prise de vue (synchro avec le SaaS, LAB-428).
    /// </summary>
    Task<CameraExposureState?> ReadExposureNowAsync() => ReadExposureAsync();

    /// <summary>
    /// Comme <see cref="ApplyExposureAsync"/>, même session fermée (voir <see cref="ReadExposureNowAsync"/>),
    /// et, en cas de succès, enregistre les valeurs obtenues sur la borne (machine-settings.json) avec
    /// l'heure <paramref name="changedAt"/>, dans la même opération : une séance ouverte juste après les
    /// réapplique. Les autres caméras ne prennent pas de réglage (null, rien d'enregistré).
    /// </summary>
    Task<CameraExposureState?> ApplyExposureNowAsync(CameraExposureValues values, DateTimeOffset changedAt)
        => ApplyExposureAsync(values);

    /// <summary>Mode, valeur ou liste permise changé sur l'appareil (molette, zoom, objectif) : relire.</summary>
    event EventHandler? ExposureOptionsChanged;
}
