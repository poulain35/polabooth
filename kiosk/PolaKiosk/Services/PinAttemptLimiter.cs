using System.IO;
using Newtonsoft.Json;

namespace PolaKiosk.Services;

/// <summary>Résultat d'un PIN refusé : essais restants avant blocage, ou durée du blocage qui commence.</summary>
public readonly record struct PinFailure(int AttemptsLeft, TimeSpan? LockedFor);

/// <summary>
/// Compteur des PIN admin refusés, commun à tous les pavés (LAB-394) : quitter l'écran ou relancer la
/// borne ne remet pas les essais à zéro.
/// </summary>
public interface IPinAttemptLimiter
{
    /// <summary>Temps restant du blocage en cours, null si le pavé est libre.</summary>
    TimeSpan? LockRemaining();

    PinFailure RecordFailure();

    void RecordSuccess();
}

/// <summary>
/// Blocage par séries de <see cref="MaxAttempts"/> essais : 30 s, puis le double à chaque série
/// (au plus <see cref="MaxLockout"/>). Une heure sans erreur, ou le bon PIN, remet tout à zéro.
/// L'état est gardé dans un petit fichier JSON ; illisible, absent ou faussé (date de blocage trop
/// lointaine, horloge reculée), il ne bloque jamais la borne plus de <see cref="MaxLockout"/>.
/// </summary>
public sealed class PinAttemptLimiter : IPinAttemptLimiter
{
    public const int MaxAttempts = 5;
    public static readonly TimeSpan FirstLockout = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan MaxLockout = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan QuietReset = TimeSpan.FromHours(1);

    private sealed class State
    {
        public int FailedAttempts { get; set; }
        public int Lockouts { get; set; }
        public DateTime? LockedUntilUtc { get; set; }
        public DateTime? LastFailureUtc { get; set; }
    }

    private readonly string? _statePath;
    private readonly Func<DateTime> _utcNow;
    private readonly object _gate = new();
    private State _state = new();

    /// <param name="statePath">Fichier de l'état ; null = en mémoire seulement.</param>
    public PinAttemptLimiter(string? statePath = null, Func<DateTime>? utcNow = null)
    {
        _statePath = statePath;
        _utcNow    = utcNow ?? (() => DateTime.UtcNow);
        Load();
    }

    public TimeSpan? LockRemaining()
    {
        lock (_gate)
        {
            var now = _utcNow();
            ClampLock(now);
            return _state.LockedUntilUtc is { } until && until > now ? until - now : null;
        }
    }

    public PinFailure RecordFailure()
    {
        lock (_gate)
        {
            var now = _utcNow();
            if (_state.LastFailureUtc is { } last && now - last > QuietReset) _state = new State();

            _state.LastFailureUtc = now;
            _state.FailedAttempts++;
            PinFailure result;
            if (_state.FailedAttempts >= MaxAttempts)
            {
                _state.FailedAttempts = 0;
                _state.Lockouts++;
                var lockout = LockoutFor(_state.Lockouts);
                _state.LockedUntilUtc = now + lockout;
                result = new PinFailure(0, lockout);
            }
            else result = new PinFailure(MaxAttempts - _state.FailedAttempts, null);

            Save();
            return result;
        }
    }

    public void RecordSuccess()
    {
        lock (_gate)
        {
            if (_state is { FailedAttempts: 0, Lockouts: 0, LockedUntilUtc: null, LastFailureUtc: null }) return;
            _state = new State();
            Save();
        }
    }

    /// <summary>Durée du blocage numéro <paramref name="lockouts"/> (1 = premier blocage).</summary>
    internal static TimeSpan LockoutFor(int lockouts)
    {
        var lockout = FirstLockout * (1 << Math.Clamp(lockouts - 1, 0, 10));
        return lockout < MaxLockout ? lockout : MaxLockout;
    }

    private void ClampLock(DateTime now)
    {
        var max = now + LockoutFor(_state.Lockouts);
        if (_state.LockedUntilUtc > max) _state.LockedUntilUtc = max;
    }

    private void Load()
    {
        var state = new State();
        if (_statePath != null)
        {
            try
            {
                if (File.Exists(_statePath))
                    state = JsonConvert.DeserializeObject<State>(File.ReadAllText(_statePath)) ?? new State();
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
            {
                // Fichier illisible : compteur à zéro, le blocage en mémoire protège encore cette session.
            }
        }

        var now = _utcNow();
        state.FailedAttempts = Math.Clamp(state.FailedAttempts, 0, MaxAttempts - 1);
        state.Lockouts       = Math.Clamp(state.Lockouts, 0, 20);
        state.LockedUntilUtc = state.LockedUntilUtc?.ToUniversalTime();
        if (state.LastFailureUtc?.ToUniversalTime() is { } last) state.LastFailureUtc = last > now ? now : last;
        _state = state;
        ClampLock(now);
    }

    private void Save()
    {
        if (_statePath == null) return;
        try { AtomicFile.WriteAllText(_statePath, JsonConvert.SerializeObject(_state)); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Non persisté : le blocage reste appliqué en mémoire jusqu'au redémarrage.
        }
    }
}
