using System.Net.Http;

namespace PolaKiosk.Services;

/// <summary>Lecture de <c>https://&lt;saas&gt;/kiosk-config.json</c> (open core K2).</summary>
public interface IKioskConfigClient
{
    /// <summary>
    /// Configuration publiée par le SaaS dont l'origine est <paramref name="origin"/> (déjà mise en forme
    /// par <see cref="SaasAddress.TryNormalize"/>). Null en cas d'échec : réseau, délai, réponse autre
    /// que 200, JSON invalide ou incomplet. Ne lève jamais (sauf annulation demandée).
    /// </summary>
    Task<SaasConfig?> FetchAsync(string origin, CancellationToken ct = default);
}

public sealed class KioskConfigClient : IKioskConfigClient, IDisposable
{
    internal static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    // Un fichier de quelques centaines d'octets : au-delà, ce n'est pas le bon fichier.
    private const int MaxResponseBytes = 64 * 1024;

    private readonly HttpClient _http;

    public KioskConfigClient() : this(new HttpClientHandler()) { }

    // Tests : réponses HTTP simulées.
    internal KioskConfigClient(HttpMessageHandler handler)
    {
        _http = new HttpClient(handler)
        {
            Timeout = Timeout,
            MaxResponseContentBufferSize = MaxResponseBytes,
        };
    }

    public async Task<SaasConfig?> FetchAsync(string origin, CancellationToken ct = default)
    {
        try
        {
            using var response = await _http.GetAsync(SaasAddress.ConfigUri(origin), ct);
            if (response.StatusCode != System.Net.HttpStatusCode.OK) return null;
            var json = await response.Content.ReadAsStringAsync(ct);
            return SaasAddress.ParseConfig(json);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return null; // réseau, délai, DNS, certificat, réponse trop grande
        }
    }

    public void Dispose() => _http.Dispose();
}
