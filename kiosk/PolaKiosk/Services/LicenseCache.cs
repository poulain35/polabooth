using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;

namespace PolaKiosk.Services;

public enum LicenseCacheStatus { Valid, Missing, NotLicensed, Tampered, FutureDate, Expired }

/// <summary>
/// Cache hors ligne du résultat de licence (license.json), signé par HMAC-SHA256.
/// La clé HMAC est tirée au hasard puis protégée par DPAPI (license.key) : un cache modifié,
/// copié depuis un autre poste ou daté dans le futur est refusé.
/// </summary>
internal sealed class LicenseCache
{
    private const string KeyPurpose = "PolaKiosk.LicenseCacheKey";
    private const int KeyBytes = 32;

    // Tolérance d'horloge : au-delà, une date future signale un cache forgé ou une horloge reculée.
    internal static readonly TimeSpan MaxClockSkew = TimeSpan.FromMinutes(5);

    private static readonly JsonSerializerSettings JsonSettings = new() { DateParseHandling = DateParseHandling.None };

    private readonly string _cachePath;
    private readonly string _keyPath;
    private readonly string _machineId;

    public LicenseCache(string dataDir, string machineId)
    {
        var paths  = new KioskPaths(dataDir);
        _cachePath = paths.LicenseFile;
        _keyPath   = paths.LicenseKeyFile;
        _machineId = machineId;
    }

    public void Write(bool licensed, DateTime nowUtc)
    {
        var cachedAt = nowUtc.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);
        var file = new CacheFile
        {
            Licensed  = licensed,
            MachineId = _machineId,
            CachedAt  = cachedAt,
            Signature = Convert.ToBase64String(Sign(GetOrCreateKey(), _machineId, licensed, cachedAt)),
        };
        AtomicFile.WriteAllText(_cachePath, JsonConvert.SerializeObject(file));
    }

    public LicenseCacheStatus Read(DateTime nowUtc, TimeSpan grace)
    {
        if (!File.Exists(_cachePath)) return LicenseCacheStatus.Missing;

        CacheFile? file;
        try { file = JsonConvert.DeserializeObject<CacheFile>(File.ReadAllText(_cachePath), JsonSettings); }
        catch (JsonException) { return LicenseCacheStatus.Tampered; }

        var key = Dpapi.TryReadFile(_keyPath, KeyPurpose);
        if (file?.MachineId == null || file.CachedAt == null || file.Signature == null || key == null)
            return LicenseCacheStatus.Tampered;

        byte[] signature;
        try { signature = Convert.FromBase64String(file.Signature); }
        catch (FormatException) { return LicenseCacheStatus.Tampered; }

        var expected = Sign(key, file.MachineId, file.Licensed, file.CachedAt);
        if (!CryptographicOperations.FixedTimeEquals(signature, expected) || file.MachineId != _machineId)
            return LicenseCacheStatus.Tampered;

        if (!DateTime.TryParse(file.CachedAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var cachedAt))
            return LicenseCacheStatus.Tampered;

        var age = nowUtc.ToUniversalTime() - cachedAt.ToUniversalTime();
        if (age < -MaxClockSkew) return LicenseCacheStatus.FutureDate;
        if (!file.Licensed) return LicenseCacheStatus.NotLicensed;
        if (age > grace) return LicenseCacheStatus.Expired;
        return LicenseCacheStatus.Valid;
    }

    private byte[] GetOrCreateKey()
    {
        var key = Dpapi.TryReadFile(_keyPath, KeyPurpose);
        if (key is { Length: KeyBytes }) return key;

        key = RandomNumberGenerator.GetBytes(KeyBytes);
        Dpapi.WriteFile(_keyPath, key, KeyPurpose);
        return key;
    }

    private static byte[] Sign(byte[] key, string machineId, bool licensed, string cachedAt)
        => HMACSHA256.HashData(key, Encoding.UTF8.GetBytes($"{machineId}|{(licensed ? "1" : "0")}|{cachedAt}"));

    private sealed class CacheFile
    {
        [JsonProperty("licensed")]   public bool    Licensed  { get; set; }
        [JsonProperty("machine_id")] public string? MachineId { get; set; }
        [JsonProperty("cached_at")]  public string? CachedAt  { get; set; }
        [JsonProperty("signature")]  public string? Signature { get; set; }
    }
}
