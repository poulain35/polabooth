using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;

namespace PolaKiosk.Services;

/// <summary>
/// Format du hash : <c>pbkdf2$iterations$salt_b64$hash_b64</c> (PBKDF2-HMAC-SHA256), calculé
/// par l'Edge Function kiosk-admin-pin. Le PIN en clair n'est jamais stocké ni transmis.
/// </summary>
public class AdminPinService : IAdminPinService
{
    private const string Purpose = "PolaKiosk.AdminPin";
    private static readonly TimeSpan RefreshTimeout = TimeSpan.FromSeconds(10);

    // Bornes du nombre d'itérations accepté : un hash à 1 itération serait trivial à casser,
    // un nombre démesuré bloquerait la borne à chaque saisie.
    internal const int MinIterations = 10_000;
    internal const int MaxIterations = 2_000_000;

    private static readonly JsonSerializerSettings JsonSettings = new() { DateParseHandling = DateParseHandling.None };

    private readonly ISupabaseService _supabase;
    private readonly IKioskLogService? _log;
    private readonly string _path;
    private readonly byte[]? _devPin;
    private volatile AdminPinHash? _current;

    public bool IsConfigured => _current != null || _devPin != null;

    /// <param name="devPin">PIN de développement (appsettings.Development.json, build Debug) ; null en production.</param>
    public AdminPinService(ISupabaseService supabase, string dataDir, string? devPin = null, IKioskLogService? log = null)
    {
        _supabase = supabase;
        _log      = log;
        _path     = Path.Combine(dataDir, "admin-pin.bin");
        _devPin   = string.IsNullOrWhiteSpace(devPin) ? null : Encoding.UTF8.GetBytes(devPin.Trim());
        _current  = Load();
    }

    public PinCheckResult Verify(string pin)
    {
        if (string.IsNullOrEmpty(pin)) return IsConfigured ? PinCheckResult.Rejected : PinCheckResult.NotConfigured;

        // Le PIN reçu du SaaS prime sur le PIN de développement.
        if (_current is { } stored)
            return VerifyHash(pin, stored.Hash) ? PinCheckResult.Accepted : PinCheckResult.Rejected;

        if (_devPin != null)
            return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(pin), _devPin)
                ? PinCheckResult.Accepted : PinCheckResult.Rejected;

        return PinCheckResult.NotConfigured;
    }

    public async Task RefreshAsync(CancellationToken ct = default)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(RefreshTimeout);

            // Rien de nouveau (aucun envoi, licence inactive ou secret faux) : le PIN local reste valable.
            var received = await _supabase.GetAdminPinAsync(cts.Token);
            if (received == null || received.Hash == _current?.Hash) return;

            if (!TryParse(received.Hash, out _, out _, out _))
            {
                await LogAsync(false, "PIN admin reçu au format invalide, ignoré.");
                return;
            }

            Save(received);
            _current = received;
            await LogAsync(true, "PIN admin reçu du SaaS.");
        }
        catch (Exception ex)
        {
            if (!ct.IsCancellationRequested)
                await LogAsync(false, $"Récupération du PIN admin impossible : {ex.Message}");
        }
    }

    // ── Hash ─────────────────────────────────────────────────────────────────

    internal static string HashPin(string pin, byte[] salt, int iterations)
    {
        var hash = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(pin), salt, iterations, HashAlgorithmName.SHA256, 32);
        return $"pbkdf2${iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    internal static bool VerifyHash(string pin, string encoded)
    {
        if (!TryParse(encoded, out var iterations, out var salt, out var expected)) return false;
        var actual = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(pin), salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    internal static bool TryParse(string encoded, out int iterations, out byte[] salt, out byte[] hash)
    {
        iterations = 0; salt = []; hash = [];
        var parts = (encoded ?? "").Split('$');
        if (parts.Length != 4 || parts[0] != "pbkdf2") return false;
        if (!int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out iterations)
            || iterations < MinIterations || iterations > MaxIterations) return false;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            hash = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException) { return false; }
        return salt.Length >= 8 && hash.Length >= 16;
    }

    // ── Stockage local (DPAPI) ───────────────────────────────────────────────

    private AdminPinHash? Load()
    {
        var bytes = Dpapi.TryReadFile(_path, Purpose);
        if (bytes == null) return null;
        try
        {
            var stored = JsonConvert.DeserializeObject<StoredPin>(Encoding.UTF8.GetString(bytes), JsonSettings);
            if (stored?.Hash == null || !TryParse(stored.Hash, out _, out _, out _)) return null;
            DateTime? setAt = DateTime.TryParse(stored.SetAt, CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind, out var d) ? d : null;
            return new AdminPinHash(stored.Hash, setAt);
        }
        catch (JsonException) { return null; }
    }

    private void Save(AdminPinHash pin)
    {
        var json = JsonConvert.SerializeObject(new StoredPin
        {
            Hash  = pin.Hash,
            SetAt = pin.SetAt?.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture),
        });
        Dpapi.WriteFile(_path, Encoding.UTF8.GetBytes(json), Purpose);
    }

    private async Task LogAsync(bool info, string message)
    {
        if (_log == null) return;
        try
        {
            if (info) await _log.LogInfoAsync("admin-pin", message);
            else      await _log.LogWarningAsync("admin-pin", message);
        }
        catch { /* journal indisponible : non bloquant */ }
    }

    private sealed class StoredPin
    {
        [JsonProperty("hash")]   public string? Hash  { get; set; }
        [JsonProperty("set_at")] public string? SetAt { get; set; }
    }
}
