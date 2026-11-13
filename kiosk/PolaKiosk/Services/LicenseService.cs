using System.Net;
using System.Net.Http;
using Newtonsoft.Json;

namespace PolaKiosk.Services;

public class LicenseService : ILicenseService
{
    private readonly SupabaseService _supabase;
    private readonly AppSettings _settings;
    private readonly IKioskCredentials _credentials;
    private readonly IAdminPinService _adminPin;
    private readonly IPendingUploadsCounter _pendingUploads;
    private readonly ICameraHealthService? _cameraHealth;
    private readonly LicenseCache _cache;

    public string MachineId => _credentials.MachineId;
    public string? LastError { get; private set; }

    public LicenseService(SupabaseService supabase, AppSettings settings,
        IKioskCredentials credentials, IAdminPinService adminPin, IPendingUploadsCounter pendingUploads, string dataDir,
        ICameraHealthService? cameraHealth = null)
    {
        _cameraHealth   = cameraHealth;
        _supabase       = supabase;
        _settings       = settings;
        _credentials    = credentials;
        _adminPin       = adminPin;
        _pendingUploads = pendingUploads;
        _cache          = new LicenseCache(dataDir, credentials.MachineId);
    }

    public async Task<LicenseStatus> CheckAsync()
    {
        LastError = null;

        // Borne jamais associée : rien à demander au serveur.
        if (string.IsNullOrEmpty(_credentials.Secret)) return LicenseStatus.Refused;

        try
        {
            var licensed = await CheckOnlineAsync();
            if (licensed)
            {
                await UpdateLastSeenAsync();
                CacheResult(true);
                // PIN admin : récupéré à chaque vérification réussie, sans retarder le démarrage.
                _ = _adminPin.RefreshAsync();
                return LicenseStatus.Valid;
            }

            CacheResult(false);
            return LicenseStatus.Refused;
        }
        catch (UnauthorizedAccessException ex)
        {
            // Clé API invalide — erreur de config, pas un refus de la licence
            LastError = ex.Message;
            return ReadCache() ? LicenseStatus.Valid : LicenseStatus.Unverified;
        }
        catch (Exception ex)
        {
            // Hors ligne, timeout ou erreur serveur (RPC manquante, HTTP 4xx/5xx) → cache local
            LastError = $"Vérification en ligne impossible : {ex.Message}";
            return ReadCache() ? LicenseStatus.Valid : LicenseStatus.Unverified;
        }
    }

    public async Task<bool> IsRefusedOnlineAsync()
    {
        if (string.IsNullOrEmpty(_credentials.Secret)) return true;
        try
        {
            var licensed = await CheckOnlineAsync();
            CacheResult(licensed);
            return !licensed;
        }
        catch
        {
            return false; // réseau ou serveur indisponible : jamais un refus
        }
    }

    private async Task<bool> CheckOnlineAsync()
    {
        // Passe par la RPC kiosk_check_license (SECURITY DEFINER) : valide (machine_id, secret)
        // et renvoie is_active, sans exposer la table. Sans code d'activation, la licence est refusée.
        var body = JsonConvert.SerializeObject(new
        {
            p_machine_id = MachineId,
            p_secret     = _credentials.Secret,
        });

        using var response = await _supabase.PostRpcAsync("kiosk_check_license", body);

        if (response.StatusCode == HttpStatusCode.Unauthorized)
            throw new UnauthorizedAccessException(
                "Clé API Supabase invalide ou manquante — vérifiez AnonKey dans appsettings.local.json");

        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException(
                $"Supabase a retourné HTTP {(int)response.StatusCode}");

        var json = (await response.Content.ReadAsStringAsync()).Trim();
        return json == "true";
    }

    public async Task SendHeartbeatAsync()
    {
        try
        {
            // État matériel de l'imprimante configurée sur ce poste (monitoring SaaS)
            var printerName   = _settings.Kiosk.PrinterName;
            var printerStatus = PrintService.ReadPrinterStatus(printerName);

            var pending       = await _pendingUploads.CountAsync();

            // RPC kiosk_heartbeat (SECURITY DEFINER) : met à jour le monitoring si (machine_id, secret) valide.
            var body = BuildHeartbeatBody(MachineId, _credentials.Secret, AppVersion.Current,
                printerStatus, printerName ?? "", pending, _cameraHealth?.HeartbeatValue);
            using var _ = await _supabase.PostRpcAsync("kiosk_heartbeat", body);
        }
        catch { /* non bloquant */ }
    }

    /// <summary>
    /// Paramètres de la RPC kiosk_heartbeat (noms = arguments SQL). <paramref name="pendingUploads"/> null
    /// = la borne n'a pas pu compter : envoyé tel quel (inconnu côté serveur), jamais remplacé par 0.
    /// <paramref name="cameraStatus"/> (LAB-263) : "ok", "disconnected", ou null si l'état n'est pas connu
    /// (vérification pas encore faite ou expirée) ; null ne modifie pas l'état gardé par le serveur.
    /// </summary>
    internal static string BuildHeartbeatBody(string machineId, string secret, string appVersion,
        string printerStatus, string printerName, int? pendingUploads, string? cameraStatus = null)
        => JsonConvert.SerializeObject(new
        {
            p_machine_id      = machineId,
            p_secret          = secret,
            p_app_version     = appVersion,
            p_printer_status  = printerStatus,
            p_printer_name    = printerName,
            p_pending_uploads = pendingUploads,
            p_camera_status   = cameraStatus,
        });

    private Task UpdateLastSeenAsync() => SendHeartbeatAsync();

    private void CacheResult(bool licensed)
    {
        try { _cache.Write(licensed, DateTime.UtcNow); }
        catch { }
    }

    private bool ReadCache()
    {
        var grace = TimeSpan.FromDays(_settings.Kiosk.LicenseGraceDays);
        string? cacheMsg;
        try
        {
            cacheMsg = _cache.Read(DateTime.UtcNow, grace) switch
            {
                LicenseCacheStatus.Valid       => null,
                // Validité hors ligne bornée : une licence vérifiée n'est tolérée que pendant
                // la période de grâce, pour qu'une désactivation finisse par s'appliquer.
                LicenseCacheStatus.Expired     => $"Dernière vérification réussie il y a plus de {_settings.Kiosk.LicenseGraceDays} jours, reconnexion requise.",
                LicenseCacheStatus.Tampered    => "Cache de licence invalide (modifié ou d'un autre poste), reconnexion requise.",
                LicenseCacheStatus.FutureDate  => "Cache de licence daté dans le futur (horloge du PC à vérifier), reconnexion requise.",
                _                              => "",
            };
        }
        catch { cacheMsg = ""; }

        if (cacheMsg == null) return true;

        // ReadCache n'est atteint qu'après l'échec de la vérification en ligne : on conserve
        // la cause réelle (réseau, RPC manquante, clé invalide…) et on y ajoute seulement le
        // contexte du cache, au lieu de la masquer.
        if (cacheMsg.Length > 0)
            LastError = string.IsNullOrEmpty(LastError) ? cacheMsg : $"{LastError} — {cacheMsg}";
        return false;
    }
}
