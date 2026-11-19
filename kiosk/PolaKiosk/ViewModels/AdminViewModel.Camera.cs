using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

// Admin : choix de la caméra, puis test de l'appareil (aperçu, photo de test, LAB-263).
public partial class AdminViewModel
{
    private void LoadCameras()
    {
        AvailableCameras.Clear();
        AvailableCameras.Add(new CameraSourceOption("Détection automatique", null, 0));

        foreach (var c in _cameraDetection.DetectAvailableCameras())
        {
            if (c.Source == CameraSource.Canon)
                AvailableCameras.Add(new CameraSourceOption(c.Name, "canon", 0));
            else if (c.Source == CameraSource.Webcam)
                AvailableCameras.Add(new CameraSourceOption($"Webcam {c.DeviceIndex}", "webcam", c.DeviceIndex));
        }

        AvailableCameras.Add(new CameraSourceOption("Simulation (test)", "mock", 0));

        // Sélection courante d'après la config appliquée
        var forced = _settings.Camera.ForcedSource;
        SelectedCamera = forced switch
        {
            CameraSource.Canon  => AvailableCameras.FirstOrDefault(o => o.Mode == "canon"),
            CameraSource.Webcam => AvailableCameras.FirstOrDefault(o => o.Mode == "webcam" && o.WebcamIndex == _settings.Camera.WebcamIndex)
                                   ?? AvailableCameras.FirstOrDefault(o => o.Mode == "webcam"),
            CameraSource.Mock   => AvailableCameras.FirstOrDefault(o => o.Mode == "mock"),
            _                   => AvailableCameras[0],
        } ?? AvailableCameras[0];
    }

    [RelayCommand]
    private void SaveCamera()
    {
        var opt = SelectedCamera;
        if (opt == null) return;

        _machine.SetCamera(opt.Mode, opt.Mode == "webcam" ? opt.WebcamIndex : (int?)null);

        // Reflet dans la config en mémoire (effectif si le service caméra n'a pas encore été créé)
        _settings.Camera.ForcedSource = opt.Mode switch
        {
            "canon"  => CameraSource.Canon,
            "webcam" => CameraSource.Webcam,
            "mock"   => CameraSource.Mock,
            _        => (CameraSource?)null,
        };
        if (opt.Mode == "webcam") _settings.Camera.WebcamIndex = opt.WebcamIndex;

        CameraStatusMsg = $"✓ Caméra : {opt.Label} — redémarrez le kiosk pour l'appliquer.";
    }

    /// <summary>« Tester la caméra » : ouvre l'appareil choisi au démarrage et affiche l'aperçu.</summary>
    [RelayCommand]
    private async Task TestCameraAsync()
    {
        if (_camera == null || IsTestingCamera) return;
        IsTestingCamera      = true;
        LowDefinitionWarning = "";
        CameraTestMsg        = "Ouverture de l'appareil…";
        try
        {
            await _camera.InitializeAsync();
            await _camera.StartLiveViewAsync(OnTestFrame);
            _previewRunning = true;
            if (_camera is WebcamCameraService { ActualResolution: { } res } && res.Width > 0)
            {
                CameraTestMsg        = $"Aperçu en cours. Webcam : {res.Width} × {res.Height}.";
                LowDefinitionWarning = CameraTest.LowDefinitionWarning(res.Width, res.Height, isWebcam: true);
            }
            else
            {
                CameraTestMsg = "Aperçu en cours. Prenez une photo de test pour vérifier la définition.";
            }
        }
        catch (Exception ex)
        {
            CameraTestMsg = $"Appareil photo introuvable : {ex.Message}";
            await StopPreviewAsync();
        }
        finally { IsTestingCamera = false; }
    }

    /// <summary>Une photo de test : définition lue dans le fichier obtenu, puis fichier supprimé.</summary>
    [RelayCommand]
    private async Task CaptureTestPhotoAsync()
    {
        if (_camera == null || IsTestingCamera) return;
        IsTestingCamera = true;
        CameraTestMsg   = "Photo de test en cours…";
        var dir = Path.Combine(Path.GetTempPath(), "PolaKiosk", "camera-test");
        try
        {
            await _camera.InitializeAsync();
            Directory.CreateDirectory(dir);
            var path = await _camera.CaptureAsync(dir);
            var (w, h) = CameraTest.ReadSize(path);
            try { File.Delete(path); } catch { /* photo de test dans le dossier temporaire de Windows */ }

            var isWebcam = _camera is WebcamCameraService;
            CameraTestMsg        = $"✓ Photo de test réussie : {w} × {h} px.";
            LowDefinitionWarning = CameraTest.LowDefinitionWarning(w, h, isWebcam);
        }
        catch (Exception ex)
        {
            CameraTestMsg = $"La photo de test a échoué : {ex.Message}";
        }
        finally
        {
            // La prise de vue arrête l'aperçu (Canon) : on le coupe proprement dans tous les cas.
            await StopPreviewAsync();
            IsTestingCamera = false;
        }
    }

    [RelayCommand]
    private Task StopCameraTestAsync() => StopPreviewAsync();

    private void OnTestFrame(byte[] jpegBytes)
    {
        if (!_previewRunning) return;
        BitmapSource? frame;
        try { frame = ImageLoader.FromBytes(jpegBytes, PreviewDecodeWidth); }
        catch { return; }
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher == null) return;
        dispatcher.BeginInvoke(() =>
        {
            if (!_previewRunning) return;
            TestPreview    = frame;
            HasTestPreview = true;
        });
    }

    private async Task StopPreviewAsync()
    {
        var wasRunning = _previewRunning;
        _previewRunning = false;
        TestPreview     = null;
        HasTestPreview  = false;
        if (wasRunning && _camera != null)
        {
            try { await _camera.StopLiveViewAsync(); } catch { /* appareil débranché : plus d'aperçu de toute façon */ }
        }
    }

    /// <summary>Sortie de l'écran admin (navigation) : l'aperçu ne doit pas continuer en arrière-plan.</summary>
    public void Release()
    {
        UnsubscribeExposure(); // écran Appareil photo (LAB-427)
        _ = StopPreviewAsync();
    }
}
