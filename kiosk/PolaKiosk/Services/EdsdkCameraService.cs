using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using PolaKiosk.EDSDK;

namespace PolaKiosk.Services;

// EDSDK doit être appelé depuis un thread STA dédié
public class EdsdkCameraService : ICameraService, ICanonCameraList
{
    // Délai pendant lequel le thread STA pompe les événements en attendant la photo.
    private static readonly TimeSpan CaptureDeadline = TimeSpan.FromSeconds(15);
    // Filet de sécurité côté appelant si le thread STA se bloque.
    private static readonly TimeSpan CaptureSafetyNet = TimeSpan.FromSeconds(18);

    private IntPtr _camera = IntPtr.Zero;
    private bool _sdkInitialized = false;
    private volatile bool _liveViewRunning = false;

    // Thread STA dédié pour tous les appels EDSDK
    private readonly Thread _edsdkThread;
    private readonly BlockingQueue<Action> _queue = new();

    private readonly CaptureSlot _captureSlot = new();

    // Callbacks managés — garder des références pour éviter le GC
    private EdsApi.EdsObjectEventHandler? _objectEventHandler;
    private EdsApi.EdsStateEventHandler? _stateEventHandler;

    private readonly IKioskLogService? _log;
    private readonly IMachineSettingsService? _machine;
    private bool _evfErrorLogged;
    // Qualité déjà demandée à l'appareil pour la session ouverte (acceptée ou refusée).
    private uint? _requestedQuality;

    public bool IsConnected => _camera != IntPtr.Zero;

    public EdsdkCameraService(IKioskLogService? log = null, IMachineSettingsService? machine = null)
    {
        _log = log;
        _machine = machine;
        _edsdkThread = new Thread(EdsdkThreadLoop) { IsBackground = true };
        _edsdkThread.SetApartmentState(ApartmentState.STA);
        _edsdkThread.Start();
    }

    public Task InitializeAsync()
    {
        var tcs = new TaskCompletionSource();
        _queue.Enqueue(() =>
        {
            IntPtr list = IntPtr.Zero;
            try
            {
                // Session déjà ouverte → on réutilise. Un second EdsInitializeSDK renvoie 0x2
                // (déjà initialisé) et ferait échouer toutes les prises après la première.
                if (_camera != IntPtr.Zero)
                {
                    ConfigureImageQuality(); // taille changée dans l'Admin depuis l'ouverture
                    tcs.SetResult();
                    return;
                }

                if (!_sdkInitialized)
                {
                    var initErr = EdsApi.EdsInitializeSDK();
                    if (initErr != EdsError.OK)
                    {
                        // Résidu d'une session précédente mal fermée : on termine puis on réessaie.
                        EdsApi.EdsTerminateSDK();
                        initErr = EdsApi.EdsInitializeSDK();
                        ThrowIfError(initErr, "EdsInitializeSDK");
                    }
                    _sdkInitialized = true;
                }

                ThrowIfError(EdsApi.EdsGetCameraList(out list), "EdsGetCameraList");
                ThrowIfError(EdsApi.EdsGetChildCount(list, out int count), "EdsGetChildCount");

                if (count == 0)
                    throw new InvalidOperationException("Aucun appareil Canon détecté.");

                ThrowIfError(EdsApi.EdsGetChildAtIndex(list, 0, out var camera), "EdsGetChildAtIndex");
                _camera = camera;

                ThrowIfError(EdsApi.EdsOpenSession(_camera), "EdsOpenSession");

                RegisterCallbacks();
                ConfigureSaveToHost();
                ConfigureImageQuality();
                tcs.SetResult();
            }
            catch (Exception ex)
            {
                // Nettoyage complet pour qu'une nouvelle tentative reparte d'un état sain.
                ReleaseCamera();
                TerminateSdk();
                tcs.SetException(ex);
            }
            finally
            {
                if (list != IntPtr.Zero) EdsApi.EdsRelease(list);
            }
        });
        return tcs.Task;
    }

    /// <summary>
    /// Nombre d'appareils listés par EDSDK (LAB-263), sur le fil STA comme tout appel EDSDK.
    /// N'ouvre pas de session et ne casse pas celle qui est ouverte. Le SDK est initialisé au besoin
    /// et reste initialisé (la prochaine ouverture le réutilise) : jamais initialisé deux fois.
    /// Pendant le live view, la demande attend la fin de la boucle : l'appelant borne l'attente.
    /// </summary>
    public Task<int> CountCamerasAsync()
    {
        var tcs = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        _queue.Enqueue(() =>
        {
            IntPtr list = IntPtr.Zero;
            try
            {
                if (!_sdkInitialized)
                {
                    var initErr = EdsApi.EdsInitializeSDK();
                    if (initErr != EdsError.OK)
                    {
                        // Même reprise qu'InitializeAsync : résidu d'une session mal fermée.
                        EdsApi.EdsTerminateSDK();
                        initErr = EdsApi.EdsInitializeSDK();
                        ThrowIfError(initErr, "EdsInitializeSDK");
                    }
                    _sdkInitialized = true;
                }

                // Délivre les événements en attente : un débranchement pendant la session ferme
                // celle-ci (StateEvent.Shutdown) avant de compter.
                EdsApi.EdsGetEvent();

                ThrowIfError(EdsApi.EdsGetCameraList(out list), "EdsGetCameraList");
                ThrowIfError(EdsApi.EdsGetChildCount(list, out int count), "EdsGetChildCount");

                // Plus aucun appareil mais une session encore ouverte (événement non reçu) : on la ferme,
                // la prochaine prise de vue rouvrira proprement l'appareil rebranché.
                if (count == 0 && _camera != IntPtr.Zero)
                    ReleaseCamera();

                tcs.SetResult(count);
            }
            catch (Exception ex) { tcs.TrySetException(ex); }
            finally
            {
                if (list != IntPtr.Zero) EdsApi.EdsRelease(list);
            }
        });
        return tcs.Task;
    }

    public Task StartLiveViewAsync(Action<byte[]> frameCallback)
    {
        var tcs = new TaskCompletionSource();
        _queue.Enqueue(() =>
        {
            try
            {
                if (_camera == IntPtr.Zero)
                    throw new InvalidOperationException("Appareil photo non connecté.");

                // Certains boîtiers exigent Evf_Mode=1 AVANT d'activer la sortie vers le PC,
                // sinon le live view reste noir. Les boîtiers sans ce réglage le refusent : sans gravité.
                SetUInt32Property(EdsPropID.Evf_Mode, 1);

                // Activer le live view vers le PC
                var err = SetUInt32Property(EdsPropID.Evf_OutputDevice, EdsEvfOutputDevice.PC);
                if (err != EdsError.OK)
                    _ = _log?.LogWarningAsync("camera-evf", $"Activation du live view refusée (0x{err:X}).");

                _liveViewRunning = true;
                tcs.SetResult();

                // Boucle live view sur le thread STA
                var startedAt = DateTime.UtcNow;
                bool gotFrame = false;
                while (_liveViewRunning && _camera != IntPtr.Zero)
                {
                    try
                    {
                        // Pomper les événements EDSDK : sans ça, l'EVF ne passe jamais à « prêt »
                        // et EdsDownloadEvfImage renvoie indéfiniment OBJECT_NOTREADY (0xA102).
                        EdsApi.EdsGetEvent();

                        var frame = DownloadEvfFrame(out var result);
                        if (frame != null)
                        {
                            frameCallback(frame);
                            if (!gotFrame)
                            {
                                gotFrame = true;
                                _ = _log?.LogInfoAsync("camera-evf", "Live view actif (première frame reçue).");
                            }
                        }
                        else if (!gotFrame && !_evfErrorLogged && (DateTime.UtcNow - startedAt).TotalSeconds > 5)
                        {
                            // OBJECT_NOTREADY est normal au démarrage ; on n'alerte que si ça persiste.
                            _evfErrorLogged = true;
                            _ = _log?.LogWarningAsync("camera-evf",
                                $"Live view toujours indisponible après 5 s (dernier code 0x{result:X}).");
                        }
                    }
                    catch { /* frame manquée, on continue */ }

                    Thread.Sleep(33); // ~30fps
                }
            }
            catch (Exception ex) { tcs.TrySetException(ex); }
        });
        return tcs.Task;
    }

    /// <summary>
    /// Télécharge une image du live view. Le flux et l'image EVF sont libérés dans tous les cas,
    /// y compris quand le boîtier n'est pas prêt ou qu'une erreur survient.
    /// </summary>
    private byte[]? DownloadEvfFrame(out uint result)
    {
        IntPtr stream = IntPtr.Zero;
        IntPtr evfImage = IntPtr.Zero;
        try
        {
            result = EdsApi.EdsCreateMemoryStream(0, out stream);
            if (result != EdsError.OK) return null;

            result = EdsApi.EdsCreateEvfImageRef(stream, out evfImage);
            if (result != EdsError.OK) return null;

            result = EdsApi.EdsDownloadEvfImage(_camera, evfImage);
            if (result != EdsError.OK) return null;

            result = EdsApi.EdsGetLength(stream, out ulong length);
            if (result != EdsError.OK || length == 0) return null;

            result = EdsApi.EdsGetPointer(stream, out var dataPtr);
            if (result != EdsError.OK || dataPtr == IntPtr.Zero) return null;

            var bytes = new byte[length];
            Marshal.Copy(dataPtr, bytes, 0, (int)length);
            return bytes;
        }
        finally
        {
            if (evfImage != IntPtr.Zero) EdsApi.EdsRelease(evfImage);
            if (stream != IntPtr.Zero) EdsApi.EdsRelease(stream);
        }
    }

    public Task StopLiveViewAsync()
    {
        _liveViewRunning = false;

        var tcs = new TaskCompletionSource();
        _queue.Enqueue(() =>
        {
            try
            {
                if (_camera != IntPtr.Zero)
                {
                    var err = SetUInt32Property(EdsPropID.Evf_OutputDevice, EdsEvfOutputDevice.None);
                    if (err != EdsError.OK)
                        _ = _log?.LogWarningAsync("camera-evf", $"Arrêt du live view refusé (0x{err:X}).");
                }
                tcs.SetResult();
            }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        return tcs.Task;
    }

    public async Task<string> CaptureAsync(string outputDirectory)
    {
        Directory.CreateDirectory(outputDirectory);

        // La prise n'est ouverte que sur le thread STA, juste avant le déclenchement : une photo
        // tardive de la prise précédente, délivrée avant, est refusée au lieu d'être prise pour celle-ci.
        var started = new TaskCompletionSource<PendingCapture>(TaskCreationOptions.RunContinuationsAsynchronously);
        _queue.Enqueue(() =>
        {
            if (started.Task.IsCompleted) return; // l'appelant a déjà abandonné (thread STA bloqué)

            PendingCapture? capture = null;
            try
            {
                if (_camera == IntPtr.Zero)
                    throw new InvalidOperationException("Appareil photo non connecté.");

                // Vider les événements en attente avant d'ouvrir la prise.
                EdsApi.EdsGetEvent();

                capture = _captureSlot.Begin(outputDirectory);
                if (!started.TrySetResult(capture))
                {
                    _captureSlot.Expire(capture, new OperationCanceledException());
                    return;
                }

                var err = TriggerCapture();
                if (err != EdsError.OK)
                {
                    _captureSlot.Expire(capture, new InvalidOperationException($"Échec de l'ordre de capture : 0x{err:X}"));
                    return;
                }

                // Les callbacks EDSDK (dont DirItemRequestTransfer → téléchargement) ne sont
                // distribués que si on pompe EdsGetEvent sur ce thread STA. Sans ça, l'image
                // n'est jamais transférée au PC et la capture « ne répond pas ».
                var deadline = DateTime.UtcNow + CaptureDeadline;
                while (!capture.IsCompleted && DateTime.UtcNow < deadline)
                {
                    EdsApi.EdsGetEvent();
                    Thread.Sleep(50);
                }

                // Délai dépassé : la prise est close, une photo qui arriverait plus tard sera refusée.
                if (!capture.IsCompleted)
                    _captureSlot.Expire(capture, CaptureTimeout());
            }
            catch (Exception ex)
            {
                if (capture is null) started.TrySetException(ex);
                else _captureSlot.Expire(capture, ex);
            }
        });

        // Filet de sécurité si le thread STA se bloque : on ne reste pas coincé indéfiniment.
        var safetyNet = Task.Delay(CaptureSafetyNet);
        if (await Task.WhenAny(started.Task, safetyNet) != started.Task)
        {
            started.TrySetCanceled();
            throw CaptureTimeout();
        }

        var pending = await started.Task;
        if (await Task.WhenAny(pending.Task, safetyNet) != pending.Task)
            _captureSlot.Expire(pending, CaptureTimeout());

        return await pending.Task;
    }

    private static TimeoutException CaptureTimeout() => new("La caméra n'a pas répondu lors de la capture.");

    /// <summary>
    /// Déclenche la prise de vue. TakePicture (0x00) convient à la plupart des boîtiers ;
    /// en cas d'échec (fréquent sur les boîtiers R), on retombe sur la séquence
    /// PressShutterButton (enfoncé à fond sans AF, puis relâché).
    /// </summary>
    private uint TriggerCapture()
    {
        var err = EdsApi.EdsSendCommand(_camera, EdsCameraCommand.TakePicture, 0);
        if (err == EdsError.OK) return err;

        EdsApi.EdsSendCommand(_camera, EdsCameraCommand.PressShutterButton, EdsShutterButton.Completely_NonAF);
        return EdsApi.EdsSendCommand(_camera, EdsCameraCommand.PressShutterButton, EdsShutterButton.OFF);
    }

    /// <summary>
    /// Règle SaveTo=Host + capacité host. Sans ça, la photo reste sur la carte SD et le PC
    /// n'est jamais notifié (DirItemRequestTransfer non émis) → capture en échec.
    /// Un refus est journalisé sans bloquer l'ouverture : certains boîtiers R signalent
    /// quand même la photo écrite sur la carte (DirItemCreated), qu'on télécharge alors.
    /// </summary>
    private void ConfigureSaveToHost()
    {
        var err = RetryWhileBusy(() => SetUInt32Property(EdsPropID.SaveTo, EdsSaveTo.Host));
        if (err != EdsError.OK)
            _ = _log?.LogWarningAsync("camera", $"Réglage SaveTo=Host refusé par l'appareil (0x{err:X}).");

        var capacity = new EdsCapacity { NumberOfFreeClusters = 0x7FFFFFFF, BytesPerSector = 0x1000, Reset = true };
        err = RetryWhileBusy(() => EdsApi.EdsSetCapacity(_camera, capacity));
        if (err != EdsError.OK)
            _ = _log?.LogWarningAsync("camera", $"Réglage de la capacité host refusé par l'appareil (0x{err:X}).");
    }

    /// <summary>
    /// Taille JPEG choisie dans l'Admin (<see cref="CanonPhotoSize"/>, moyenne par défaut) : fichier
    /// plus léger et transfert USB plus court qu'en pleine taille. Demandée une fois par session et
    /// par valeur ; un refus (mode de l'appareil, RAW…) est journalisé et la prise de vue continue
    /// avec le réglage de l'appareil.
    /// </summary>
    private void ConfigureImageQuality()
    {
        var quality = CanonPhotoSize.ToEdsImageQuality(_machine?.Current.CanonPhotoSize);
        if (_requestedQuality == quality) return;
        _requestedQuality = quality;

        var err = RetryWhileBusy(() => SetUInt32Property(EdsPropID.ImageQuality, quality));
        if (err != EdsError.OK)
            _ = _log?.LogWarningAsync("camera", $"Taille des photos 0x{quality:X8} refusée par l'appareil (0x{err:X}).");
    }

    /// <summary>L'appareil répond « occupé » juste après l'ouverture de session : on réessaie brièvement.</summary>
    private static uint RetryWhileBusy(Func<uint> call)
    {
        var err = call();
        for (int attempt = 0; attempt < 5 && err == EdsError.DEVICE_BUSY; attempt++)
        {
            Thread.Sleep(200);
            EdsApi.EdsGetEvent();
            err = call();
        }
        return err;
    }

    private uint SetUInt32Property(uint propertyId, uint value)
    {
        var ptr = Marshal.AllocHGlobal(sizeof(uint));
        try
        {
            Marshal.WriteInt32(ptr, unchecked((int)value));
            return EdsApi.EdsSetPropertyData(_camera, propertyId, 0, sizeof(uint), ptr);
        }
        finally { Marshal.FreeHGlobal(ptr); }
    }

    public Task ShutdownAsync()
    {
        _liveViewRunning = false;
        _captureSlot.Cancel(new InvalidOperationException("Appareil photo arrêté pendant la capture."));

        var tcs = new TaskCompletionSource();
        _queue.Enqueue(() =>
        {
            try
            {
                ReleaseCamera();
                TerminateSdk();
                tcs.SetResult();
            }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        return tcs.Task;
    }

    /// <summary>Ferme la session et libère l'appareil courant (thread STA). Chaque étape est indépendante.</summary>
    private void ReleaseCamera()
    {
        var camera = _camera;
        _camera = IntPtr.Zero;
        _requestedQuality = null;
        CloseAndRelease(camera);
    }

    private static void CloseAndRelease(IntPtr camera)
    {
        if (camera == IntPtr.Zero) return;
        try { EdsApi.EdsCloseSession(camera); } catch { }
        try { EdsApi.EdsRelease(camera); } catch { }
    }

    private void TerminateSdk()
    {
        if (!_sdkInitialized) return;
        try { EdsApi.EdsTerminateSDK(); } catch { }
        _sdkInitialized = false;
    }

    private void RegisterCallbacks()
    {
        _objectEventHandler = (inEvent, inRef, _context) =>
        {
            try
            {
                // Diagnostic : tracer chaque événement objet reçu (utile pour identifier ce que
                // le boîtier émet réellement — DirItemRequestTransfer vs DirItemCreated selon SaveTo).
                _ = _log?.LogInfoAsync("camera-evt", $"ObjectEvent 0x{inEvent:X}");

                // On télécharge sur les DEUX événements : DirItemRequestTransfer (SaveTo=Host) et
                // DirItemCreated (photo écrite sur la carte — certains boîtiers R n'honorent pas Host).
                if (inEvent == EdsObjectEvent.DirItemRequestTransfer || inEvent == EdsObjectEvent.DirItemCreated)
                {
                    var capture = _captureSlot.Claim();
                    if (capture != null)
                        DownloadImage(inRef, capture);
                    else
                        RejectTransfer(inEvent, inRef);
                }
            }
            catch (Exception ex)
            {
                _ = _log?.LogErrorAsync("camera-evt", $"Erreur sur l'événement 0x{inEvent:X} : {ex.Message}", ex.StackTrace);
            }
            finally
            {
                // EDSDK transmet une référence que l'application doit toujours libérer.
                if (inRef != IntPtr.Zero) EdsApi.EdsRelease(inRef);
            }
            return EdsError.OK;
        };

        _stateEventHandler = (inEvent, _, _) =>
        {
            if (inEvent == EdsStateEvent.Shutdown)
            {
                // Appareil éteint ou débranché : la prise en cours échoue tout de suite, le live view
                // s'arrête, et la session est fermée hors du callback (on ne libère pas l'appareil
                // pendant qu'EDSDK nous notifie à son sujet).
                _ = _log?.LogWarningAsync("camera", "Appareil photo éteint ou débranché.");
                _liveViewRunning = false;
                _captureSlot.Cancel(new InvalidOperationException("L'appareil photo s'est éteint ou a été débranché."));
                var lost = _camera;
                _camera = IntPtr.Zero;
                _requestedQuality = null;
                _queue.Enqueue(() => CloseAndRelease(lost));
            }
            return EdsError.OK;
        };

        ThrowIfError(EdsApi.EdsSetObjectEventHandler(_camera, EdsObjectEvent.All, _objectEventHandler, IntPtr.Zero),
            "EdsSetObjectEventHandler");
        ThrowIfError(EdsApi.EdsSetCameraStateEventHandler(_camera, EdsStateEvent.All, _stateEventHandler, IntPtr.Zero),
            "EdsSetCameraStateEventHandler");
    }

    /// <summary>
    /// Photo reçue sans prise en attente (arrivée après le délai, déclenchement manuel) :
    /// le transfert est annulé pour que le boîtier ne la garde pas en attente.
    /// </summary>
    private void RejectTransfer(uint inEvent, IntPtr dirItem)
    {
        if (inEvent != EdsObjectEvent.DirItemRequestTransfer) return; // photo restée sur la carte : rien à annuler

        var err = EdsApi.EdsDownloadCancel(dirItem);
        _ = _log?.LogWarningAsync("camera-evt",
            $"Photo reçue sans prise en attente (arrivée après le délai) : transfert annulé (0x{err:X}).");
    }

    private void DownloadImage(IntPtr dirItem, PendingCapture capture)
    {
        IntPtr stream = IntPtr.Zero;
        bool transferClosed = false;
        try
        {
            ThrowIfError(EdsApi.EdsGetDirectoryItemInfo(dirItem, out var info), "EdsGetDirectoryItemInfo");

            // Nom horodaté et unique (et non le nom appareil IMG_xxxx) : tri chronologique, pas de
            // collision entre sessions ni après remise à zéro de la numérotation de la carte.
            var ext = Path.GetExtension(info.FileName);
            if (string.IsNullOrWhiteSpace(ext)) ext = ".jpg";
            var fileName = UniqueFileName.Create("photo", ext);
            var path = Path.Combine(capture.OutputDirectory, fileName);

            // On télécharge vers un flux MÉMOIRE EDSDK puis on écrit le fichier avec .NET.
            // EdsCreateFileStream (I/O fichier natif d'EDSDK) échoue selon le chemin ou les
            // droits (observé : 0x2B FILE_PERMISSION_ERROR sur R100) alors que .NET écrit
            // sans problème au même endroit — d'ailleurs le live view utilise déjà ce schéma.
            ThrowIfError(EdsApi.EdsCreateMemoryStream(info.Size, out stream), "EdsCreateMemoryStream");
            ThrowIfError(EdsApi.EdsDownload(dirItem, info.Size, stream), "EdsDownload");

            // Transfert réussi uniquement : sinon on l'annule (catch).
            transferClosed = true;
            var errComplete = EdsApi.EdsDownloadComplete(dirItem);
            if (errComplete != EdsError.OK)
                _ = _log?.LogWarningAsync("camera-evt", $"EdsDownloadComplete a renvoyé 0x{errComplete:X}.");

            ThrowIfError(EdsApi.EdsGetLength(stream, out ulong length), "EdsGetLength");
            ThrowIfError(EdsApi.EdsGetPointer(stream, out var dataPtr), "EdsGetPointer");
            if (dataPtr == IntPtr.Zero || length == 0)
                throw new InvalidOperationException("Image téléchargée vide (flux EDSDK).");

            var bytes = new byte[length];
            Marshal.Copy(dataPtr, bytes, 0, (int)length);
            AtomicFile.WriteAllBytes(path, bytes);

            _ = _log?.LogInfoAsync("camera-evt", $"Image téléchargée : {fileName} ({length} o) -> {path}");
            capture.Complete(path);
        }
        catch (Exception ex)
        {
            if (!transferClosed)
            {
                try { EdsApi.EdsDownloadCancel(dirItem); } catch { }
            }
            _ = _log?.LogErrorAsync("camera-evt", $"Échec du téléchargement de l'image : {ex.Message}", ex.StackTrace);
            capture.Fail(ex);
        }
        finally
        {
            if (stream != IntPtr.Zero) EdsApi.EdsRelease(stream);
        }
    }

    private void EdsdkThreadLoop()
    {
        foreach (var action in _queue.GetConsumingEnumerable())
        {
            // Une action défaillante ne doit JAMAIS tuer le thread STA :
            // sinon toutes les opérations caméra suivantes se figeraient à l'infini.
            try { action(); }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[EDSDK] action error: {ex.Message}");
            }
        }
    }

    private static void ThrowIfError(uint err, string context)
    {
        if (err != EdsError.OK)
            throw new InvalidOperationException($"EDSDK error in {context}: 0x{err:X8}");
    }
}

// File de travail thread-safe pour le thread STA EDSDK
internal class BlockingQueue<T>
{
    private readonly System.Collections.Concurrent.BlockingCollection<T> _col = new();

    public void Enqueue(T item) => _col.Add(item);
    public System.Collections.Generic.IEnumerable<T> GetConsumingEnumerable() => _col.GetConsumingEnumerable();
}
