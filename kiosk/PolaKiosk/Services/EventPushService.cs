using Microsoft.Extensions.DependencyInjection;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Services;

/// <inheritdoc cref="IEventPushService"/>
public sealed class EventPushService : IEventPushService
{
    internal const string LogContext = "event-push";

    private readonly ISupabaseService _supabase;
    private readonly IServiceScopeFactory _scopes;
    private readonly IKioskStateService _state;
    private readonly INavigationService _navigation;
    private readonly IKioskLogService _log;

    private volatile EventPushRequest? _pending;   // lu, pas encore chargé
    private volatile EventPushRequest? _unacked;   // chargé, confirmation restée sans réponse (réseau)

    public EventPushService(ISupabaseService supabase, IServiceScopeFactory scopes, IKioskStateService state,
        INavigationService navigation, IKioskLogService log)
    {
        _supabase   = supabase;
        _scopes     = scopes;
        _state      = state;
        _navigation = navigation;
        _log        = log;
    }

    public bool HasPending => _pending != null;

    public async Task PollAsync(CancellationToken ct = default)
    {
        EventPushRequest? request;
        try
        {
            // Confirmation perdue (coupure juste après le chargement) : la renvoyer d'abord, sinon le
            // SaaS reste sur « en attente » et la borne rechargerait le même événement.
            if (_unacked is { } unacked)
            {
                await _supabase.AckEventPushAsync(unacked.Event.Id, unacked.RequestedAt, null, ct);
                _unacked = null;
            }
            request = await _supabase.GetEventPushRequestAsync(ct);
        }
        catch (KioskLicenseRefusedException)
        {
            _pending = null;
            _unacked = null;
            return;
        }

        _pending = request;
    }

    /// <summary>Durée d'affichage de l'événement chargé avant l'accueil (comme après la saisie du code).</summary>
    internal static readonly TimeSpan LoadedScreenDelay = TimeSpan.FromSeconds(2);

    /// <summary>Attente avant l'accueil. Remplaçable dans les tests.</summary>
    internal Func<TimeSpan, Task> Delay { get; set; } = Task.Delay;

    /// <summary>
    /// LAB-246 : lecture rapprochée (20 s) de l'envoi, seulement en ligne sur l'accueil ou la saisie du code
    /// (aucune séance invité, aucun démarrage en cours).
    /// </summary>
    public static bool ShouldPollQuickly(Type? currentView, bool online)
        => online && (currentView == typeof(HomeView) || currentView == typeof(EventSetupView));

    public async Task<EventPushOutcome> TryApplyAsync(bool showLoadingScreen, CancellationToken ct = default)
    {
        var request = _pending;
        if (request == null) return EventPushOutcome.None;
        var previous = _navigation.CurrentViewType;
        if (!UpdateCoordinator.CanApplyNow(previous)) return EventPushOutcome.Skipped;

        // LAB-246 : écran de chargement dès le début de la synchro (accueil ou saisie du code), pour que
        // personne ne lance une séance sur l'ancien événement. Au démarrage, Splash reste affiché.
        var loadingShown = showLoadingScreen && previous != typeof(SplashView);
        if (loadingShown)
            _navigation.NavigateTo<EventLoadingView>(new EventLoadingParameters(request.Event.Name, ContinueToHome: false));

        EventEntity? ev;
        try
        {
            using var scope = _scopes.CreateScope();
            ev = await scope.ServiceProvider.GetRequiredService<ISyncService>().SyncPushedEventAsync(request.Event, ct);
        }
        catch (Exception ex) when (ex is OperationCanceledException || SyncService.IsNetworkUnavailable(ex, ct))
        {
            if (loadingShown) ReturnTo(previous);
            return EventPushOutcome.Skipped; // réseau coupé ou trop lent : nouvel essai au prochain cycle
        }
        catch (Exception ex)
        {
            if (loadingShown) ReturnTo(previous);
            await LogSafeAsync(() => _log.LogErrorAsync(LogContext,
                $"Événement envoyé '{request.Event.Name}' non chargé ({ex.GetType().Name}: {ex.Message}).", ex.ToString()));
            return await FailAsync(request,
                $"Synchronisation impossible ({ex.GetType().Name}). Détail dans les journaux de la borne.");
        }

        if (ev == null)
        {
            if (loadingShown) ReturnTo(previous);
            return await FailAsync(request, "Événement introuvable dans la base de la borne après la synchronisation.");
        }

        // La synchro a pu durer : un autre écran a pu s'ouvrir entre-temps (admin, séance invité au
        // démarrage). L'envoi attend le prochain écran sûr.
        var current = _navigation.CurrentViewType;
        if (loadingShown ? current != typeof(EventLoadingView) : !UpdateCoordinator.CanApplyNow(current))
            return EventPushOutcome.Skipped;

        await _state.SetActiveEventAsync(ev.Id, ev.Name, ev.AccessCode);
        _pending = null;

        await LogSafeAsync(() => _log.LogInfoAsync(LogContext, $"Événement '{ev.Name}' chargé depuis le SaaS."));
        // Envoi appliqué au démarrage (Splash) par le cycle de fond : l'écran de chargement mène à l'accueil.
        if (showLoadingScreen && !loadingShown)
            _navigation.NavigateTo<EventLoadingView>(new EventLoadingParameters(ev.Name));

        try
        {
            await _supabase.AckEventPushAsync(request.Event.Id, request.RequestedAt, null, ct);
        }
        catch (KioskLicenseRefusedException) { /* le contrôle de licence renverra à l'association */ }
        catch (Exception)
        {
            _unacked = request; // renvoyée avant la prochaine lecture
        }

        if (loadingShown)
        {
            await Delay(LoadedScreenDelay);
            if (_navigation.CurrentViewType == typeof(EventLoadingView))
                _navigation.NavigateTo<HomeView>();
        }
        return EventPushOutcome.Applied;
    }

    // Retour à l'écran d'avant le chargement, sauf si un autre écran s'est ouvert entre-temps.
    private void ReturnTo(Type? previous)
    {
        if (_navigation.CurrentViewType != typeof(EventLoadingView)) return;
        if (previous == typeof(HomeView)) _navigation.NavigateTo<HomeView>();
        else _navigation.NavigateTo<EventSetupView>();
    }

    private async Task<EventPushOutcome> FailAsync(EventPushRequest request, string error)
    {
        _pending = null;
        try
        {
            await _supabase.AckEventPushAsync(request.Event.Id, request.RequestedAt, error);
        }
        catch (Exception ex)
        {
            // Échec non signalé : le SaaS reste « en attente » et la borne réessaiera à la prochaine lecture.
            await LogSafeAsync(() => _log.LogWarningAsync(LogContext,
                $"Échec du chargement non signalé au SaaS ({ex.GetType().Name}: {ex.Message})."));
        }
        return EventPushOutcome.Failed;
    }

    private static async Task LogSafeAsync(Func<Task> write)
    {
        try { await write(); }
        catch { /* journal indisponible : l'envoi prime */ }
    }
}
