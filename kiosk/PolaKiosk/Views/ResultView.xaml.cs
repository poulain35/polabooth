using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Views;

public partial class ResultView : UserControl
{
    private readonly ResultViewModel _viewModel;

    public ResultView(ResultViewModel viewModel)
    {
        InitializeComponent();
        DataContext = _viewModel = viewModel;

        // Tout appui sur l'écran repousse le retour automatique à l'accueil.
        PreviewMouseDown  += (_, _) => _viewModel.RegisterActivity();
        PreviewTouchDown  += (_, _) => _viewModel.RegisterActivity();
        PreviewStylusDown += (_, _) => _viewModel.RegisterActivity();
        PreviewKeyDown    += (_, _) => _viewModel.RegisterActivity();

        // Animation du GIF (LAB-237) : le lecteur (LoadedBehavior Manual) suit la source du ViewModel.
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded   += (_, _) => PlayAnimation();
        Unloaded += (_, _) => StopAnimation();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(ResultViewModel.AnimationSource)) return;
        if (!Dispatcher.CheckAccess()) { Dispatcher.BeginInvoke(PlayAnimation); return; }
        PlayAnimation();
    }

    private void PlayAnimation()
    {
        var source = _viewModel.AnimationSource;
        if (source == null) { StopAnimation(); return; }
        if (!IsLoaded) return; // lancé au chargement de la vue
        if (AnimationPlayer.Source != source) AnimationPlayer.Source = source;
        AnimationPlayer.Play();
    }

    private void StopAnimation()
    {
        AnimationPlayer.Stop();
        AnimationPlayer.Close();
        AnimationPlayer.Source = null; // libère le fichier (déplacement, nettoyage)
    }

    // Boucle : retour au début à la fin du clip.
    private void OnAnimationEnded(object sender, RoutedEventArgs e)
    {
        AnimationPlayer.Position = TimeSpan.Zero;
        AnimationPlayer.Play();
    }

    private void OnAnimationFailed(object? sender, ExceptionRoutedEventArgs e)
        => _viewModel.OnAnimationFailed(e.ErrorException?.Message);

    // Raccourci de domaine : la commande remplace le texte du champ, puis on remet le curseur en fin
    // de saisie (sinon la touche suivante du clavier tactile s'écrirait au début).
    private void OnDomainClick(object sender, RoutedEventArgs e) =>
        Dispatcher.BeginInvoke(DispatcherPriority.Input, () =>
        {
            EmailBox.Focus();
            EmailBox.Select(EmailBox.Text.Length, 0);
        });
}
