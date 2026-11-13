using System.IO;
using System.Text;
using Microsoft.Win32;

namespace PolaKiosk.Services;

public class KioskCredentialsService : IKioskCredentials
{
    private const string Purpose = "PolaKiosk.ActivationCode";

    private readonly string _path;
    private readonly string _fallbackSecret;
    private volatile string? _storedSecret;

    public string MachineId { get; }

    public string Secret => _storedSecret ?? _fallbackSecret;

    /// <param name="devFallbackSecret">
    /// Secret de développement (<c>Kiosk.LicenseSecret</c>), passé seulement en build Debug lancé en
    /// environnement Development : jamais utilisé sur une borne de production.
    /// </param>
    public KioskCredentialsService(string dataDir, string? devFallbackSecret = null, string? machineId = null)
    {
        MachineId       = machineId ?? GetMachineId();
        _fallbackSecret = (devFallbackSecret ?? "").Trim();
        _path           = Path.Combine(dataDir, "activation.bin");

        var stored = Dpapi.TryReadFile(_path, Purpose);
        if (stored != null)
        {
            var secret = Encoding.UTF8.GetString(stored).Trim();
            if (secret.Length > 0) _storedSecret = secret;
        }
    }

    public void SetSecret(string secret)
    {
        var value = (secret ?? "").Trim();
        if (value.Length == 0) throw new ArgumentException("Secret de licence vide.", nameof(secret));
        Dpapi.WriteFile(_path, Encoding.UTF8.GetBytes(value), Purpose);
        _storedSecret = value;
    }

    internal static string GetMachineId()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
            var guid = key?.GetValue("MachineGuid")?.ToString();
            if (!string.IsNullOrEmpty(guid)) return guid;
        }
        catch { }

        return Environment.MachineName;
    }
}
