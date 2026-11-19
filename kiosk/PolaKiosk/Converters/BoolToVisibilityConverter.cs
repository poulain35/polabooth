using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace PolaKiosk.Converters;

/// <summary>
/// Vrai, ou texte non vide (messages d'état de l'Admin), = visible. Paramètre « invert » : l'inverse.
/// </summary>
public class BoolToVisibilityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        bool visible = value is true || value is string { Length: > 0 };
        if (parameter is string p && p == "invert") visible = !visible;
        return visible ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => value is Visibility.Visible;
}
