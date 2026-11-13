namespace PolaKiosk.Services;

public interface ICameraDetectionService
{
    List<CameraDeviceInfo> DetectAvailableCameras();
    CameraDeviceInfo SelectBestCamera();
}
