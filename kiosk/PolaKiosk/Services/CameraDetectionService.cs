using OpenCvSharp;
using System.IO;

namespace PolaKiosk.Services;

public class CameraDetectionService : ICameraDetectionService
{
    private readonly AppSettings _settings;

    public CameraDetectionService(AppSettings settings)
    {
        _settings = settings;
    }

    public List<CameraDeviceInfo> DetectAvailableCameras()
    {
        var cameras = new List<CameraDeviceInfo>();

        // Détecte les webcams disponibles (indices 0 à 4)
        for (int i = 0; i < 5; i++)
        {
            using var cap = new VideoCapture(i);
            if (cap.IsOpened())
            {
                cameras.Add(new CameraDeviceInfo(CameraSource.Webcam, $"Webcam {i}", i));
                cap.Release();
            }
        }

        // Canon possible : EDSDK installé (la présence réelle est vérifiée par CameraHealthService)
        if (IsCanonSdkInstalled())
            cameras.Insert(0, new CameraDeviceInfo(CameraSource.Canon, "Canon EOS R100"));

        return cameras;
    }

    public CameraDeviceInfo SelectBestCamera()
    {
        // Si une source est forcée dans les settings, on la respecte. Canon forcé sans EDSDK : pas de
        // repli silencieux sur la simulation, la borne affiche « Problème technique » (LAB-263).
        if (_settings.Camera.ForcedSource.HasValue)
        {
            return _settings.Camera.ForcedSource.Value switch
            {
                CameraSource.Canon
                    => new CameraDeviceInfo(CameraSource.Canon, "Canon EOS R100"),
                CameraSource.Webcam
                    => new CameraDeviceInfo(CameraSource.Webcam, "Webcam", _settings.Camera.WebcamIndex),
                _ => new CameraDeviceInfo(CameraSource.Mock, "Simulation")
            };
        }

        // Sélection automatique : Canon > Webcam > Mock. Le Canon est choisi dès qu'EDSDK est installé,
        // même débranché au démarrage : la borne ne bascule jamais d'elle-même sur une webcam (LAB-263).
        if (IsCanonSdkInstalled())
            return new CameraDeviceInfo(CameraSource.Canon, "Canon EOS R100");

        var webcams = DetectAvailableCameras().Where(c => c.Source == CameraSource.Webcam).ToList();
        if (webcams.Count > 0)
            return webcams[0];

        return new CameraDeviceInfo(CameraSource.Mock, "Simulation");
    }

    /// <summary>EDSDK.dll livrée avec l'application (ne dit pas si un appareil est branché).</summary>
    public static bool IsCanonSdkInstalled()
        => File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "EDSDK.dll"));
}
