using System.Windows;
using System.Windows.Threading;

namespace PolaKiosk.Services;

/// <summary>
/// Ramène le kiosk à l'accueil après une période d'inactivité, pour éviter
/// qu'une session abandonnée laisse le kiosk bloqué sur un écran intermédiaire.
/// </summary>
public class IdleTimeoutService : IIdleTimeoutService
{
    private readonly INavigationService _navigation;
    private readonly IKioskStateService _state;
    private readonly AppSettings _settings;
    private readonly Func<IIdleTimer> _timerFactory;
    private IIdleTimer? _timer;
    private int _seconds;

    public IdleTimeoutService(INavigationService navigation, IKioskStateService state, AppSettings settings)
        : this(navigation, state, settings, () => new DispatcherIdleTimer()) { }

    internal IdleTimeoutService(INavigationService navigation, IKioskStateService state, AppSettings settings,
        Func<IIdleTimer> timerFactory)
    {
        _navigation   = navigation;
        _state        = state;
        _settings     = settings;
        _timerFactory = timerFactory;
        _navigation.Navigated += (_, _) => Restart();
    }

    // Écrans du parcours invité où une session abandonnée doit revenir à l'accueil.
    // Live (prise de vue + montage) n'en fait pas partie : personne ne touche l'écran
    // pendant une bande de 3-4 photos, le délai la couperait en pleine prise. Live gère
    // lui-même ses erreurs (retour accueil après 6 s).
    // Les écrans staff (saisie code, admin, licence) ne sont pas concernés.
    internal static readonly IReadOnlySet<Type> SessionScreens = new HashSet<Type>
    {
        typeof(Views.FrameSelectView),
        typeof(Views.ResultView),
        typeof(Views.EffectSelectView),
        typeof(Views.GalleryView),
    };

    internal bool IsRunning => _timer?.IsEnabled == true;

    public void Attach(Window window)
    {
        // Toute interaction (souris / tactile / clavier / stylet) réinitialise le compte à rebours
        window.PreviewMouseDown  += (_, _) => Reset();
        window.PreviewKeyDown     += (_, _) => Reset();
        window.PreviewTouchDown   += (_, _) => Reset();
        window.PreviewStylusDown  += (_, _) => Reset();

        // Délai initial = valeur locale par défaut ; la config de l'événement l'ajuste via SetTimeout().
        SetTimeout(_settings.Kiosk.IdleTimeoutSeconds);
    }

    public void SetTimeout(int seconds)
    {
        _seconds = seconds;
        if (seconds > 0)
        {
            _timer ??= CreateTimer();
            _timer.Interval = TimeSpan.FromSeconds(seconds);
        }
        Restart();
    }

    public void Reset() => Restart();

    // Repart de zéro sur un écran de session ; ailleurs le compte à rebours est suspendu.
    private void Restart()
    {
        if (_timer == null) return;
        _timer.Stop();
        if (_seconds > 0 && IsOnSessionScreen())
            _timer.Start();
    }

    private bool IsOnSessionScreen()
        => _navigation.CurrentViewType is { } current && SessionScreens.Contains(current);

    private IIdleTimer CreateTimer()
    {
        var t = _timerFactory();
        t.Tick += OnTick;
        return t;
    }

    private void OnTick(object? sender, EventArgs e)
    {
        _timer?.Stop();

        // Un événement doit être chargé pour que l'accueil ait du sens
        if (_state.ActiveEventId is not { } id || id == Guid.Empty) return;
        if (!IsOnSessionScreen()) return;

        try { _navigation.NavigateTo<Views.HomeView>(); }
        catch { Restart(); /* navigation impossible → on réessaiera au prochain délai */ }
    }
}

/// <summary>Minuterie du délai d'inactivité (abstraite pour les tests).</summary>
internal interface IIdleTimer
{
    TimeSpan Interval { get; set; }
    bool IsEnabled { get; }
    event EventHandler? Tick;
    void Start();
    void Stop();
}

internal sealed class DispatcherIdleTimer : IIdleTimer
{
    private readonly DispatcherTimer _timer = new();

    public TimeSpan Interval { get => _timer.Interval; set => _timer.Interval = value; }
    public bool IsEnabled => _timer.IsEnabled;

    public event EventHandler? Tick
    {
        add    => _timer.Tick += value;
        remove => _timer.Tick -= value;
    }

    public void Start() => _timer.Start();
    public void Stop()  => _timer.Stop();
}
