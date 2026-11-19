using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;
using PolaKiosk.EDSDK;
using PolaKiosk.Models;

namespace PolaKiosk.Services;

// Réglages d'exposition (LAB-427, spec docs/specs/reglages-appareil-photo.md) : vitesse, ouverture,
// ISO, balance des blancs. Lus et écrits sur le fil STA EDSDK, jamais pendant une prise de vue, et
// seulement en mode M (la molette ne se tourne pas à distance).
public partial class EdsdkCameraService
{
    // Au-delà, l'appelant abandonne (fil STA occupé par une prise de vue ou bloqué).
    private static readonly TimeSpan PropertyOpTimeout = TimeSpan.FromSeconds(20);

    // Liste de repli quand l'appareil ne décrit pas les balances permises (desc vide).
    private static readonly int[] DefaultWhiteBalances = [0, 1, 8, 2, 3, 4, 5, CanonExposure.WbColorTemperature];

    private static readonly HashSet<uint> ExposureProperties =
    [
        EdsPropID.Tv, EdsPropID.Av, EdsPropID.ISOSpeed, EdsPropID.WhiteBalance, EdsPropID.ColorTemperature,
        EdsPropID.AEMode, EdsPropID.AEModeSelect,
    ];

    // Le live view occupe la file principale : ces opérations passent aussi entre deux images (voir la boucle).
    private readonly ConcurrentQueue<Action> _propertyQueue = new();

    private EdsApi.EdsPropertyEventHandler? _propertyEventHandler;

    public bool SupportsExposureSettings => true;

    public event EventHandler? ExposureOptionsChanged;

    public Task<CameraExposureState?> ReadExposureAsync()
        => RunPropertyOp<CameraExposureState?>(() => _camera == IntPtr.Zero ? null : ReadState());

    public Task<CameraExposureState?> ApplyExposureAsync(CameraExposureValues values)
    {
        ArgumentNullException.ThrowIfNull(values);
        return RunPropertyOp<CameraExposureState?>(() =>
        {
            if (_camera == IntPtr.Zero)
                throw new CameraExposureException("Appareil photo non connecté.", null);
            return ApplyValues(values);
        });
    }

    public Task<CameraExposureState?> ReadExposureNowAsync()
        => RunPropertyOp<CameraExposureState?>(() => InShortSession(ReadState));

    public Task<CameraExposureState?> ApplyExposureNowAsync(CameraExposureValues values, DateTimeOffset changedAt)
    {
        ArgumentNullException.ThrowIfNull(values);
        return RunPropertyOp<CameraExposureState?>(() => InShortSession(() =>
        {
            var state = ApplyValues(values);
            // Enregistré dans la même opération du fil STA : une séance ouverte juste après réapplique
            // déjà ces valeurs, jamais les précédentes.
            _machine?.SetCameraExposure(state.Values, changedAt);
            return state;
        }));
    }

    /// <summary>Applique (mode M seulement), relit ; refus : <see cref="CameraExposureException"/> (fil STA, session ouverte).</summary>
    private CameraExposureState ApplyValues(CameraExposureValues values)
    {
        var before = ReadState();
        if (!before.Settable)
            throw new CameraExposureException(
                $"Mettez la molette de l'appareil sur M (mode actuel : {before.Mode}).", before);

        var refused = new List<string>();
        WriteValues(values, before, refused, changed: null);

        var after = ReadState();
        if (refused.Count > 0)
            throw new CameraExposureException(RefusedMessage(refused), after);
        return after;
    }

    /// <summary>
    /// Exécute <paramref name="op"/> dans la session ouverte, sinon (accueil : session fermée hors prise de
    /// vue) dans une session courte ouverte puis fermée dans la même opération du fil STA (K2). Rien ne
    /// peut s'intercaler : une prise de vue lancée entre-temps attend son tour et rouvre sa propre session
    /// complète. Pas de callback ni de réglage de prise de vue dans la session courte ; le SDK reste
    /// initialisé (même règle que <see cref="CountCamerasAsync"/>).
    /// </summary>
    private T InShortSession<T>(Func<T> op)
    {
        if (_camera != IntPtr.Zero) return op();

        IntPtr list = IntPtr.Zero;
        try
        {
            if (!_sdkInitialized)
            {
                var initErr = EdsApi.EdsInitializeSDK();
                if (initErr != EdsError.OK)
                {
                    EdsApi.EdsTerminateSDK();
                    initErr = EdsApi.EdsInitializeSDK();
                    ThrowIfError(initErr, "EdsInitializeSDK");
                }
                _sdkInitialized = true;
            }

            ThrowIfError(EdsApi.EdsGetCameraList(out list), "EdsGetCameraList");
            ThrowIfError(EdsApi.EdsGetChildCount(list, out int count), "EdsGetChildCount");
            if (count == 0) throw new CameraExposureException("Appareil photo non connecté.", null);

            ThrowIfError(EdsApi.EdsGetChildAtIndex(list, 0, out var camera), "EdsGetChildAtIndex");
            _camera = camera;
            _modelName ??= ReadModelName(_camera);
            ThrowIfError(EdsApi.EdsOpenSession(_camera), "EdsOpenSession");

            return op();
        }
        catch (Exception ex) when (ex is not CameraExposureException)
        {
            throw new CameraExposureException("Appareil photo injoignable : " + ex.Message, null);
        }
        finally
        {
            ReleaseCamera();
            if (list != IntPtr.Zero) EdsApi.EdsRelease(list);
        }
    }

    internal static string RefusedMessage(IReadOnlyList<string> refused)
        => "L'appareil a refusé " + string.Join(", ", refused) + ".";

    /// <summary>
    /// Exécute <paramref name="op"/> sur le fil STA : par la file principale (réveil) ou par la boucle du
    /// live view, au premier des deux. Une seule exécution ; abandonnée si l'appelant a renoncé.
    /// </summary>
    private async Task<T> RunPropertyOp<T>(Func<T> op)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _propertyQueue.Enqueue(() =>
        {
            if (tcs.Task.IsCompleted) return; // délai dépassé : ne plus rien écrire
            try { tcs.TrySetResult(op()); }
            catch (Exception ex) { tcs.TrySetException(ex); }
        });
        _queue.Enqueue(DrainPropertyQueue);

        if (await Task.WhenAny(tcs.Task, Task.Delay(PropertyOpTimeout)) != tcs.Task)
        {
            tcs.TrySetException(new CameraExposureException("L'appareil photo ne répond pas, réessayez.", null));
        }
        return await tcs.Task;
    }

    private void DrainPropertyQueue()
    {
        while (_propertyQueue.TryDequeue(out var action))
        {
            try { action(); }
            catch { /* chaque opération rend son erreur à son appelant */ }
        }
    }

    // ── Lecture (fil STA) ─────────────────────────────────────────────────────

    private CameraExposureState ReadState()
    {
        var mode = ReadMode();
        var wbCodes = ReadDesc(EdsPropID.WhiteBalance);

        return new CameraExposureState
        {
            Model    = _modelName ?? "Canon",
            Mode     = mode is int m ? CanonExposure.ModeLabel(m) : "Inconnu",
            Settable = CanonExposure.IsManual(mode),
            Values = new CameraExposureValues
            {
                Tv     = GetIntProperty(EdsPropID.Tv),
                Av     = GetIntProperty(EdsPropID.Av),
                Iso    = GetIntProperty(EdsPropID.ISOSpeed),
                Wb     = GetIntProperty(EdsPropID.WhiteBalance),
                Kelvin = GetIntProperty(EdsPropID.ColorTemperature),
            },
            Options = new Dictionary<string, List<CameraOption>>
            {
                [CameraExposureKeys.Tv]     = CanonExposure.Options(CameraExposureKeys.Tv, ReadDesc(EdsPropID.Tv)),
                [CameraExposureKeys.Av]     = CanonExposure.Options(CameraExposureKeys.Av, ReadDesc(EdsPropID.Av)),
                [CameraExposureKeys.Iso]    = CanonExposure.Options(CameraExposureKeys.Iso, ReadDesc(EdsPropID.ISOSpeed)),
                [CameraExposureKeys.Wb]     = CanonExposure.Options(CameraExposureKeys.Wb,
                                                  wbCodes.Count > 0 ? wbCodes : DefaultWhiteBalances),
                // La desc de ColorTemperature est vide sur la plupart des boîtiers : liste fixe.
                [CameraExposureKeys.Kelvin] = CanonExposure.KelvinOptions(),
            },
            At = DateTimeOffset.UtcNow,
        };
    }

    /// <summary>Mode de prise de vue : AEMode, sinon AEModeSelect (position de la molette sur certains boîtiers).</summary>
    private int? ReadMode() => GetIntProperty(EdsPropID.AEMode) ?? GetIntProperty(EdsPropID.AEModeSelect);

    /// <summary>Propriété 32 bits ; null si refusée ou sans valeur (0xFFFFFFFF).</summary>
    private int? GetIntProperty(uint propertyId)
    {
        var ptr = Marshal.AllocHGlobal(sizeof(uint));
        try
        {
            if (EdsApi.EdsGetPropertyData(_camera, propertyId, 0, sizeof(uint), ptr) != EdsError.OK) return null;
            var value = Marshal.ReadInt32(ptr);
            return value == CanonExposure.Invalid ? null : value;
        }
        catch { return null; } // propriété inconnue du boîtier : simplement absente
        finally { Marshal.FreeHGlobal(ptr); }
    }

    /// <summary>Codes permis à cet instant ; vide si l'appareil ne les décrit pas.</summary>
    private List<int> ReadDesc(uint propertyId)
    {
        try
        {
            if (EdsApi.EdsGetPropertyDesc(_camera, propertyId, out var desc) != EdsError.OK || desc.PropDesc == null)
                return [];
            var count = Math.Clamp(desc.NumElements, 0, desc.PropDesc.Length);
            return desc.PropDesc.Take(count).ToList();
        }
        catch { return []; }
    }

    // ── Écriture (fil STA) ────────────────────────────────────────────────────

    /// <summary>
    /// Écrit les valeurs non nulles qui diffèrent de <paramref name="before"/>. Valeur hors de la liste
    /// permise ou refusée par l'appareil : ajoutée à <paramref name="refused"/>, l'appareil garde la
    /// précédente. Kelvin écrit seulement si la balance (relue) est sur « Température de couleur ».
    /// </summary>
    private void WriteValues(CameraExposureValues values, CameraExposureState before, List<string> refused,
        List<string>? changed)
    {
        WriteOne(EdsPropID.Tv, CameraExposureKeys.Tv, values.Tv, before.Values.Tv, before, refused, changed);
        WriteOne(EdsPropID.Av, CameraExposureKeys.Av, values.Av, before.Values.Av, before, refused, changed);
        WriteOne(EdsPropID.ISOSpeed, CameraExposureKeys.Iso, values.Iso, before.Values.Iso, before, refused, changed);
        WriteOne(EdsPropID.WhiteBalance, CameraExposureKeys.Wb, values.Wb, before.Values.Wb, before, refused, changed);

        if (values.Kelvin is not int kelvin) return;
        if (!CanonExposure.IsValidKelvin(kelvin))
        {
            refused.Add(DescribeForMessage(CameraExposureKeys.Kelvin, kelvin));
            return;
        }
        if (GetIntProperty(EdsPropID.WhiteBalance) != CanonExposure.WbColorTemperature) return;
        WriteOne(EdsPropID.ColorTemperature, CameraExposureKeys.Kelvin, kelvin,
            GetIntProperty(EdsPropID.ColorTemperature), before, refused, changed);
    }

    private void WriteOne(uint propertyId, string key, int? wanted, int? current, CameraExposureState before,
        List<string> refused, List<string>? changed)
    {
        if (wanted is not int value || value == current) return;

        var allowed = before.OptionsFor(key);
        if (allowed.Count > 0 && allowed.All(o => o.Code != value))
        {
            refused.Add(DescribeForMessage(key, value));
            return;
        }

        var err = RetryWhileBusy(() => SetUInt32Property(propertyId, unchecked((uint)value)));
        if (err != EdsError.OK)
        {
            refused.Add(DescribeForMessage(key, value));
            _ = _log?.LogWarningAsync("camera",
                $"Réglage {DescribeForMessage(key, value)} refusé par l'appareil (0x{err:X}).");
            return;
        }
        changed?.Add($"{DescribeForMessage(key, current)} → {DescribeForMessage(key, value)}");
    }

    /// <summary>« 1/4000 », « ouverture 5,6 », « ISO 1600 », « Lumière du jour », « 5600 K ».</summary>
    internal static string DescribeForMessage(string key, int? code)
    {
        if (code is not int c) return "—";
        var label = CanonExposure.Label(key, c);
        return key switch
        {
            CameraExposureKeys.Av  => "ouverture " + label,
            CameraExposureKeys.Iso => "ISO " + label,
            _                      => label,
        };
    }

    // ── Réapplication à l'ouverture de session (fil STA) ──────────────────────

    /// <summary>
    /// Remet les réglages gardés dans machine-settings.json (l'appareil a pu être réglé à la main ou
    /// remis à zéro). Seulement en mode M ; n'écrit que ce qui diffère, pour garder l'ouverture rapide.
    /// Jamais d'échec de l'ouverture pour autant : tout est journalisé (catégorie camera).
    /// </summary>
    private void ReapplySavedExposure()
    {
        var saved = _machine?.Current.CameraExposure?.Values;
        if (saved is null || (saved.Tv is null && saved.Av is null && saved.Iso is null && saved.Wb is null
                              && saved.Kelvin is null))
            return;

        try
        {
            var mode = ReadMode();
            if (!CanonExposure.IsManual(mode))
            {
                var label = mode is int m ? CanonExposure.ModeLabel(m) : "Inconnu";
                _ = _log?.LogWarningOncePerDayAsync("camera",
                    $"Réglages de l'appareil non appliqués : la molette est sur {label}, pas sur M.");
                return;
            }

            var before = ReadState();
            var refused = new List<string>();
            var changed = new List<string>();
            WriteValues(saved, before, refused, changed);

            if (changed.Count > 0)
                _ = _log?.LogWarningOncePerDayAsync("camera",
                    "Réglages de l'appareil rétablis (écart avec ceux de la borne) : " + string.Join(", ", changed) + ".");
            if (refused.Count > 0)
                _ = _log?.LogWarningOncePerDayAsync("camera", RefusedMessage(refused) + " (réglages de la borne)");
        }
        catch (Exception ex)
        {
            _ = _log?.LogWarningAsync("camera", $"Réapplication des réglages de l'appareil impossible : {ex.Message}");
        }
    }

    // ── Événements de propriété ───────────────────────────────────────────────

    /// <summary>
    /// Molette, zoom, objectif : l'appareil prévient (délivré par EdsGetEvent sur le fil STA). L'événement
    /// public est levé sur le pool de threads, jamais sur le fil STA (l'abonné relit par la file).
    /// </summary>
    private void RegisterPropertyEvents()
    {
        _propertyEventHandler = (inEvent, inPropertyId, _, _) =>
        {
            if ((inEvent == EdsPropertyEvent.PropertyChanged || inEvent == EdsPropertyEvent.PropertyDescChanged)
                && ExposureProperties.Contains(inPropertyId))
            {
                var handler = ExposureOptionsChanged;
                if (handler != null)
                    ThreadPool.QueueUserWorkItem(_ =>
                    {
                        try { handler(this, EventArgs.Empty); }
                        catch { /* un abonné défaillant ne doit pas toucher à l'appareil */ }
                    });
            }
            return EdsError.OK;
        };

        var err = EdsApi.EdsSetPropertyEventHandler(_camera, EdsPropertyEvent.All, _propertyEventHandler, IntPtr.Zero);
        if (err != EdsError.OK)
            _ = _log?.LogWarningAsync("camera", $"Suivi des réglages de l'appareil indisponible (0x{err:X}).");
    }
}
