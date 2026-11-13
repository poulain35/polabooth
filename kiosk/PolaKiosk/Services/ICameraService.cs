namespace PolaKiosk.Services;

public interface ICameraService
{
    Task InitializeAsync();
    Task StartLiveViewAsync(Action<byte[]> frameCallback);
    Task StopLiveViewAsync();
    Task<string> CaptureAsync(string outputDirectory);
    Task ShutdownAsync();
    bool IsConnected { get; }
}
