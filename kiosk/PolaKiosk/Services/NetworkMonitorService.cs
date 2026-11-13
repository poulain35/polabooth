using System.Net.Http;
using System.Net.NetworkInformation;

namespace PolaKiosk.Services;

public class NetworkMonitorService : INetworkMonitorService, IDisposable
{
    private readonly string _pingUrl;
    private readonly HttpClient _http;
    private readonly System.Timers.Timer _timer;

    // 0 = hors ligne, 1 = en ligne. Les contrôles arrivent de plusieurs fils (minuteur,
    // événements Windows) : Interlocked garantit un seul NetworkRestored par retour du réseau.
    private int _isOnline;
    private int _started;

    public bool IsOnline => Volatile.Read(ref _isOnline) == 1;

    public event EventHandler? NetworkRestored;
    public event EventHandler? NetworkLost;

    public NetworkMonitorService(AppSettings settings) : this(settings, new HttpClientHandler()) { }

    // Tests : réponses du ping simulées.
    internal NetworkMonitorService(AppSettings settings, HttpMessageHandler handler)
    {
        // On ping le projet Supabase — si on peut l'atteindre, on est en ligne
        _pingUrl = $"{settings.Supabase.Url.TrimEnd('/')}/rest/v1/";

        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(5) };
        _http.DefaultRequestHeaders.Add("apikey", settings.Supabase.AnonKey);

        // Vérification toutes les 15 secondes
        _timer = new System.Timers.Timer(15_000);
        _timer.Elapsed += (_, _) => _ = CheckNowAsync();
        _timer.AutoReset = true;
    }

    public void Start()
    {
        if (Interlocked.Exchange(ref _started, 1) == 1) return;

        // Écoute les changements réseau Windows
        NetworkChange.NetworkAvailabilityChanged += OnNetworkAvailabilityChanged;
        NetworkChange.NetworkAddressChanged += OnNetworkAddressChanged;

        _timer.Start();

        // Vérification initiale
        _ = Task.Run(() => CheckNowAsync());
    }

    public void Stop()
    {
        _timer.Stop();
        NetworkChange.NetworkAvailabilityChanged -= OnNetworkAvailabilityChanged;
        NetworkChange.NetworkAddressChanged -= OnNetworkAddressChanged;
    }

    private void OnNetworkAvailabilityChanged(object? sender, NetworkAvailabilityEventArgs e)
        => _ = Task.Run(() => CheckNowAsync());

    // Déclenché quand une adresse IP change (reconnexion WiFi, 4G...)
    private void OnNetworkAddressChanged(object? sender, EventArgs e)
        => _ = Task.Run(() => CheckNowAsync());

    public async Task<bool> CheckNowAsync(CancellationToken ct = default)
    {
        bool reachable;
        try
        {
            using var response = await _http.GetAsync(_pingUrl, ct);
            reachable = (int)response.StatusCode < 500;
        }
        catch { reachable = false; }

        // Une annulation par l'appelant ne dit rien du réseau : l'état ne change pas.
        if (ct.IsCancellationRequested) return false;

        var previous = Interlocked.Exchange(ref _isOnline, reachable ? 1 : 0);
        if (reachable && previous == 0)
            Raise(NetworkRestored);
        else if (!reachable && previous == 1)
            Raise(NetworkLost);

        return reachable;
    }

    // Levé sur un fil du minuteur : une exception d'un abonné ne doit pas fermer l'application.
    private void Raise(EventHandler? handler)
    {
        try { handler?.Invoke(this, EventArgs.Empty); }
        catch (Exception ex) { FatalLog.Write("network-event", ex); }
    }

    public void Dispose()
    {
        Stop();
        _timer.Dispose();
        _http.Dispose();
    }
}
