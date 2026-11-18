using System.IO;
using PolaKiosk.Services;
using SkiaSharp;

namespace PolaKiosk.ViewModels;

/// <summary>Outils purs du test caméra de l'admin (LAB-263).</summary>
public static class CameraTest
{
    /// <summary>« Webcam en basse définition : WxH » sous 1280×720 (webcam seulement), sinon vide.</summary>
    public static string LowDefinitionWarning(int width, int height, bool isWebcam)
        => isWebcam && WebcamCameraService.IsLowDefinition(width, height)
            ? $"Webcam en basse définition : {width}x{height}"
            : "";

    /// <summary>Largeur et hauteur d'une image, lues dans son en-tête.</summary>
    public static (int Width, int Height) ReadSize(string path)
    {
        using var codec = SKCodec.Create(path)
            ?? throw new InvalidDataException("Image de test illisible.");
        return (codec.Info.Width, codec.Info.Height);
    }
}
