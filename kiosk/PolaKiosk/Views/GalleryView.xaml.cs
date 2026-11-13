using System.Windows;
using System.Windows.Controls;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class GalleryView : UserControl
{
    // Largeur d'une carte : vignette + marge intérieure, bordure et marge extérieure.
    private const double CardWidth = GalleryViewModel.DisplayWidth + 2 * 6 + 2 * 1.5 + 2 * 10;
    private const double HorizontalPadding = 2 * 24;

    private readonly GalleryViewModel _viewModel;

    public GalleryView(GalleryViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = viewModel;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
        => await _viewModel.InitializeAsync();

    private void OnGridSizeChanged(object sender, SizeChangedEventArgs e)
        => _viewModel.SetColumns((int)((e.NewSize.Width - HorizontalPadding) / CardWidth));

    private void OnCardLoaded(object sender, RoutedEventArgs e) => UpdateCard((FrameworkElement)sender);
    private void OnCardUnloaded(object sender, RoutedEventArgs e) => UpdateCard((FrameworkElement)sender);
    private void OnCardDataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
        => UpdateCard((FrameworkElement)sender);

    /// <summary>
    /// Une carte affichée retient la vignette de sa photo, une carte retirée la libère.
    /// Tag = photo actuellement retenue par la carte.
    /// </summary>
    private static void UpdateCard(FrameworkElement card)
    {
        var shown = card.IsLoaded ? card.DataContext as GalleryPhoto : null;
        if (ReferenceEquals(card.Tag, shown)) return;

        (card.Tag as GalleryPhoto)?.RemoveViewer();
        card.Tag = shown;
        _ = shown?.AddViewerAsync();
    }
}
