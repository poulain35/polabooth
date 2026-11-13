using OpenCvSharp;
using System.IO;

namespace PolaKiosk.Services;

public class WebcamCameraService : ICameraService, ICameraPresenceCheck
{
    /// <summary>Résolution demandée par défaut (LAB-263) : 1080p.</summary>
    public const int DefaultWidth = 1920, DefaultHeight = 1080;

    /// <summary>En dessous, l'admin prévient : « Webcam en basse définition ».</summary>
    public const int MinGoodWidth = 1280, MinGoodHeight = 720;

    private readonly int _deviceIndex;
    private readonly int _requestedWidth;
    private readonly int _requestedHeight;
    // VideoCapture n'est pas thread-safe : lectures (live view, capture) et libération passent par ce verrou.
    private readonly object _captureLock = new();
    private VideoCapture? _capture;
    private CancellationTokenSource? _cts;
    private Task _liveViewTask = Task.CompletedTask;

    public bool IsConnected
    {
        get { lock (_captureLock) return _capture?.IsOpened() ?? false; }
    }

    /// <summary>Résolution réellement obtenue à l'ouverture (relue sur la webcam), null avant.</summary>
    public (int Width, int Height)? ActualResolution { get; private set; }

    public WebcamCameraService(int deviceIndex = 0, int requestedWidth = DefaultWidth, int requestedHeight = DefaultHeight)
    {
        _deviceIndex     = deviceIndex;
        _requestedWidth  = requestedWidth  > 0 ? requestedWidth  : DefaultWidth;
        _requestedHeight = requestedHeight > 0 ? requestedHeight : DefaultHeight;
    }

    /// <summary>Résolution trop basse pour un tirage correct (moins de 1280×720).</summary>
    public static bool IsLowDefinition(int width, int height) => width < MinGoodWidth || height < MinGoodHeight;

    public Task InitializeAsync()
    {
        lock (_captureLock)
        {
            if (_capture?.IsOpened() == true) return Task.CompletedTask;
            _capture?.Dispose();
            _capture = null;

            var capture = new VideoCapture(_deviceIndex);
            if (!capture.IsOpened())
            {
                capture.Dispose();
                throw new InvalidOperationException($"Impossible d'ouvrir la webcam (index {_deviceIndex}).");
            }
            ActualResolution = ApplyResolution(capture, _requestedWidth, _requestedHeight);
            _capture = capture;
        }
        return Task.CompletedTask;
    }

    /// <summary>
    /// Demande la résolution voulue puis relit celle obtenue. Beaucoup de webcams ne donnent le 1080p
    /// qu'en MJPG (le flux brut YUY2 plafonne souvent à 640×480) : second essai en MJPG si besoin.
    /// </summary>
    private static (int Width, int Height) ApplyResolution(VideoCapture capture, int width, int height)
    {
        var actual = RequestSize(capture, width, height);
        if (actual.Width >= width && actual.Height >= height) return actual;

        capture.Set(VideoCaptureProperties.FourCC, VideoWriter.FourCC('M', 'J', 'P', 'G'));
        var mjpg = RequestSize(capture, width, height);
        return mjpg.Width * mjpg.Height >= actual.Width * actual.Height ? mjpg : actual;
    }

    private static (int Width, int Height) RequestSize(VideoCapture capture, int width, int height)
    {
        capture.Set(VideoCaptureProperties.FrameWidth, width);
        capture.Set(VideoCaptureProperties.FrameHeight, height);
        return ((int)capture.Get(VideoCaptureProperties.FrameWidth), (int)capture.Get(VideoCaptureProperties.FrameHeight));
    }

    /// <summary>
    /// Webcam branchée ? (LAB-263) Ouverte : une image doit pouvoir être lue, sinon elle est fermée
    /// (débranchée) pour que la prochaine prise de vue la rouvre. Fermée : ouverture d'essai, refermée aussitôt.
    /// </summary>
    public Task<bool> IsPresentAsync(CancellationToken cancellationToken) => Task.Run(() =>
    {
        lock (_captureLock)
        {
            if (_capture != null)
            {
                using var frame = new Mat();
                if (_capture.IsOpened() && _capture.Read(frame) && !frame.Empty()) return true;
                _capture.Release();
                _capture.Dispose();
                _capture = null;
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        using var probe = new VideoCapture(_deviceIndex);
        var opened = probe.IsOpened();
        probe.Release();
        return opened;
    }, cancellationToken);

    public async Task StartLiveViewAsync(Action<byte[]> frameCallback)
    {
        if (!IsConnected) throw new InvalidOperationException("Caméra non initialisée.");

        // Une seule boucle à la fois : la précédente est arrêtée avant d'en lancer une autre.
        await StopLiveViewAsync();

        var cts = new CancellationTokenSource();
        _cts = cts;
        var token = cts.Token;

        _liveViewTask = Task.Run(() =>
        {
            using var frame = new Mat();
            while (!token.IsCancellationRequested)
            {
                byte[]? bytes = null;
                lock (_captureLock)
                {
                    if (_capture == null) break;
                    if (_capture.Read(frame) && !frame.Empty())
                        bytes = frame.ToBytes(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85));
                }
                if (bytes != null) frameCallback(bytes);
                Thread.Sleep(33); // ~30fps
            }
        }, token);
    }

    public async Task StopLiveViewAsync()
    {
        var cts = _cts;
        _cts = null;
        if (cts == null) return;

        cts.Cancel();
        try { await _liveViewTask; }
        catch { /* boucle déjà arrêtée ou frame en erreur : rien à faire */ }
        cts.Dispose();
    }

    public async Task<string> CaptureAsync(string outputDirectory)
    {
        await Task.Delay(100);

        Directory.CreateDirectory(outputDirectory);
        var path = Path.Combine(outputDirectory, UniqueFileName.Create("photo", ".jpg"));

        using var frame = new Mat();
        lock (_captureLock)
        {
            if (_capture == null) throw new InvalidOperationException("Caméra non initialisée.");
            if (!_capture.Read(frame) || frame.Empty())
                throw new InvalidOperationException("Impossible de capturer une image.");
        }

        if (!Cv2.ImWrite(path, frame))
            throw new InvalidOperationException("Impossible d'enregistrer la photo.");
        return path;
    }

    public async Task ShutdownAsync()
    {
        await StopLiveViewAsync();
        lock (_captureLock)
        {
            _capture?.Release();
            _capture?.Dispose();
            _capture = null;
        }
    }
}
