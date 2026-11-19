using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models;

namespace PolaKiosk.Services;

/// <summary>
/// Réglages de l'appareil demandés depuis le SaaS (LAB-428, RPC kiosk_get_camera_request).
/// <paramref name="RequestedAt"/> est gardé tel quel pour être renvoyé à l'identique à la confirmation.
/// </summary>
public record CameraSettingsRequest(CameraExposureValues Values, string RequestedAt);

/// <summary>
/// LAB-428 (spec docs/specs/reglages-appareil-photo.md, D5 et D6) : réglages de l'appareil photo par
/// borne depuis le SaaS. La borne lit la demande (cycle de 2 minutes, et 20 s sur l'accueil), l'applique
/// seulement sur un écran sûr (jamais pendant une prise de vue), la confirme avec les valeurs obtenues ou
/// la raison du refus, et envoie l'état de l'appareil dans le battement de cœur.
/// </summary>
public interface ICameraSettingsSync
{
    /// <summary>Une demande lue et pas encore appliquée.</summary>
    bool HasPending { get; }

    /// <summary>
    /// Relit la demande en attente (et renvoie d'abord une confirmation restée sans réponse). Une licence
    /// refusée vide tout sans lever ; une erreur réseau lève (nouvel essai au cycle suivant).
    /// </summary>
    Task PollAsync(CancellationToken ct = default);

    /// <summary>
    /// Applique la demande en attente si l'écran est sûr (fil d'affichage). True = demande traitée
    /// (appliquée ou refusée, confirmation envoyée ou gardée pour plus tard).
    /// </summary>
    Task<bool> TryApplyAsync(CancellationToken ct = default);

    /// <summary>Relit l'appareil sur un écran sûr (fil d'affichage) si le rapport est absent, ancien ou périmé.</summary>
    Task RefreshReportIfDueAsync(CancellationToken ct = default);

    /// <summary>Rapport JSON à joindre au battement de cœur, ou null s'il n'a pas changé depuis le dernier envoi.</summary>
    string? ReportForHeartbeat();

    /// <summary>Rapport accepté par le serveur : pas de nouvel envoi tant qu'il ne change pas (30 minutes au plus).</summary>
    void MarkReportSent(string json);
}

/// <inheritdoc cref="ICameraSettingsSync"/>
public sealed class CameraSettingsSyncService : ICameraSettingsSync
{
    internal const string LogContext = "camera";
    internal const string StatusApplied = "applied";
    internal const string StatusRefused = "refused";

    /// <summary>Rapport renvoyé (et l'appareil relu) au moins aussi souvent, même sans changement.</summary>
    internal static readonly TimeSpan ReportMaxAge = TimeSpan.FromMinutes(30);
    /// <summary>Appareil pas encore lu (absent, éteint) : nouvel essai à ce rythme.</summary>
    internal static readonly TimeSpan ReadRetryInterval = TimeSpan.FromMinutes(5);

    private sealed record PendingAck(string RequestedAt, string Status, CameraExposureValues? Values, string? Error);

    private readonly ISupabaseService _supabase;
    private readonly Lazy<ICameraService> _camera;
    private readonly IMachineSettingsService _machine;
    private readonly INavigationService _navigation;
    private readonly IKioskLogService _log;
    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _gate = new(1, 1); // une seule opération sur l'appareil à la fois
    private readonly object _reportLock = new();

    private CameraSettingsRequest? _pending;   // lue, pas encore appliquée (Volatile / Interlocked)
    private volatile PendingAck? _unacked;     // traitée, confirmation restée sans réponse (réseau)
    private volatile bool _stale;              // l'appareil a signalé un changement (molette, objectif)
    private int _subscribed;

    private string? _reportJson;
    private string? _reportFingerprint;
    private DateTimeOffset _reportReadAt;
    private DateTimeOffset _lastReadAttempt = DateTimeOffset.MinValue;
    private string? _sentFingerprint;
    private DateTimeOffset _sentAt;

    /// <param name="camera">Service caméra, construit à la première utilisation (fil EDSDK).</param>
    public CameraSettingsSyncService(ISupabaseService supabase, Func<ICameraService> camera,
        IMachineSettingsService machine, INavigationService navigation, IKioskLogService log, TimeProvider? clock = null)
    {
        _supabase   = supabase;
        _camera     = new Lazy<ICameraService>(camera);
        _machine    = machine;
        _navigation = navigation;
        _log        = log;
        _clock      = clock ?? TimeProvider.System;
    }

    public bool HasPending => Volatile.Read(ref _pending) != null;

    private ICameraService Camera
    {
        get
        {
            var camera = _camera.Value;
            if (Interlocked.Exchange(ref _subscribed, 1) == 0)
                camera.ExposureOptionsChanged += (_, _) => _stale = true;
            return camera;
        }
    }

    public async Task PollAsync(CancellationToken ct = default)
    {
        CameraSettingsRequest? request;
        try
        {
            // Confirmation perdue (coupure juste après l'application) : la renvoyer d'abord, sinon le SaaS
            // reste sur « reçue » et la borne réappliquerait la même demande.
            if (_unacked is { } unacked)
            {
                await _supabase.AckCameraRequestAsync(unacked.RequestedAt, unacked.Status, unacked.Values, unacked.Error, ct);
                _unacked = null;
            }
            request = await _supabase.GetCameraRequestAsync(ct);
        }
        catch (KioskLicenseRefusedException)
        {
            Volatile.Write(ref _pending, null);
            _unacked = null;
            return;
        }

        Volatile.Write(ref _pending, request);
    }

    public async Task<bool> TryApplyAsync(CancellationToken ct = default)
    {
        if (!HasPending || !UpdateCoordinator.CanApplyNow(_navigation.CurrentViewType)) return false;

        await _gate.WaitAsync(ct);
        try
        {
            var request = Volatile.Read(ref _pending);
            if (request == null || !UpdateCoordinator.CanApplyNow(_navigation.CurrentViewType)) return false;

            var (status, values, error) = await ApplyAsync(request);
            if (status == StatusApplied)
                await LogSafeAsync(() => _log.LogInfoAsync(LogContext,
                    "Réglages de l'appareil appliqués depuis le SaaS : "
                    + CameraReport.Values(values!).ToString(Formatting.None) + "."));
            else
                await LogSafeAsync(() => _log.LogWarningAsync(LogContext,
                    "Réglages de l'appareil demandés depuis le SaaS refusés : " + error));

            // Une nouvelle demande lue entre-temps reste en attente.
            Interlocked.CompareExchange(ref _pending, null, request);
            await AckAsync(new PendingAck(request.RequestedAt, status, values, error), ct);
            return true;
        }
        finally { _gate.Release(); }
    }

    private async Task<(string Status, CameraExposureValues? Values, string? Error)> ApplyAsync(CameraSettingsRequest request)
    {
        if (!DateTimeOffset.TryParse(request.RequestedAt, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var requestedAt))
            return (StatusRefused, null, "Demande illisible par la borne.");

        // Le dernier gagne (D5) : un réglage fait sur la borne après la demande est gardé.
        if (_machine.Current.CameraExposure is { } saved && saved.ChangedAt > requestedAt)
            return (StatusRefused, null,
                $"Remplacé par un réglage fait sur la borne à {saved.ChangedAt.ToLocalTime():HH:mm}.");

        var camera = Camera;
        if (!camera.SupportsExposureSettings)
            return (StatusRefused, null, "Réglages disponibles seulement avec un appareil Canon.");

        try
        {
            // Enregistré sur la borne par le service caméra, dans la même opération que l'application.
            var state = await camera.ApplyExposureNowAsync(request.Values, requestedAt);
            if (state == null) return (StatusRefused, null, "Appareil photo non connecté.");
            SetReport(CameraReport.FromState(state));
            return (StatusApplied, state.Values, null);
        }
        catch (CameraExposureException ex)
        {
            if (ex.State != null) SetReport(CameraReport.FromState(ex.State));
            return (StatusRefused, null, ex.Message);
        }
    }

    private async Task AckAsync(PendingAck ack, CancellationToken ct)
    {
        try
        {
            await _supabase.AckCameraRequestAsync(ack.RequestedAt, ack.Status, ack.Values, ack.Error, ct);
        }
        catch (KioskLicenseRefusedException) { /* le contrôle de licence renverra à l'association */ }
        catch (Exception)
        {
            _unacked = ack; // renvoyée avant la prochaine lecture
        }
    }

    public async Task RefreshReportIfDueAsync(CancellationToken ct = default)
    {
        if (!UpdateCoordinator.CanApplyNow(_navigation.CurrentViewType)) return;

        var camera = Camera;
        var now = _clock.GetUtcNow();
        if (!camera.SupportsExposureSettings)
        {
            // Webcam ou caméra simulée : le SaaS l'affiche « non disponible ».
            bool missing;
            lock (_reportLock) missing = _reportJson == null;
            if (missing) SetReport(CameraReport.Unsupported(CameraPresence.Describe(camera), now));
            return;
        }

        bool due;
        lock (_reportLock)
            due = _stale || (_reportJson == null
                ? now - _lastReadAttempt >= ReadRetryInterval
                : now - _reportReadAt >= ReportMaxAge);
        if (!due) return;

        await _gate.WaitAsync(ct);
        try
        {
            if (!UpdateCoordinator.CanApplyNow(_navigation.CurrentViewType)) return;
            lock (_reportLock) _lastReadAttempt = now;
            _stale = false;
            var state = await camera.ReadExposureNowAsync();
            if (state != null) SetReport(CameraReport.FromState(state));
        }
        catch (CameraExposureException)
        {
            // Appareil absent ou éteint : le dernier rapport reste, nouvel essai plus tard.
        }
        finally { _gate.Release(); }
    }

    private void SetReport(JObject report)
    {
        var json = report.ToString(Formatting.None);
        var fingerprint = CameraReport.Fingerprint(report);
        lock (_reportLock)
        {
            _reportJson = json;
            _reportFingerprint = fingerprint;
            _reportReadAt = _clock.GetUtcNow();
        }
    }

    public string? ReportForHeartbeat()
    {
        lock (_reportLock)
        {
            if (_reportJson == null) return null;
            var unchanged = _reportFingerprint == _sentFingerprint && _clock.GetUtcNow() - _sentAt < ReportMaxAge;
            return unchanged ? null : _reportJson;
        }
    }

    public void MarkReportSent(string json)
    {
        string fingerprint;
        try { fingerprint = CameraReport.Fingerprint(JObject.Parse(json)); }
        catch (JsonException) { return; }
        lock (_reportLock)
        {
            _sentFingerprint = fingerprint;
            _sentAt = _clock.GetUtcNow();
        }
    }

    private static async Task LogSafeAsync(Func<Task> write)
    {
        try { await write(); }
        catch { /* journal indisponible : la synchro prime */ }
    }
}
