using System.Windows.Controls;
using Microsoft.Extensions.DependencyInjection;

namespace PolaKiosk.Services;

public class NavigationService : INavigationService
{
    // Écrans « racine » : y arriver ferme le parcours en cours, l'historique est vidé.
    // Sans ça, chaque invité empile ses écrans (et leurs images pleine résolution) jusqu'à
    // saturer la mémoire en fin de soirée.
    internal static readonly IReadOnlySet<Type> DefaultRootViews = new HashSet<Type>
    {
        typeof(Views.HomeView),
        typeof(Views.EventSetupView),
        typeof(Views.PairingView),
    };

    internal const int MaxHistory = 10;

    private readonly IServiceProvider _services;
    private readonly IReadOnlySet<Type> _rootViews;
    private readonly List<UserControl> _history = new();
    private ContentControl? _frame;

    public NavigationService(IServiceProvider services) : this(services, DefaultRootViews) { }

    internal NavigationService(IServiceProvider services, IReadOnlySet<Type> rootViews)
    {
        _services  = services;
        _rootViews = rootViews;
    }

    public event EventHandler? Navigated;

    public void SetFrame(ContentControl frame) => _frame = frame;

    public Type? CurrentViewType => (_frame?.Content as UserControl)?.GetType();

    internal int HistoryCount => _history.Count;

    public void NavigateTo<TView>() where TView : UserControl
    {
        var view = _services.GetRequiredService<TView>();
        Navigate(view);
    }

    public void NavigateTo<TView>(object parameter) where TView : UserControl
    {
        var view = _services.GetRequiredService<TView>();
        if (view.DataContext is IParameterReceiver receiver)
            receiver.ReceiveParameter(parameter);
        Navigate(view);
    }

    public void GoBack()
    {
        if (_frame == null || _history.Count == 0) return;

        var previous = _history[^1];
        _history.RemoveAt(_history.Count - 1);
        var left = _frame.Content as UserControl;
        _frame.Content = previous;
        Release(left);
        Navigated?.Invoke(this, EventArgs.Empty);
    }

    private void Navigate(UserControl view)
    {
        if (_frame == null) return;

        var current = _frame.Content as UserControl;
        _frame.Content = view;

        if (_rootViews.Contains(view.GetType()))
        {
            foreach (var old in _history) Release(old);
            _history.Clear();
            Release(current);
        }
        else if (current != null)
        {
            _history.Add(current);
            if (_history.Count > MaxHistory)
            {
                Release(_history[0]);
                _history.RemoveAt(0);
            }
        }

        Navigated?.Invoke(this, EventArgs.Empty);
    }

    private static void Release(UserControl? view)
    {
        if (view?.DataContext is IReleasable releasable)
        {
            try { releasable.Release(); }
            catch { /* un écran quitté ne doit jamais bloquer la navigation */ }
        }
    }
}

public interface IParameterReceiver
{
    void ReceiveParameter(object parameter);
}

/// <summary>
/// ViewModel qui libère ses ressources lourdes (images, timers) quand son écran est
/// définitivement quitté. Volontairement distinct d'IDisposable : le conteneur DI garderait
/// une référence vers chaque transient IDisposable jusqu'à la fermeture de l'app.
/// </summary>
public interface IReleasable
{
    void Release();
}
