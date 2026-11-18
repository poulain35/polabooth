using System.Globalization;
using System.Windows.Data;
using PolaKiosk.Services;

namespace PolaKiosk.Converters;

/// <summary>Lien → image de QR code (null si le lien est vide). Utilisé par l'écran d'association.</summary>
public class UrlToQrImageConverter : IValueConverter
{
    public object? Convert(object value, Type targetType, object parameter, CultureInfo culture)
        => value is string url && url.Length > 0
            ? QrCodeRenderer.Render(url, QrCodeRenderer.PairingPixelsPerModule)
            : null;

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
