using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Newtonsoft.Json;

namespace PolaKiosk.Services;

/// <summary>
/// LAB-200 : la borne ne se met à jour que sur demande depuis le SaaS (page Licences, « Mettre à jour »).
/// Elle lit la demande en attente (kiosk_get_update_request), installe la version demandée et signale
/// tout échec (kiosk_report_update_failure) ; une demande en échec n'est plus jamais réessayée.
/// </summary>
public class UpdateService : IUpdateService
{
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(30);

    // La version sert dans un nom de fichier et sur la ligne de commande du script.
    private static readonly Regex SafeVersion = new("^[0-9A-Za-z.-]{1,32}$");

    // requested_at est renvoyé au serveur à l'identique : jamais converti en date à la relecture.
    private static readonly JsonSerializerSettings RawDates = new() { DateParseHandling = DateParseHandling.None };

    private readonly ISupabaseService _supabase;
    private readonly IKioskLogService _log;
    private readonly HttpClient _http;
    private readonly string _localDir;
    private readonly string _currentVersion;

    // Demandes en échec (clé = requested_at) : plus aucun essai sans nouvelle demande, même si le
    // serveur les renvoie encore (échec pas encore signalé faute de réseau).
    private readonly object _sync = new();
    private readonly HashSet<string> _failedRequests = new(StringComparer.Ordinal);
    private FailureRecord? _unreported;

    /// <summary>Téléchargement abandonné si aucun octet n'arrive pendant ce délai (4G instable).</summary>
    internal TimeSpan StallTimeout { get; init; } = TimeSpan.FromSeconds(60);

    internal string ScriptPath { get; init; } = Path.Combine(AppContext.BaseDirectory, "scripts", "apply-update.ps1");

    // Tests : lancement du script simulé (aucun processus réel).
    internal Func<ProcessStartInfo, bool> StartProcess { get; init; } = psi =>
    {
        using var process = Process.Start(psi);
        return process != null;
    };

    public string CurrentVersion => _currentVersion;

    public UpdateService(ISupabaseService supabase, IKioskLogService log)
        : this(supabase, log, new HttpClientHandler(), Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PolaKiosk")) { }

    // Tests : réponses HTTP simulées, dossier temporaire à la place de %LocalAppData%\PolaKiosk,
    // version installée imposée.
    internal UpdateService(ISupabaseService supabase, IKioskLogService log, HttpMessageHandler handler,
                           string localDir, string? currentVersion = null)
    {
        _supabase       = supabase;
        _log            = log;
        _localDir       = localDir;
        _currentVersion = currentVersion ?? AppVersion.Current;

        // Téléchargement sans limite globale mais abandonné s'il cale : le délai par défaut de 100 s
        // coupait les gros installeurs en 4G. L'installeur est public (bucket app-releases).
        _http = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };

        LoadUnreportedFailure();
        CheckPreviousAttempt();
    }

    private string FailedMarkerPath => Path.Combine(_localDir, "update.failed");
    private string AttemptPath      => Path.Combine(_localDir, "update.attempt.json");
    private string FailurePath      => Path.Combine(_localDir, "update.failure.json");
    private string LockPath         => Path.Combine(_localDir, "update.lock");
    internal string UpdatesDir      => Path.Combine(_localDir, "updates");

    public async Task<UpdateRequest?> GetPendingRequestAsync(CancellationToken ct = default)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(RequestTimeout);

            await SendUnreportedFailureAsync(cts.Token);

            var request = await _supabase.GetUpdateRequestAsync(cts.Token);
            if (request == null) return null;

            // Déjà installée : le serveur ne le sait pas encore (heartbeat pas encore passé).
            if (NormalizeVersion(request.Version) == NormalizeVersion(CurrentVersion)) return null;

            lock (_sync)
                if (_failedRequests.Contains(request.RequestedAt)) return null;

            var invalid = Validate(request);
            if (invalid != null)
            {
                await ReportFailureAsync(request, invalid, ct);
                return null;
            }

            await _log.LogInfoAsync("update", $"Mise à jour {request.Version} demandée depuis le SaaS ({request.RequestedAt}).");
            return request;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            await _log.LogWarningAsync("update", $"Lecture de la demande de mise à jour échouée : {ex.Message}");
            return null; // hors ligne / erreur → nouvel essai au prochain cycle, rien n'est bloqué
        }
    }

    public async Task<bool> ApplyAsync(UpdateRequest request, CancellationToken ct = default)
    {
        await _log.LogInfoAsync("update", $"Application MAJ {CurrentVersion} → {request.Version}");

        var installerPath = await DownloadInstallerAsync(request, ct);
        if (installerPath == null) return false;

        // Écrit avant le lancement : au redémarrage, la version qui tourne dira si l'installation a réussi.
        WriteJson(AttemptPath, new AttemptRecord(request.Version, request.RequestedAt));
        try
        {
            StartInstallScript(request, installerPath);
        }
        catch
        {
            TryDelete(AttemptPath);
            throw;
        }
        return true;
    }

    public async Task ReportFailureAsync(UpdateRequest request, string error, CancellationToken ct = default)
    {
        try
        {
            RecordFailure(new FailureRecord(request.Version, request.RequestedAt, error));
            await _log.LogErrorAsync("update", $"Mise à jour {request.Version} en échec : {error}");
            await SendUnreportedFailureAsync(ct);
        }
        catch (Exception ex)
        {
            // Échec gardé sur le disque : il sera signalé au prochain cycle.
            try { await _log.LogWarningAsync("update", $"Signalement de l'échec de mise à jour reporté : {ex.Message}"); }
            catch { }
        }
    }

    /// <summary>Message d'erreur si la demande est inutilisable, sinon null.</summary>
    private static string? Validate(UpdateRequest request)
    {
        if (!SafeVersion.IsMatch(request.Version))
            return $"Numéro de version « {request.Version} » invalide.";
        // LAB-197 : sans empreinte publiée, l'installeur ne peut pas être vérifié.
        if (!IsSha256Hex(request.Sha256))
            return $"Version {request.Version} sans empreinte SHA-256 valide.";
        if (!Uri.TryCreate(request.ExeUrl, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            return $"Version {request.Version} sans adresse de téléchargement valide.";
        return null;
    }

    /// <summary>
    /// Installeur vérifié sur le disque (déjà présent ou téléchargé), ou null si son empreinte est fausse.
    /// Lève une exception si le téléchargement échoue ; aucun fichier partiel n'est laissé.
    /// </summary>
    internal async Task<string?> DownloadInstallerAsync(UpdateRequest request, CancellationToken ct)
    {
        Directory.CreateDirectory(UpdatesDir);
        var installerPath = Path.Combine(UpdatesDir, $"setup-{request.Version}.exe");

        // Téléchargé lors d'un essai précédent dont le lancement a échoué : inutile de recommencer.
        if (File.Exists(installerPath) && await Task.Run(() => CheckInstaller(installerPath, request.Sha256, out _), ct))
            return installerPath;

        var partPath = installerPath + ".part";
        try
        {
            await DownloadToFileAsync(request.ExeUrl, partPath, ct);
            File.Move(partPath, installerPath, overwrite: true);
        }
        catch
        {
            TryDelete(partPath);
            throw;
        }

        // Empreinte calculée hors du fil d'affichage (installeur de plusieurs dizaines de Mo).
        var (ok, actual) = await Task.Run(() => (CheckInstaller(installerPath, request.Sha256, out var a), a), ct);
        if (ok) return installerPath;

        await _log.LogErrorAsync("update",
            $"Installeur {request.Version} refusé : SHA-256 {actual} au lieu de {request.Sha256}. Fichier supprimé, MAJ non installée.");
        return null;
    }

    /// <summary>Flux réseau → fichier par blocs (jamais tout l'installeur en mémoire).</summary>
    private async Task DownloadToFileAsync(string url, string path, CancellationToken ct)
    {
        using var stall = CancellationTokenSource.CreateLinkedTokenSource(ct);
        stall.CancelAfter(StallTimeout);
        try
        {
            using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, stall.Token);
            response.EnsureSuccessStatusCode();

            await using var input  = await response.Content.ReadAsStreamAsync(stall.Token);
            await using var output = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true);
            var buffer = new byte[81920];
            int read;
            while ((read = await input.ReadAsync(buffer, stall.Token)) > 0)
            {
                await output.WriteAsync(buffer.AsMemory(0, read), ct);
                stall.CancelAfter(StallTimeout); // des données arrivent : le délai repart de zéro
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new TimeoutException(
                $"Téléchargement de l'installeur interrompu : aucune donnée reçue pendant {StallTimeout.TotalSeconds:0} s.");
        }
    }

    private void StartInstallScript(UpdateRequest request, string installerPath)
    {
        if (!File.Exists(ScriptPath))
            throw new FileNotFoundException("Script de mise à jour introuvable.", ScriptPath);

        // Verrou AVANT de fermer l'app → le watchdog ne relance pas entre-temps
        File.WriteAllText(LockPath, DateTime.UtcNow.ToString("o"));
        try
        {
            // Processus indépendant qui survit à la fermeture de l'app
            var psi = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true };
            foreach (var arg in new[] { "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
                                        "-File", ScriptPath, "-Installer", installerPath, "-Version", request.Version })
                psi.ArgumentList.Add(arg);
            if (!StartProcess(psi))
                throw new InvalidOperationException("Le script de mise à jour n'a pas démarré.");
        }
        catch
        {
            // Sans script, personne ne retirerait le verrou : la borne ne serait plus relancée.
            TryDelete(LockPath);
            throw;
        }
    }

    /// <summary>
    /// Vrai si le fichier a l'empreinte attendue. Sinon le fichier est supprimé (jamais exécuté).
    /// <paramref name="actual"/> = empreinte calculée (vide si le fichier est illisible).
    /// </summary>
    internal static bool CheckInstaller(string path, string expectedSha256, out string actual)
    {
        actual = "";
        var ok = false;
        try
        {
            using (var stream = File.OpenRead(path))
                actual = Convert.ToHexStringLower(SHA256.HashData(stream));
            ok = IsSha256Hex(expectedSha256)
                && CryptographicOperations.FixedTimeEquals(
                    Convert.FromHexString(actual), Convert.FromHexString(expectedSha256));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }

        if (!ok) TryDelete(path); // déjà absent ou verrouillé : jamais lancé de toute façon
        return ok;
    }

    // ── Échecs : enregistrés sur le disque jusqu'à leur signalement au SaaS ──────────────────────

    /// <summary>
    /// Au démarrage : une installation lancée avant le redémarrage a réussi si la version qui tourne
    /// est celle demandée. Sinon (update.failed écrit par apply-update.ps1, ou installation coupée),
    /// c'est un échec à signaler.
    /// </summary>
    private void CheckPreviousAttempt()
    {
        var failedVersion = TakeFailedMarker();
        var attempt = ReadJson<AttemptRecord>(AttemptPath);
        TryDelete(AttemptPath);

        if (attempt != null && !string.IsNullOrWhiteSpace(attempt.Version))
        {
            if (NormalizeVersion(attempt.Version) == NormalizeVersion(CurrentVersion))
            {
                _ = _log.LogInfoAsync("update", $"Mise à jour {attempt.Version} installée.");
                return;
            }

            var error = failedVersion != null && NormalizeVersion(failedVersion) == NormalizeVersion(attempt.Version)
                ? $"L'installeur de la version {attempt.Version} a échoué : la version {CurrentVersion} a redémarré (voir update.log sur la borne)."
                : $"Installation de la version {attempt.Version} interrompue : la borne a redémarré en version {CurrentVersion}.";
            RecordFailure(new FailureRecord(attempt.Version, attempt.RequestedAt, error));
            _ = _log.LogErrorAsync("update", error);
            return;
        }

        if (failedVersion != null)
        {
            var error = $"L'installeur de la version {failedVersion} a échoué : la version {CurrentVersion} a redémarré (voir update.log sur la borne).";
            RecordFailure(new FailureRecord(failedVersion, null, error));
            _ = _log.LogErrorAsync("update", error);
        }
    }

    private void LoadUnreportedFailure()
    {
        var failure = ReadJson<FailureRecord>(FailurePath);
        if (failure == null || string.IsNullOrWhiteSpace(failure.Version)) return;
        lock (_sync)
        {
            _unreported = failure;
            if (failure.RequestedAt != null) _failedRequests.Add(failure.RequestedAt);
        }
    }

    private void RecordFailure(FailureRecord failure)
    {
        lock (_sync)
        {
            if (failure.RequestedAt != null) _failedRequests.Add(failure.RequestedAt);
            _unreported = failure;
        }
        WriteJson(FailurePath, failure);
    }

    /// <summary>Signale l'échec en attente (s'il y en a un). Lève si le SaaS est injoignable.</summary>
    private async Task SendUnreportedFailureAsync(CancellationToken ct)
    {
        FailureRecord? failure;
        lock (_sync) failure = _unreported;
        if (failure == null) return;

        await _supabase.ReportUpdateFailureAsync(failure.Version, failure.RequestedAt, failure.Error, ct);

        lock (_sync)
        {
            if (!ReferenceEquals(_unreported, failure)) return; // un autre échec est arrivé entre-temps
            _unreported = null;
        }
        TryDelete(FailurePath);
        await _log.LogInfoAsync("update", $"Échec de la mise à jour {failure.Version} signalé au SaaS.");
    }

    private string? TakeFailedMarker()
    {
        try
        {
            if (!File.Exists(FailedMarkerPath)) return null;
            var version = File.ReadAllText(FailedMarkerPath).Trim();
            File.Delete(FailedMarkerPath);
            return version.Length == 0 ? null : version;
        }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
    }

    private static T? ReadJson<T>(string path) where T : class
    {
        try
        {
            return File.Exists(path) ? JsonConvert.DeserializeObject<T>(File.ReadAllText(path), RawDates) : null;
        }
        catch (Exception) { return null; } // fichier illisible ou corrompu : ignoré
    }

    private void WriteJson(string path, object value)
    {
        try
        {
            Directory.CreateDirectory(_localDir);
            File.WriteAllText(path, JsonConvert.SerializeObject(value));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch { }
    }

    private static bool IsSha256Hex(string? value)
        => value != null && Regex.IsMatch(value, "^[0-9a-fA-F]{64}$");

    private static string NormalizeVersion(string v)
        => Version.TryParse(v.Trim(), out var parsed) && parsed.Build >= 0
            ? $"{parsed.Major}.{parsed.Minor}.{parsed.Build}"
            : v.Trim();

    /// <summary>Installation lancée (update.attempt.json).</summary>
    internal sealed record AttemptRecord(
        [property: JsonProperty("version")] string Version,
        [property: JsonProperty("requested_at")] string? RequestedAt);

    /// <summary>Échec pas encore signalé au SaaS (update.failure.json).</summary>
    internal sealed record FailureRecord(
        [property: JsonProperty("version")] string Version,
        [property: JsonProperty("requested_at")] string? RequestedAt,
        [property: JsonProperty("error")] string Error);
}
