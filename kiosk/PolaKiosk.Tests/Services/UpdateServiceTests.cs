using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using FluentAssertions;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-197 : un installeur n'est lancé que si son SHA-256 correspond à celui publié dans le SaaS.
// LAB-200 : la borne n'installe que la version demandée depuis le SaaS ; un échec est signalé et
// la même demande n'est jamais réessayée. Téléchargement en flux, sans fichier partiel ni blocage.
public class UpdateServiceTests : IDisposable
{
    private const string ExeUrl      = "https://exemple.test/setup-9.9.9.exe";
    private const string Installed   = "1.0.15";
    private const string RequestedAt = "2026-11-03T10:00:00.123456+00:00";

    private readonly TempDir _dir = new();
    private readonly byte[] _bytes = Encoding.UTF8.GetBytes("faux installeur PolaKiosk 9.9.9");
    private readonly string _installer;
    private readonly string _sha256;
    private readonly StubHandler _handler = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly List<ProcessStartInfo> _started = new();

    public UpdateServiceTests()
    {
        _installer = _dir.File("setup-9.9.9.exe");
        File.WriteAllBytes(_installer, _bytes);
        _sha256 = Convert.ToHexStringLower(SHA256.HashData(_bytes));
    }

    public void Dispose() => _dir.Dispose();

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private UpdateService CreateService(TimeSpan? stallTimeout = null, string? scriptPath = null) =>
        new(_supabase.Object, _log.Object, _handler, _dir.Path, Installed)
        {
            StallTimeout = stallTimeout ?? TimeSpan.FromSeconds(60),
            ScriptPath   = scriptPath ?? _dir.File("absent-apply-update.ps1"),
            StartProcess = psi => { _started.Add(psi); return true; },
        };

    private UpdateRequest Update(string? sha256 = null, string version = "9.9.9",
                                 string requestedAt = RequestedAt, string exeUrl = ExeUrl)
        => new(version, exeUrl, sha256 ?? _sha256, requestedAt);

    private void ServerReturns(UpdateRequest? request)
        => _supabase.Setup(s => s.GetUpdateRequestAsync(It.IsAny<CancellationToken>())).ReturnsAsync(request);

    private void VerifyReported(string version, string? requestedAt, Func<string, bool> error, Times times)
        => _supabase.Verify(s => s.ReportUpdateFailureAsync(version, requestedAt, It.Is<string>(e => error(e)),
            It.IsAny<CancellationToken>()), times);

    private void VerifyNothingReported()
        => _supabase.Verify(s => s.ReportUpdateFailureAsync(It.IsAny<string>(), It.IsAny<string?>(),
            It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);

    // ── Vérification de l'empreinte (LAB-197) ─────────────────────────────

    [Fact]
    public void CheckInstaller_accepts_the_published_hash()
    {
        UpdateService.CheckInstaller(_installer, _sha256, out var actual).Should().BeTrue();

        actual.Should().Be(_sha256);
        File.Exists(_installer).Should().BeTrue();
    }

    [Fact]
    public void CheckInstaller_accepts_an_uppercase_hash()
    {
        UpdateService.CheckInstaller(_installer, _sha256.ToUpperInvariant(), out _).Should().BeTrue();
    }

    [Fact]
    public void CheckInstaller_refuses_a_wrong_hash_and_deletes_the_file()
    {
        var wrong = new string('0', 64);

        UpdateService.CheckInstaller(_installer, wrong, out var actual).Should().BeFalse();

        actual.Should().Be(_sha256);
        File.Exists(_installer).Should().BeFalse("un installeur refusé ne doit jamais rester sur le disque");
    }

    [Theory]
    [InlineData("")]
    [InlineData("pas-un-hash")]
    [InlineData("abc123")]
    public void CheckInstaller_refuses_a_missing_or_malformed_hash(string expected)
    {
        UpdateService.CheckInstaller(_installer, expected, out _).Should().BeFalse();
        File.Exists(_installer).Should().BeFalse();
    }

    [Fact]
    public void CheckInstaller_refuses_a_missing_file()
    {
        UpdateService.CheckInstaller(_dir.File("absent.exe"), _sha256, out var actual).Should().BeFalse();
        actual.Should().BeEmpty();
    }

    // ── Téléchargement et lancement ───────────────────────────────────────

    [Fact]
    public async Task Download_writes_the_verified_installer_to_disk()
    {
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(_bytes) };
        var service = CreateService();

        var path = await service.DownloadInstallerAsync(Update(), Ct);

        path.Should().Be(Path.Combine(service.UpdatesDir, "setup-9.9.9.exe"));
        File.ReadAllBytes(path!).Should().Equal(_bytes);
        Directory.GetFiles(service.UpdatesDir, "*.part").Should().BeEmpty();
    }

    [Fact]
    public async Task Download_reuses_an_already_verified_installer()
    {
        var service = CreateService();
        Directory.CreateDirectory(service.UpdatesDir);
        File.WriteAllBytes(Path.Combine(service.UpdatesDir, "setup-9.9.9.exe"), _bytes);
        _handler.Respond = _ => throw new HttpRequestException("ne doit pas être appelé");

        var path = await service.DownloadInstallerAsync(Update(), Ct);

        path.Should().NotBeNull();
        _handler.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Download_server_error_throws_and_leaves_no_file()
    {
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.InternalServerError);
        var service = CreateService();

        var act = () => service.DownloadInstallerAsync(Update(), Ct);

        await act.Should().ThrowAsync<HttpRequestException>();
        Directory.GetFiles(service.UpdatesDir).Should().BeEmpty();
    }

    [Fact]
    public async Task Download_that_stalls_times_out_and_leaves_no_partial_file()
    {
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new StallingStream(_bytes[..5])) };
        var service = CreateService(stallTimeout: TimeSpan.FromMilliseconds(200));

        var act = () => service.DownloadInstallerAsync(Update(), Ct);

        await act.Should().ThrowAsync<TimeoutException>();
        Directory.GetFiles(service.UpdatesDir).Should().BeEmpty("le fichier .part doit être supprimé");
    }

    [Fact]
    public async Task Download_with_a_wrong_hash_returns_null_and_deletes_the_file()
    {
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(_bytes) };
        var service = CreateService();

        var path = await service.DownloadInstallerAsync(Update(new string('0', 64)), Ct);

        path.Should().BeNull();
        Directory.GetFiles(service.UpdatesDir).Should().BeEmpty();
        _log.Verify(l => l.LogErrorAsync("update", It.Is<string>(m => m.Contains("refusé")), It.IsAny<string?>()), Times.Once);
    }

    [Fact]
    public async Task Apply_starts_the_install_script_for_the_requested_version()
    {
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(_bytes) };
        var script = _dir.File("apply-update.ps1");
        File.WriteAllText(script, "# script de test");
        var service = CreateService(scriptPath: script);

        (await service.ApplyAsync(Update(), Ct)).Should().BeTrue();

        _started.Should().ContainSingle();
        _started[0].FileName.Should().Be(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"));
        Path.IsPathFullyQualified(_started[0].FileName).Should().BeTrue();
        _started[0].ArgumentList.Should().ContainInConsecutiveOrder("-Version", "9.9.9");
        _started[0].ArgumentList.Should().Contain(Path.Combine(service.UpdatesDir, "setup-9.9.9.exe"));
        File.Exists(_dir.File("update.lock")).Should().BeTrue("le watchdog ne doit pas relancer l'app pendant l'installation");
        using var reader = new Newtonsoft.Json.JsonTextReader(new StringReader(File.ReadAllText(_dir.File("update.attempt.json"))))
            { DateParseHandling = Newtonsoft.Json.DateParseHandling.None };
        var attempt = JObject.Load(reader);
        attempt["version"]!.Value<string>().Should().Be("9.9.9");
        attempt["requested_at"]!.Value<string>().Should().Be(RequestedAt);
    }

    [Fact]
    public async Task Apply_without_install_script_throws_and_leaves_no_lock()
    {
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(_bytes) };
        var service = CreateService();

        var act = () => service.ApplyAsync(Update(), Ct);

        await act.Should().ThrowAsync<FileNotFoundException>();
        File.Exists(_dir.File("update.lock")).Should().BeFalse("un verrou orphelin empêcherait le watchdog de relancer l'app");
        File.Exists(_dir.File("update.attempt.json")).Should().BeFalse();
        _started.Should().BeEmpty();
    }

    // ── Demande depuis le SaaS (LAB-200) ──────────────────────────────────

    [Fact]
    public async Task Without_a_request_nothing_is_downloaded()
    {
        ServerReturns(null);
        var service = CreateService();

        (await service.GetPendingRequestAsync(Ct)).Should().BeNull();

        _handler.Calls.Should().Be(0, "aucune demande dans le SaaS = aucun téléchargement");
        Directory.Exists(service.UpdatesDir).Should().BeFalse();
        VerifyNothingReported();
    }

    [Fact]
    public async Task A_request_is_returned_for_installation()
    {
        ServerReturns(Update());

        (await CreateService().GetPendingRequestAsync(Ct)).Should().Be(Update());

        _handler.Calls.Should().Be(0, "le téléchargement n'a lieu qu'à l'installation, sur un écran sûr");
    }

    [Theory]
    [InlineData("1.0.15")]
    [InlineData("1.0.15.0")]
    [InlineData(" 1.0.15 ")]
    public async Task A_request_for_the_installed_version_is_ignored(string version)
    {
        ServerReturns(Update(version: version));

        (await CreateService().GetPendingRequestAsync(Ct)).Should().BeNull();
        VerifyNothingReported();
    }

    [Theory]
    [InlineData("9.9.9 -Installer x", null, ExeUrl, "invalide")]
    [InlineData("9.9.9", "pas-un-hash", ExeUrl, "SHA-256")]
    [InlineData("9.9.9", "", ExeUrl, "SHA-256")]
    [InlineData("9.9.9", null, "", "adresse")]
    [InlineData("9.9.9", null, "file:///C:/setup.exe", "https")]
    [InlineData("9.9.9", null, "http://exemple.test/setup-9.9.9.exe", "https")]
    [InlineData("9.9.9", null, "ftp://exemple.test/setup-9.9.9.exe", "https")]
    public async Task An_unusable_request_is_reported_as_failed(string version, string? sha256, string exeUrl, string expected)
    {
        ServerReturns(Update(sha256: sha256, version: version, exeUrl: exeUrl));
        var service = CreateService();

        (await service.GetPendingRequestAsync(Ct)).Should().BeNull();
        VerifyReported(version, RequestedAt, e => e.Contains(expected), Times.Once());

        (await service.GetPendingRequestAsync(Ct)).Should().BeNull();
        VerifyReported(version, RequestedAt, _ => true, Times.Once());
    }

    [Fact]
    public async Task Offline_returns_null_without_throwing()
    {
        _supabase.Setup(s => s.GetUpdateRequestAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("Hôte inaccessible"));

        (await CreateService().GetPendingRequestAsync(Ct)).Should().BeNull();
    }

    [Fact]
    public async Task A_failure_is_reported_and_the_same_request_is_never_retried()
    {
        ServerReturns(Update());
        var service = CreateService();

        await service.ReportFailureAsync(Update(), "Hôte inaccessible", Ct);

        VerifyReported("9.9.9", RequestedAt, e => e == "Hôte inaccessible", Times.Once());
        (await service.GetPendingRequestAsync(Ct)).Should().BeNull("la même demande ne doit pas être réessayée");
        File.Exists(_dir.File("update.failure.json")).Should().BeFalse("échec signalé : plus rien en attente");
    }

    [Fact]
    public async Task A_new_request_after_a_failure_is_attempted_again()
    {
        var service = CreateService();
        await service.ReportFailureAsync(Update(), "Hôte inaccessible", Ct);

        var newRequest = Update(requestedAt: "2026-11-03T11:30:00+00:00");
        ServerReturns(newRequest);

        (await service.GetPendingRequestAsync(Ct)).Should().Be(newRequest);
    }

    [Fact]
    public async Task A_failure_that_could_not_be_reported_is_kept_and_reported_after_a_restart()
    {
        _supabase.Setup(s => s.ReportUpdateFailureAsync(It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("Hôte inaccessible"));
        var first = CreateService();

        var act = () => first.ReportFailureAsync(Update(), "Téléchargement interrompu", Ct);
        await act.Should().NotThrowAsync();
        File.Exists(_dir.File("update.failure.json")).Should().BeTrue();

        // Redémarrage, réseau revenu : le serveur renvoie encore la demande (échec pas encore connu).
        _supabase.Reset();
        ServerReturns(Update());
        var restarted = CreateService();

        (await restarted.GetPendingRequestAsync(Ct)).Should().BeNull("la demande en échec n'est pas réessayée");
        VerifyReported("9.9.9", RequestedAt, e => e == "Téléchargement interrompu", Times.Once());
        File.Exists(_dir.File("update.failure.json")).Should().BeFalse();
    }

    // ── Redémarrage après une installation (apply-update.ps1) ─────────────

    private void WriteAttempt(string version)
        => File.WriteAllText(_dir.File("update.attempt.json"),
            new JObject { ["version"] = version, ["requested_at"] = RequestedAt }.ToString());

    [Fact]
    public async Task A_failed_installer_is_reported_at_the_next_start()
    {
        WriteAttempt("9.9.9");
        File.WriteAllText(_dir.File("update.failed"), "9.9.9\n");
        ServerReturns(Update());

        var service = CreateService();
        (await service.GetPendingRequestAsync(Ct)).Should().BeNull("pas de nouvel essai sans nouvelle demande");

        VerifyReported("9.9.9", RequestedAt, e => e.Contains("a échoué") && e.Contains(Installed), Times.Once());
        File.Exists(_dir.File("update.failed")).Should().BeFalse();
        File.Exists(_dir.File("update.attempt.json")).Should().BeFalse();
    }

    [Fact]
    public async Task An_interrupted_installation_is_reported_at_the_next_start()
    {
        WriteAttempt("9.9.9");
        ServerReturns(null);

        await CreateService().GetPendingRequestAsync(Ct);

        VerifyReported("9.9.9", RequestedAt, e => e.Contains("interrompue"), Times.Once());
    }

    [Fact]
    public async Task A_failure_marker_without_attempt_is_still_reported()
    {
        File.WriteAllText(_dir.File("update.failed"), "9.9.9\n");
        ServerReturns(null);

        await CreateService().GetPendingRequestAsync(Ct);

        VerifyReported("9.9.9", null, e => e.Contains("a échoué"), Times.Once());
    }

    [Fact]
    public async Task A_successful_installation_reports_nothing()
    {
        WriteAttempt(Installed);
        ServerReturns(null);

        await CreateService().GetPendingRequestAsync(Ct);

        VerifyNothingReported();
        File.Exists(_dir.File("update.attempt.json")).Should().BeFalse();
        _log.Verify(l => l.LogInfoAsync("update", It.Is<string>(m => m.Contains("installée"))), Times.Once);
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        public Func<HttpRequestMessage, HttpResponseMessage> Respond { get; set; } =
            _ => new HttpResponseMessage(HttpStatusCode.NotFound);
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            return Task.FromResult(Respond(request));
        }
    }

    /// <summary>Renvoie quelques octets puis plus rien, comme une connexion 4G qui cale.</summary>
    private sealed class StallingStream(byte[] head) : Stream
    {
        private bool _sent;

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        {
            if (!_sent)
            {
                _sent = true;
                head.CopyTo(buffer);
                return head.Length;
            }
            await Task.Delay(Timeout.Infinite, ct);
            return 0;
        }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct)
            => ReadAsync(buffer.AsMemory(offset, count), ct).AsTask();

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
