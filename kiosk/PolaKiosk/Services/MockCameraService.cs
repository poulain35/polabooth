using System.IO;

namespace PolaKiosk.Services;

// Stub utilisé pendant le développement sans Canon R100 branché
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
}
