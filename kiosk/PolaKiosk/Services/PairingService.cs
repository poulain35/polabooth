using System.Security.Cryptography;

namespace PolaKiosk.Services;

public sealed class PairingService : IPairingService
{
    /// <summary>Alphabet des codes (kiosk_pairing_new_code) : sans 0/O, 1/I/L ni U, faciles à lire de loin.</summary>
    internal const string CodeAlphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
    internal const int CodeLength = 6;
    internal const int KeyLength = 32;

    private readonly ISupabaseService _supabase;
    private readonly object _lock = new();
    private byte[]? _key;
    private Guid? _pairingId;

    public PairingService(ISupabaseService supabase) => _supabase = supabase;

    public async Task<PairingCode> StartAsync(CancellationToken ct = default)
    {
        var key = RandomNumberGenerator.GetBytes(KeyLength);
        lock (_lock)
        {
            Clear();
            _key = key;
        }

        var code = await _supabase.StartPairingAsync(Environment.MachineName, AppVersion.Current, HashKey(key), ct);
        lock (_lock)
        {
            // Forget() ou un autre StartAsync pendant l'appel : ce code n'est plus le bon.
            if (!ReferenceEquals(_key, key)) throw new OperationCanceledException(ct);
            _pairingId = code.PairingId;
        }
        return code;
    }

    public Task<PairingPollResult> PollAsync(CancellationToken ct = default)
    {
        Guid pairingId;
        string deviceKey;
        lock (_lock)
        {
            if (_key == null || _pairingId == null)
                throw new InvalidOperationException("Aucun code d'association en cours.");
            pairingId = _pairingId.Value;
            deviceKey = ToHex(_key);
        }
        return _supabase.PollPairingAsync(pairingId, deviceKey, ct);
    }

    public void Forget()
    {
        lock (_lock) Clear();
    }

    private void Clear()
    {
        if (_key != null) CryptographicOperations.ZeroMemory(_key);
        _key = null;
        _pairingId = null;
    }

    /// <summary>Hexadécimal minuscule (format attendu par les RPC).</summary>
    internal static string ToHex(byte[] bytes) => Convert.ToHexStringLower(bytes);

    /// <summary>p_device_key_hash : SHA-256 des 32 octets de K, en hexadécimal minuscule.</summary>
    internal static string HashKey(byte[] key) => ToHex(SHA256.HashData(key));

    /// <summary>Code affiché en deux groupes, lisible de loin : « K7M-4PX ».</summary>
    public static string FormatCode(string code)
    {
        var c = (code ?? "").Trim().ToUpperInvariant();
        return c.Length == CodeLength ? $"{c[..3]}-{c[3..]}" : c;
    }

    /// <summary>Lien du QR code : la page d'association du SaaS, code prérempli.</summary>
    public static string BuildPairingUrl(string pairingUrl, string code)
    {
        var url = (pairingUrl ?? "").Trim();
        var separator = url.Contains('?') ? '&' : '?';
        return $"{url}{separator}code={Uri.EscapeDataString((code ?? "").Trim().ToUpperInvariant())}";
    }

    /// <summary>Adresse affichée sous le QR code, sans « https:// » : « photobooth.example.com/associer ».</summary>
    public static string DisplayUrl(string pairingUrl)
    {
        var url = (pairingUrl ?? "").Trim();
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
            url = uri.Host + (uri.IsDefaultPort ? "" : $":{uri.Port}") + uri.AbsolutePath;
        return url.TrimEnd('/');
    }
}
