using System.Windows.Media.Imaging;
using QRCoder;

namespace PolaKiosk.Services;

/// <summary>QR code d'un lien, figé (association de la borne, partage de la photo).</summary>
public static class QrCodeRenderer
{
    /// <summary>Taille du QR code de l'écran d'association.</summary>
    public const int PairingPixelsPerModule = 20;

    /// <summary>Taille du QR code de partage (écran Result).</summary>
    public const int SharePixelsPerModule = 10;

    public static BitmapImage Render(string url, int pixelsPerModule)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(url, QRCodeGenerator.ECCLevel.M);
        using var code = new PngByteQRCode(data);
        return ImageLoader.FromBytes(code.GetGraphic(pixelsPerModule));
    }
}
