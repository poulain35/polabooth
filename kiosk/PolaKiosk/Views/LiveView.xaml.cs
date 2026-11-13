using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class LiveView : UserControl
{
    private readonly LiveViewModel _viewModel;

    // Compte à rebours en cours (LAB-248) : chronomètres de l'anneau et du texte, recalculés à chaque image.
    private readonly Stopwatch _ringClock = new();
    private readonly Stopwatch _textClock = new();
    private TimeSpan _ringTotal = TimeSpan.FromSeconds(1);
    private bool _rendering;

    public LiveView(LiveViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = viewModel;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        await _viewModel.StartAsync();
    }

    private async void OnUnloaded(object sender, RoutedEventArgs e)
    {
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        StopCountdown();
        await _viewModel.StopAsync();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        Action? action = e.PropertyName switch
        {
            // Début d'un compte à rebours (chaque photo d'un modèle à plusieurs photos).
            // CountdownTotalSeconds et CountdownValue sont déjà à jour (réglés avant IsCountingDown).
            nameof(LiveViewModel.IsCountingDown) when _viewModel.IsCountingDown => StartCountdown,
            nameof(LiveViewModel.IsCountingDown) => StopCountdown,
            nameof(LiveViewModel.CountdownValue) when _viewModel.IsCountingDown => PopText,
            _ => null,
        };
        if (action == null) return;

        if (Dispatcher.CheckAccess()) action();
        else Dispatcher.InvokeAsync(action);
    }

    private void StartCountdown()
    {
        _ringTotal = TimeSpan.FromSeconds(Math.Max(1, _viewModel.CountdownTotalSeconds));
        _ringClock.Restart();
        PopText();
        if (!_rendering)
        {
            CompositionTarget.Rendering += OnRendering;
            _rendering = true;
        }
    }

    private void StopCountdown()
    {
        if (_rendering)
        {
            CompositionTarget.Rendering -= OnRendering;
            _rendering = false;
        }
        _ringClock.Reset();
        _textClock.Reset();
    }

    /// <summary>Nouveau chiffre : il est redessiné et réapparaît avec l'effet « pop ».</summary>
    private void PopText()
    {
        CountdownDigit.Data = CountdownGeometry.Digit(
            _viewModel.CountdownValue.ToString(CultureInfo.InvariantCulture),
            KioskFonts.Title, VisualTreeHelper.GetDpi(this).PixelsPerDip);
        _textClock.Restart();
        Render(CountdownGeometry.Progress(_ringClock.Elapsed, _ringTotal), _textClock.Elapsed);
    }

    private void OnRendering(object? sender, EventArgs e) => Render(CountdownGeometry.Progress(_ringClock.Elapsed, _ringTotal), _textClock.Elapsed);

    /// <summary>
    /// L'anneau se vide en continu sur toute la durée du compte à rebours (il est vide au
    /// flash) ; le chiffre grossit jusqu'à 106 % en devenant opaque, puis revient à 100 %.
    /// </summary>
    internal void Render(double ringProgress, TimeSpan textElapsed)
    {
        CountdownRing.Data = CountdownGeometry.Arc(ringProgress);
        var (scale, opacity) = CountdownGeometry.Pop(textElapsed);
        CountdownTextScale.ScaleX = CountdownTextScale.ScaleY = scale;
        CountdownText.Opacity = opacity;
    }
}
