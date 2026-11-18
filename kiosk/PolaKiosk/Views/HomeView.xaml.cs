using System.ComponentModel;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

/// <summary>
/// Espacement des lettres des surtitres et de la date courte (maquette : 3 px). WPF n'a pas de
/// letter-spacing : une espace fine (U+2009, 1/5 de la taille) est glissée entre les caractères.
/// </summary>
public sealed class LetterSpacingConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is string text ? Spaced(text) : "";

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();

    internal static string Spaced(string text) => string.Join('\u2009', text.EnumerateRunes());
}

public partial class HomeView : UserControl
{
    // Surface de la maquette : 800 de haut, largeur à la proportion de l'écran (au moins 1200).
    private const double DesignHeight = 800, MinDesignWidth = 1200;

    // Largeur utile de la colonne de texte (720 moins la marge de gauche de 80).
    private const double TextColumnWidth = 640;

    private readonly HomeViewModel _viewModel;

    public HomeView(HomeViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = viewModel;
        Loaded   += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.PropertyChanged += OnViewModelChanged;
        FitTitles();
        await _viewModel.InitializeAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
        => _viewModel.PropertyChanged -= OnViewModelChanged;

    private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(HomeViewModel.DisplayName) or nameof(HomeViewModel.Layout))
            FitTitles();
    }

    // La surface prend la proportion de l'écran : la Viewbox la remplit sans bandes.
    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (e.NewSize.Width <= 0 || e.NewSize.Height <= 0) return;
        DesignSurface.Width = Math.Max(MinDesignWidth, DesignHeight * e.NewSize.Width / e.NewSize.Height);
    }

    // Appui n'importe où (1a, 1b) → démarre la séance ; sans effet en 1c (tuiles seulement).
    private void OnScreenTapped(object sender, MouseButtonEventArgs e)
        => _viewModel.StartCommand.Execute(null);

    // Appui sur le tirage → galerie, s'il y a des photos ; sinon l'appui démarre comme ailleurs.
    private void OnPrintTapped(object sender, MouseButtonEventArgs e)
    {
        if (!_viewModel.HasPhotos) return;
        e.Handled = true;
        _viewModel.OpenGalleryCommand.Execute(null);
    }

    // ── Grands titres : la plus grande taille où le texte tient sur deux lignes ──
    private void FitTitles()
    {
        FitTitle(NeutralTitle, maxSize: 96,  minSize: 56, lineFactor: 0.98);
        FitTitle(NameTitle,    maxSize: 108, minSize: 56, lineFactor: 0.95);
    }

    private void FitTitle(TextBlock title, double maxSize, double minSize, double lineFactor)
    {
        var size = TextFit.FitFontSize(title.Text ?? "", Typeface(title), maxSize, minSize, lineFactor,
            TextColumnWidth, maxLines: 2, VisualTreeHelper.GetDpi(this).PixelsPerDip);
        title.FontSize   = size;
        title.LineHeight = Math.Round(size * lineFactor);
    }

    private static Typeface Typeface(TextBlock block)
        => new(block.FontFamily, block.FontStyle, block.FontWeight, block.FontStretch);
}
