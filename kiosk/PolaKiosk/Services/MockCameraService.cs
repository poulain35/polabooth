using System.IO;
using PolaKiosk.Models;
using SkiaSharp;

namespace PolaKiosk.Services;

// Stub utilisé pendant le développement sans appareil Canon branché
public class MockCameraService : ICameraService
{
    // Taille d'une photo simulée : paysage 3:2, comme le Canon, assez grande pour le montage.
    internal const int PhotoWidth  = 1800;
    internal const int PhotoHeight = 1200;

    private int _shot;

    public bool IsConnected => true;

    public Task InitializeAsync() => Task.CompletedTask;

    public Task StartLiveViewAsync(Action<byte[]> frameCallback) => Task.CompletedTask;

    public Task StopLiveViewAsync() => Task.CompletedTask;

    /// <summary>
    /// Écrit une vraie photo JPEG (LAB-237) : montage, GIF et mesures fonctionnent sans appareil.
    /// Chaque prise change de couleur et de position du disque : les images d'un GIF se distinguent.
    /// </summary>
    public async Task<string> CaptureAsync(string outputDirectory)
    {
        await Task.Delay(500);
        int shot = Interlocked.Increment(ref _shot);
        var path = Path.Combine(outputDirectory, UniqueFileName.Create("mock", ".jpg"));
        await Task.Run(() => WritePhoto(path, shot));
        return path;
    }

    internal static void WritePhoto(string path, int shot)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var bitmap = new SKBitmap(PhotoWidth, PhotoHeight);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColor.FromHsl(shot * 67 % 360, 45, 70));
            using var paint = new SKPaint { Color = SKColor.FromHsl((shot * 67 + 180) % 360, 55, 40), IsAntialias = true };
            float x = PhotoWidth * (0.25f + 0.5f * (shot % 4) / 3f);
            canvas.DrawCircle(x, PhotoHeight / 2f, PhotoHeight / 4f, paint);
        }
        using var data = KioskJpeg.Encode(bitmap, 90)
            ?? throw new InvalidOperationException("Photo simulée : encodage JPEG impossible.");
        using var file = File.Create(path);
        data.SaveTo(file);
    }

    public Task ShutdownAsync() => Task.CompletedTask;

    // Réglages d'exposition : Canon seulement (LAB-427).
    public bool SupportsExposureSettings => false;
    public Task<CameraExposureState?> ReadExposureAsync() => Task.FromResult<CameraExposureState?>(null);
    public Task<CameraExposureState?> ApplyExposureAsync(CameraExposureValues values) => Task.FromResult<CameraExposureState?>(null);
    public event EventHandler? ExposureOptionsChanged { add { } remove { } }
}
