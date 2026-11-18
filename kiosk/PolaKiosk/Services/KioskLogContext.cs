namespace PolaKiosk.Services;

/// <summary>
/// Événement et séance joints à chaque journal (LAB-326). La prise de vue ouvre la séance, le retour à
/// l'accueil (ou à la saisie du code) la ferme ; l'événement vient de l'état de la borne.
/// </summary>
public interface IKioskLogContext
{
    /// <summary>Pendant une séance : son événement et elle ; hors séance : l'événement actif ; sans événement : rien.</summary>
    (Guid? EventId, Guid? SessionId) Current { get; }

    void BeginSession(Guid sessionId, Guid eventId);

    void EndSession();
}

/// <summary>
/// Sans dépendance injectée : l'événement actif est lu par une fonction, à chaque journal. Ainsi les
/// journaux ne dépendent d'aucun service qui journalise lui-même (pas de boucle d'injection).
/// </summary>
public sealed class KioskLogContext : IKioskLogContext
{
    private sealed record OpenSession(Guid SessionId, Guid EventId);

    private readonly Func<Guid?> _activeEventId;
    private volatile OpenSession? _session;

    public KioskLogContext(Func<Guid?> activeEventId) => _activeEventId = activeEventId;

    public (Guid? EventId, Guid? SessionId) Current
    {
        get
        {
            var session = _session;
            Guid? active;
            try { active = _activeEventId(); }
            catch { active = null; } // un journal ne doit jamais échouer pour son contexte
            return Resolve(active, session?.EventId, session?.SessionId);
        }
    }

    public void BeginSession(Guid sessionId, Guid eventId) => _session = new OpenSession(sessionId, eventId);

    public void EndSession() => _session = null;

    /// <summary>Règle du contexte (logique pure). <see cref="Guid.Empty"/> vaut « pas d'événement ».</summary>
    internal static (Guid? EventId, Guid? SessionId) Resolve(Guid? activeEventId, Guid? sessionEventId, Guid? sessionId)
    {
        if (sessionId is { } session && session != Guid.Empty
            && sessionEventId is { } sessionEvent && sessionEvent != Guid.Empty)
            return (sessionEvent, session);

        return activeEventId is { } active && active != Guid.Empty ? (active, null) : (null, null);
    }
}
