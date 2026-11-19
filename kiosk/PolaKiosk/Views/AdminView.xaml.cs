using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class AdminView : UserControl
{
    /// <summary>Glissement au-delà duquel un appui sur une tuile est un défilement, pas un choix (px).</summary>
    private const double TapSlop = 12;

    private ListBoxItem? _pressedChoice;
    private Point _pressedAt;
    private Slider? _pressedSlider;
    private Point _sliderPressedAt;

    public AdminView(AdminViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;
    }

    // Défilement au doigt : arrivé en haut ou en bas d'une section, la fenêtre ne doit pas
    // « rebondir » (comportement par défaut de Windows au bout d'un défilement tactile).
    private void OnManipulationBoundaryFeedback(object? sender, ManipulationBoundaryFeedbackEventArgs e)
        => e.Handled = true;

    // Tuiles de choix (imprimante, caméra, taille des photos, nettoyage) : une liste WPF choisit dès
    // l'appui, et chaque choix est enregistré tout de suite. La tuile n'est donc choisie qu'au
    // relâcher, si le doigt est resté en place (position mesurée sur l'écran admin, qui ne défile
    // pas : un défilement déplace le doigt par rapport à lui).
    private void OnChoicePressed(object sender, MouseButtonEventArgs e)
    {
        _pressedChoice = sender as ListBoxItem;
        _pressedAt = e.GetPosition(this);
        e.Handled = true;
    }

    private void OnChoiceReleased(object sender, MouseButtonEventArgs e)
    {
        var pressed = _pressedChoice;
        _pressedChoice = null;
        if (pressed == null || !ReferenceEquals(pressed, sender)) return;
        e.Handled = true;
        if ((e.GetPosition(this) - _pressedAt).Length <= TapSlop) pressed.IsSelected = true;
    }

    // Curseurs des réglages de l'appareil photo : au doigt, la piste suit l'appui tout de suite et
    // chaque valeur part vers l'appareil, ce qui gêne le défilement de la liste. Un appui au doigt
    // hors de la poignée ne choisit donc la valeur touchée qu'au relâcher, si le doigt est resté en
    // place ; la poignée se tire normalement. À la souris, rien ne change.
    private void OnSliderPressed(object sender, MouseButtonEventArgs e)
    {
        if (sender is not Slider slider || e.StylusDevice == null || IsInThumb(e.OriginalSource as DependencyObject))
            return;
        _pressedSlider = slider;
        _sliderPressedAt = e.GetPosition(this);
        e.Handled = true;
    }

    private void OnSliderReleased(object sender, MouseButtonEventArgs e)
    {
        var slider = _pressedSlider;
        _pressedSlider = null;
        if (slider == null || !ReferenceEquals(slider, sender)) return;
        e.Handled = true;
        if (!slider.IsEnabled || (e.GetPosition(this) - _sliderPressedAt).Length > TapSlop) return;
        if (slider.Template.FindName("PART_Track", slider) is not Track track) return;
        var value = Math.Round(track.ValueFromPoint(e.GetPosition(track)));
        slider.Value = Math.Clamp(value, slider.Minimum, slider.Maximum);
    }

    private static bool IsInThumb(DependencyObject? element)
    {
        for (var current = element; current is Visual; current = VisualTreeHelper.GetParent(current))
        {
            if (current is Thumb) return true;
            if (current is Slider) return false;
        }
        return false;
    }
}
