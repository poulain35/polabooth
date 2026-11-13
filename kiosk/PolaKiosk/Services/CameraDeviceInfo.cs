namespace PolaKiosk.Services;

public enum CameraSource { Mock, Webcam, Canon }

public record CameraDeviceInfo(CameraSource Source, string Name, int DeviceIndex = 0);
