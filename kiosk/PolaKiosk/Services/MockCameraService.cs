using System.IO;
using PolaKiosk.Models;

namespace PolaKiosk.Services;

// Stub utilisé pendant le développement sans appareil Canon branché
public class MockCameraService : ICameraService
{
    public bool IsConnected => true;

    public Task InitializeAsync() => Task.CompletedTask;

    public Task StartLiveViewAsync(Action<byte[]> frameCallback) => Task.CompletedTask;

    public Task StopLiveViewAsync() => Task.CompletedTask;

    public async Task<string> CaptureAsync(string outputDirectory)
    {
        await Task.Delay(500);
        return Path.Combine(outputDirectory, UniqueFileName.Create("mock", ".jpg"));
    }

    public Task ShutdownAsync() => Task.CompletedTask;

    // Réglages d'exposition : Canon seulement (LAB-427).
    public bool SupportsExposureSettings => false;
    public Task<CameraExposureState?> ReadExposureAsync() => Task.FromResult<CameraExposureState?>(null);
    public Task<CameraExposureState?> ApplyExposureAsync(CameraExposureValues values) => Task.FromResult<CameraExposureState?>(null);
    public event EventHandler? ExposureOptionsChanged { add { } remove { } }
}
