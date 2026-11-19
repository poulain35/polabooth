using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class AdminView : UserControl
{
    /// <summary>Glissement au-delà duquel un appui sur une tuile est un défilement, pas un choix (px).</summary>
    private const double TapSlop = 12;

    private ListBoxItem? _pressedChoice;
    private Point _pressedAt;

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
}
