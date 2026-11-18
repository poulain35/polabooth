using System.Net;
using FluentAssertions;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Une borne de test : base SQLite, dossier de données et Supabase simulé.</summary>
internal sealed class TestKiosk : IDisposable
{
    public TestDb Db { get; } = new();
    public TempDir Dir { get; } = new();
    public Mock<ISupabaseService> Supabase { get; } = new();
    public Mock<IKioskStateService> State { get; } = new();
    public Mock<IKioskLogService> Log { get; } = new();
    public PolaHistory History => new(Dir.Path);

    public SyncService NewService()
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = Dir.Path;
        return new SyncService(Supabase.Object, Db.NewContext(), settings, State.Object, Log.Object, History);
    }

    public string PolaPath(string name) => Path.Combine(Dir.Path, "pola", name);

    /// <summary>Fichiers du dossier de données (chemins relatifs, hors pola\), avec leur contenu.</summary>
    public Dictionary<string, byte[]> DataFiles()
        => Directory.EnumerateFiles(Dir.Path, "*", SearchOption.AllDirectories)
            .Select(f => Path.GetRelativePath(Dir.Path, f))
            .Where(f => !f.StartsWith("pola"))
            .ToDictionary(f => f, f => File.ReadAllBytes(Path.Combine(Dir.Path, f)));

    public void Dispose()
    {
        Db.Dispose();
        Dir.Dispose();
    }
}

public class SyncServiceTests : IDisposable
{
    private static readonly Guid EventId = PolaFixture.EventId;
    private const string Code = PolaFixture.Code;

    private readonly TestKiosk _kiosk = new();

    public SyncServiceTests()
    {
        // Export .pola de l'événement, déposé à l'avance pour un événement sans réseau.
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), PolaFixture.Bundle());
    }

    public void Dispose() => _kiosk.Dispose();

    private SyncService NewService() => _kiosk.NewService();

    private void SetupEventByCode(Exception error)
        => _kiosk.Supabase.Setup(s => s.GetEventByCodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                          .ThrowsAsync(error);

    private TemplateEntity SingleTemplate()
    {
        using var ctx = _kiosk.Db.NewContext();
        return ctx.Templates.Should().ContainSingle().Subject;
    }

    // ── Import du fichier .pola (LAB-216) ─────────────────────────────────────

    [Fact]
    public async Task ImportPolaFileAsync_stores_the_whole_event_with_its_design()
    {
        using var usb = new TempDir();
        var source = usb.File("mariage_julie_TUQNA5.pola");
        PolaFixture.Write(source, PolaFixture.Bundle());
        var service = NewService();

        await service.ImportPolaFileAsync(source);

        using (var ctx = _kiosk.Db.NewContext())
        {
            var ev = ctx.Events.Should().ContainSingle().Subject;
            ev.Id.Should().Be(EventId);
            ev.AccessCode.Should().Be(Code);
            ev.FormConfigJson.Should().Contain(PolaFixture.BackgroundUrl).And.Contain("countdown_seconds");

            // Accueil personnalisé (LAB-251) : dates et nom affiché gardés dans la base locale.
            ev.StartDate.Should().Be(DateTimeOffset.Parse(PolaFixture.StartDate));
            ev.EndDate.Should().Be(DateTimeOffset.Parse(PolaFixture.EndDate));
            var home = Newtonsoft.Json.Linq.JObject.Parse(ev.FormConfigJson)["kiosk"]!["home"]!;
            ((bool)home["personalized"]!).Should().BeTrue();
            ((string)home["display_name"]!).Should().Be(PolaFixture.DisplayName);
        }

        var template = SingleTemplate();
        template.Id.Should().Be(PolaFixture.DesignId);
        template.EventId.Should().Be(EventId);
        template.Format.Should().Be("stripV");
        CompositeService.ParsePhotoZones(template.CanvasJson)
            .Should().Equal(new PhotoZone(20, 30, 160, 120));
        File.ReadAllBytes(template.ThumbnailPath!).Should().Equal(PolaFixture.DesignPng);

        File.ReadAllBytes(service.GetHomeBackgroundPath(EventId, PolaFixture.BackgroundUrl))
            .Should().Equal(PolaFixture.HomeBackground);
        _kiosk.State.Verify(s => s.SetContactInfoAsync(PolaFixture.Company, PolaFixture.Phone, PolaFixture.Email), Times.Once);
        File.ReadAllBytes(service.GetOrgLogoPath()!).Should().Equal(PolaFixture.Logo, "le logo de la société reste disponible hors ligne");

        File.ReadAllBytes(_kiosk.PolaPath($"{EventId:N}.pola"))
            .Should().Equal(File.ReadAllBytes(source), "la saisie du code sans réseau cherche dans pola\\");
    }

    [Fact]
    public async Task ImportPolaFileAsync_gives_the_same_kiosk_as_the_online_sync()
    {
        using var online = new TestKiosk();
        online.Supabase.Setup(s => s.GetEventByCodeAsync(Code, It.IsAny<CancellationToken>()))
              .ReturnsAsync(SupabaseRpcResponses.ParseEventRpcResponse(PolaFixture.Event().ToString()));
        online.Supabase.Setup(s => s.GetApprovedDesignAsync(EventId, It.IsAny<CancellationToken>()))
              .ReturnsAsync(ApprovedDesignReader.ParseApprovedDesign(PolaFixture.Design()));
        online.Supabase.Setup(s => s.GetOrgContactByEventAsync(EventId, It.IsAny<CancellationToken>()))
              .ReturnsAsync(PolaFixture.Contact());
        online.Supabase.Setup(s => s.DownloadAssetAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .Returns((string url, string path, CancellationToken _) =>
              {
                  Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                  return File.WriteAllBytesAsync(path, url switch
                  {
                      PolaFixture.BackgroundUrl => PolaFixture.HomeBackground,
                      PolaFixture.DesignPngUrl  => PolaFixture.DesignPng,
                      PolaFixture.LogoUrl       => PolaFixture.Logo,
                      _ => throw new InvalidOperationException($"Téléchargement inattendu : {url}"),
                  });
              });
        var onlineService = online.NewService();
        await onlineService.SyncByCodeAsync(Code, TestContext.Current.CancellationToken);

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        using var onlineDb = online.Db.NewContext();
        using var offlineDb = _kiosk.Db.NewContext();
        var (onlineEvent, offlineEvent) = (onlineDb.Events.Single(), offlineDb.Events.Single());
        offlineEvent.Should().BeEquivalentTo(onlineEvent, o => o.Excluding(e => e.SyncedAt));
        onlineEvent.StartDate.Should().Be(DateTimeOffset.Parse(PolaFixture.StartDate), "les dates viennent de kiosk_get_event");
        onlineEvent.EndDate.Should().Be(DateTimeOffset.Parse(PolaFixture.EndDate));

        var (onlineTemplate, offlineTemplate) = (onlineDb.Templates.Single(), offlineDb.Templates.Single());
        offlineTemplate.Should().BeEquivalentTo(onlineTemplate, o => o.Excluding(t => t.ThumbnailPath));
        Path.GetRelativePath(_kiosk.Dir.Path, offlineTemplate.ThumbnailPath!)
            .Should().Be(Path.GetRelativePath(online.Dir.Path, onlineTemplate.ThumbnailPath!));

        _kiosk.DataFiles().Should().BeEquivalentTo(online.DataFiles());
        _kiosk.DataFiles().Keys.Should().Contain(f => f.StartsWith("logo"), "le logo est dans le fichier comme en ligne");
        _kiosk.State.Verify(s => s.SetContactInfoAsync(PolaFixture.Company, PolaFixture.Phone, PolaFixture.Email), Times.Once);
        online.State.Verify(s => s.SetContactInfoAsync(PolaFixture.Company, PolaFixture.Phone, PolaFixture.Email), Times.Once);
    }

    [Fact]
    public async Task ImportPolaFileAsync_ignores_the_removed_default_background()
    {
        // LAB-255 : un .pola exporté avant le retrait du fond par défaut s'importe toujours.
        var bundle = PolaFixture.Bundle();
        ((Newtonsoft.Json.Linq.JObject)bundle["assets"]!)["default_background"] = Convert.ToBase64String([0xFF, 0xD8, 0xFF, 6, 7]);
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), bundle);

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        SingleTemplate().Id.Should().Be(PolaFixture.DesignId);
        File.Exists(Path.Combine(_kiosk.Dir.Path, "default_background.jpg")).Should().BeFalse();
    }

    [Fact]
    public async Task ImportPolaFileAsync_refuses_a_file_without_design_and_writes_nothing()
    {
        var bundle = PolaFixture.Bundle();
        bundle.Remove("design");
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), bundle);

        var act = () => NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        (await act.Should().ThrowAsync<InvalidDataException>()).WithMessage(PolaBundle.NoDesignMessage);
        AssertNothingImported();
    }

    [Fact]
    public async Task ImportPolaFileAsync_refuses_a_design_without_its_png()
    {
        var bundle = PolaFixture.Bundle();
        ((Newtonsoft.Json.Linq.JObject)bundle["assets"]!).Remove("design_png");
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), bundle);

        var act = () => NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        (await act.Should().ThrowAsync<InvalidDataException>()).WithMessage(PolaBundle.NoDesignMessage);
        AssertNothingImported();
    }

    [Fact]
    public async Task ImportPolaFileAsync_refuses_an_old_format_file()
    {
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), PolaFixture.OldBundle());

        var act = () => NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        (await act.Should().ThrowAsync<InvalidDataException>()).WithMessage(PolaBundle.OldFormatMessage);
        AssertNothingImported();
    }

    [Fact]
    public async Task ImportPolaFileAsync_refuses_a_file_that_is_not_a_pola()
    {
        using var usb = new TempDir();
        File.WriteAllText(usb.File("photo.pola"), "pas du gzip");

        var act = () => NewService().ImportPolaFileAsync(usb.File("photo.pola"));

        (await act.Should().ThrowAsync<InvalidDataException>()).WithMessage(PolaBundle.UnreadableMessage);
        AssertNothingImported();
    }

    [Fact]
    public async Task ImportPolaFileAsync_keeps_only_the_approved_design_for_the_event()
    {
        using (var ctx = _kiosk.Db.NewContext())
        {
            ctx.Templates.Add(new TemplateEntity { Id = Guid.NewGuid(), EventId = EventId, Name = "Bibliothèque", Format = "portrait" });
            await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        SingleTemplate().Id.Should().Be(PolaFixture.DesignId, "LiveViewModel prend le premier modèle de l'événement");
    }

    [Fact]
    public async Task An_admin_import_from_a_usb_stick_works_later_without_network()
    {
        File.Delete(_kiosk.PolaPath("mariage.pola"));
        using var usb = new TempDir();
        PolaFixture.Write(usb.File("mariage.pola"), PolaFixture.Bundle());
        await NewService().ImportPolaFileAsync(usb.File("mariage.pola"));
        SetupEventByCode(new HttpRequestException("Hôte inaccessible"));

        var ev = await NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken);

        ev.Should().NotBeNull();
        ev!.Id.Should().Be(EventId);
    }

    private void AssertNothingImported()
    {
        using var ctx = _kiosk.Db.NewContext();
        ctx.Events.Should().BeEmpty();
        ctx.Templates.Should().BeEmpty();
        _kiosk.DataFiles().Should().BeEmpty();
        _kiosk.State.VerifyNoOtherCalls();
    }

    // ── Saisie du code : en ligne, puis repli sur les fichiers .pola ──────────

    [Fact]
    public async Task SyncByCodeAsync_falls_back_to_pola_file_without_network()
    {
        SetupEventByCode(new HttpRequestException("Hôte inaccessible"));

        var ev = await NewService().SyncByCodeAsync(" tuqna5 ", TestContext.Current.CancellationToken);

        ev.Should().NotBeNull();
        ev!.Id.Should().Be(EventId);
        ev.AccessCode.Should().Be(Code);
        var template = SingleTemplate();
        template.Id.Should().Be(PolaFixture.DesignId, "hors ligne aussi, l'événement a son cadre");
        File.ReadAllBytes(template.ThumbnailPath!).Should().Equal(PolaFixture.DesignPng);
    }

    [Fact]
    public async Task SyncByCodeAsync_falls_back_to_pola_file_when_the_request_times_out()
    {
        SetupEventByCode(new TaskCanceledException("Délai du HttpClient dépassé"));

        var ev = await NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken);

        ev.Should().NotBeNull();
        ev!.Id.Should().Be(EventId);
    }

    [Fact]
    public async Task SyncByCodeAsync_skips_old_or_broken_pola_files()
    {
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), PolaFixture.OldBundle());
        File.WriteAllText(_kiosk.PolaPath("abime.pola"), "pas du gzip");
        SetupEventByCode(new HttpRequestException("Hôte inaccessible"));

        var ev = await NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken);

        ev.Should().BeNull("un ancien fichier donnerait un événement sans cadre");
        using var ctx = _kiosk.Db.NewContext();
        ctx.Events.Should().BeEmpty();
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.BadGateway)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task SyncByCodeAsync_shows_the_server_error_instead_of_the_pola_file(HttpStatusCode status)
    {
        SetupEventByCode(new HttpRequestException("Réponse en erreur", null, status));

        var act = () => NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<Exception>())
            .WithMessage($"*({(int)status})*");
        using var ctx = _kiosk.Db.NewContext();
        ctx.Events.Should().BeEmpty("le .pola ne doit pas masquer une vraie erreur du serveur");
    }

    [Fact]
    public async Task SyncByCodeAsync_returns_null_for_an_unknown_code_even_with_a_pola_file()
    {
        _kiosk.Supabase.Setup(s => s.GetEventByCodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                       .ReturnsAsync((EventDto?)null);

        var ev = await NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken);

        ev.Should().BeNull();
    }

    [Fact]
    public async Task SyncByCodeAsync_lets_a_caller_cancellation_through()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        SetupEventByCode(new TaskCanceledException());

        var act = () => NewService().SyncByCodeAsync(Code, cts.Token);

        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public void IsNetworkUnavailable_only_matches_missing_responses()
    {
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        SyncService.IsNetworkUnavailable(new HttpRequestException("pas de réseau"), CancellationToken.None).Should().BeTrue();
        SyncService.IsNetworkUnavailable(new TaskCanceledException(), CancellationToken.None).Should().BeTrue();
        SyncService.IsNetworkUnavailable(new TaskCanceledException(), cancelled.Token).Should().BeFalse();
        SyncService.IsNetworkUnavailable(
            new HttpRequestException("500", null, HttpStatusCode.InternalServerError), CancellationToken.None).Should().BeFalse();
        SyncService.IsNetworkUnavailable(new InvalidOperationException(), CancellationToken.None).Should().BeFalse();
    }

    // ── Compte de la borne (LAB-244) ──────────────────────────────────────────

    /// <summary>Réécrit le .pola de test avec un compte connu.</summary>
    private Guid WritePolaOfAccount()
    {
        var orgId = Guid.NewGuid();
        var bundle = PolaFixture.Bundle();
        bundle["event"]!["org_id"] = orgId.ToString();
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), bundle);
        return orgId;
    }

    [Fact]
    public async Task ImportPolaFileAsync_refuses_a_file_from_another_account()
    {
        _kiosk.State.SetupGet(s => s.AccountOrgId).Returns(Guid.NewGuid());

        var act = () => NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        (await act.Should().ThrowAsync<InvalidDataException>()).WithMessage(PolaBundle.OtherAccountMessage);
        using var ctx = _kiosk.Db.NewContext();
        ctx.Events.Should().BeEmpty();
    }

    [Fact]
    public async Task ImportPolaFileAsync_accepts_a_file_from_the_kiosk_account()
    {
        _kiosk.State.SetupGet(s => s.AccountOrgId).Returns(WritePolaOfAccount());

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        using var ctx = _kiosk.Db.NewContext();
        ctx.Events.Should().ContainSingle();
    }

    [Fact]
    public async Task ImportPolaFileAsync_accepts_any_file_while_the_kiosk_account_is_unknown()
    {
        _kiosk.State.SetupGet(s => s.AccountOrgId).Returns((Guid?)null);

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        using var ctx = _kiosk.Db.NewContext();
        ctx.Events.Should().ContainSingle("première mise en route hors ligne : le compte n'est pas encore connu");
    }

    [Fact]
    public async Task SyncByCodeAsync_skips_a_pola_file_from_another_account_without_network()
    {
        _kiosk.State.SetupGet(s => s.AccountOrgId).Returns(Guid.NewGuid());
        SetupEventByCode(new HttpRequestException("Hôte inaccessible"));

        var ev = await NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken);

        ev.Should().BeNull();
        using var ctx = _kiosk.Db.NewContext();
        ctx.Events.Should().BeEmpty();
    }

    [Fact]
    public async Task SyncByCodeAsync_remembers_the_account_returned_by_kiosk_get_event()
    {
        var dto = SupabaseRpcResponses.ParseEventRpcResponse(PolaFixture.Event().ToString())!;
        _kiosk.Supabase.Setup(s => s.GetEventByCodeAsync(Code, It.IsAny<CancellationToken>())).ReturnsAsync(dto);
        _kiosk.Supabase.Setup(s => s.GetApprovedDesignAsync(EventId, It.IsAny<CancellationToken>()))
              .ReturnsAsync(ApprovedDesignReader.ParseApprovedDesign(PolaFixture.Design()));
        _kiosk.Supabase.Setup(s => s.GetOrgContactByEventAsync(EventId, It.IsAny<CancellationToken>()))
              .ReturnsAsync(new OrgContact("Studio Exemple", "06 00 00 00 00", null));

        await NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken);

        dto.OrgId.Should().NotBe(Guid.Empty);
        _kiosk.State.Verify(s => s.SetAccountOrgIdAsync(dto.OrgId), Times.Once);
    }

    [Fact]
    public async Task SyncByCodeAsync_lets_a_refused_license_through_without_reading_pola_files()
    {
        SetupEventByCode(new KioskLicenseRefusedException());

        var act = () => NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken);

        await act.Should().ThrowAsync<KioskLicenseRefusedException>();
        using var ctx = _kiosk.Db.NewContext();
        ctx.Events.Should().BeEmpty();
    }

    // ── Plus de fond par défaut (LAB-255) ─────────────────────────────────────

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task An_event_load_downloads_only_the_event_files(bool pushed)
    {
        var dto = SupabaseRpcResponses.ParseEventRpcResponse(PolaFixture.Event().ToString())!;
        _kiosk.Supabase.Setup(s => s.GetEventByCodeAsync(Code, It.IsAny<CancellationToken>())).ReturnsAsync(dto);
        _kiosk.Supabase.Setup(s => s.GetApprovedDesignAsync(EventId, It.IsAny<CancellationToken>()))
              .ReturnsAsync(ApprovedDesignReader.ParseApprovedDesign(PolaFixture.Design()));
        _kiosk.Supabase.Setup(s => s.DownloadAssetAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .Returns((string url, string path, CancellationToken _) =>
              {
                  Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                  return File.WriteAllBytesAsync(path, url == PolaFixture.DesignPngUrl ? PolaFixture.DesignPng : PolaFixture.HomeBackground);
              });
        var service = NewService();

        var ev = pushed
            ? await service.SyncPushedEventAsync(dto, TestContext.Current.CancellationToken)
            : await service.SyncByCodeAsync(Code, TestContext.Current.CancellationToken);

        ev.Should().NotBeNull();
        _kiosk.Supabase.Verify(s => s.DownloadAssetAsync(It.Is<string>(u => u.Contains("kiosk-backgrounds/default/")),
            It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        _kiosk.Supabase.Verify(s => s.DownloadAssetAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Exactly(2), "le fond d'accueil et le PNG du design, rien d'autre");
    }

    // ── Logo de la société (LAB-257) ──────────────────────────────────────────

    private const string NewLogoUrl = "https://cdn.example/kiosk-backgrounds/org/o1/logo.jpg?v=2";
    private static readonly byte[] NewLogo = [0xFF, 0xD8, 0xFF, 9, 9];

    /// <summary>Synchro en ligne de l'événement avec la fiche contact donnée (null : RPC sans réponse utile).</summary>
    private async Task SyncOnlineAsync(OrgContact? contact, bool logoDownloadFails = false)
    {
        _kiosk.Supabase.Setup(s => s.GetEventByCodeAsync(Code, It.IsAny<CancellationToken>()))
              .ReturnsAsync(SupabaseRpcResponses.ParseEventRpcResponse(PolaFixture.Event().ToString()));
        _kiosk.Supabase.Setup(s => s.GetApprovedDesignAsync(EventId, It.IsAny<CancellationToken>()))
              .ReturnsAsync(ApprovedDesignReader.ParseApprovedDesign(PolaFixture.Design()));
        _kiosk.Supabase.Setup(s => s.GetOrgContactByEventAsync(EventId, It.IsAny<CancellationToken>()))
              .ReturnsAsync(contact);
        _kiosk.Supabase.Setup(s => s.DownloadAssetAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .Returns((string url, string path, CancellationToken _) =>
              {
                  if (logoDownloadFails && url.Contains("/org/"))
                      return Task.FromException(new HttpRequestException("Hôte inaccessible"));
                  Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                  return File.WriteAllBytesAsync(path, url switch
                  {
                      PolaFixture.LogoUrl      => PolaFixture.Logo,
                      NewLogoUrl               => NewLogo,
                      PolaFixture.DesignPngUrl => PolaFixture.DesignPng,
                      _                        => PolaFixture.HomeBackground,
                  });
              });

        (await NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken)).Should().NotBeNull();
    }

    private byte[]? CachedLogo() => NewService().GetOrgLogoPath() is { } path ? File.ReadAllBytes(path) : null;

    private string[] LogoFiles() => Directory.GetFiles(Path.Combine(_kiosk.Dir.Path, "logo"));

    private int DownloadsOf(string url) => _kiosk.Supabase.Invocations.Count(i =>
        i.Method.Name == nameof(ISupabaseService.DownloadAssetAsync) && Equals(i.Arguments[0], url));

    [Fact]
    public async Task The_logo_is_downloaded_once_and_kept_for_offline_use()
    {
        NewService().GetOrgLogoPath().Should().BeNull("aucun logo avant la première synchro");

        await SyncOnlineAsync(PolaFixture.Contact());
        await SyncOnlineAsync(PolaFixture.Contact());

        CachedLogo().Should().Equal(PolaFixture.Logo);
        DownloadsOf(PolaFixture.LogoUrl).Should().Be(1, "le logo en cache sert aux synchros suivantes");
    }

    [Fact]
    public async Task A_logo_replaced_in_the_admin_replaces_the_cached_one()
    {
        await SyncOnlineAsync(PolaFixture.Contact());

        await SyncOnlineAsync(PolaFixture.Contact() with { LogoUrl = NewLogoUrl });

        CachedLogo().Should().Equal(NewLogo);
        LogoFiles().Should().ContainSingle("l'ancien logo est supprimé");
    }

    [Fact]
    public async Task A_logo_removed_in_the_admin_is_removed_at_the_next_sync()
    {
        await SyncOnlineAsync(PolaFixture.Contact());

        await SyncOnlineAsync(PolaFixture.Contact() with { LogoUrl = null });

        NewService().GetOrgLogoPath().Should().BeNull();
        LogoFiles().Should().BeEmpty();
    }

    [Fact]
    public async Task The_cached_logo_stays_when_the_contact_or_the_new_logo_cannot_be_read()
    {
        await SyncOnlineAsync(PolaFixture.Contact());

        await SyncOnlineAsync(null);
        CachedLogo().Should().Equal(PolaFixture.Logo, "RPC sans réponse utile : rien ne change");

        await SyncOnlineAsync(PolaFixture.Contact() with { LogoUrl = NewLogoUrl }, logoDownloadFails: true);
        CachedLogo().Should().Equal(PolaFixture.Logo, "téléchargement en échec : l'ancien logo reste affiché");
    }

    [Fact]
    public async Task A_pola_file_of_a_company_without_logo_removes_the_cached_one()
    {
        await SyncOnlineAsync(PolaFixture.Contact());
        var bundle = PolaFixture.Bundle();
        bundle["contact"]!["logo_url"] = null;
        ((Newtonsoft.Json.Linq.JObject)bundle["assets"]!).Remove("logo");
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), bundle);

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        NewService().GetOrgLogoPath().Should().BeNull();
    }

    [Fact]
    public async Task A_pola_file_without_its_logo_keeps_the_cached_one()
    {
        await SyncOnlineAsync(PolaFixture.Contact());
        var bundle = PolaFixture.Bundle();
        bundle["contact"]!["logo_url"] = NewLogoUrl;
        ((Newtonsoft.Json.Linq.JObject)bundle["assets"]!).Remove("logo");
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), bundle);

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        CachedLogo().Should().Equal(PolaFixture.Logo, "le SaaS a prévenu l'admin que le logo n'a pas pu être embarqué");
    }

    // ── Écran d'accueil créé par le client (LAB-291) ──────────────────────────

    private const string NewHomeDesignPngUrl = "https://cdn.example/designs/ev/home/20261116_100000.png";
    private static readonly byte[] NewHomeDesignPng = [0x89, 0x50, 0x4E, 0x47, 4, 4];

    /// <summary>
    /// Synchro en ligne avec la réponse donnée de kiosk_get_approved_design (null : pas de design
    /// approuvé), une RPC sans réponse, ou un téléchargement de l'écran d'accueil en échec.
    /// </summary>
    private async Task SyncDesignOnlineAsync(Newtonsoft.Json.Linq.JObject? designResponse,
        bool rpcFails = false, bool homeDownloadFails = false)
    {
        _kiosk.Supabase.Setup(s => s.GetEventByCodeAsync(Code, It.IsAny<CancellationToken>()))
              .ReturnsAsync(SupabaseRpcResponses.ParseEventRpcResponse(PolaFixture.Event().ToString()));
        var design = _kiosk.Supabase.Setup(s => s.GetApprovedDesignAsync(EventId, It.IsAny<CancellationToken>()));
        if (rpcFails) design.ThrowsAsync(new HttpRequestException("Hôte inaccessible"));
        else design.ReturnsAsync(designResponse == null ? null : ApprovedDesignReader.ParseApprovedDesign(designResponse));
        _kiosk.Supabase.Setup(s => s.DownloadAssetAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .Returns((string url, string path, CancellationToken _) =>
              {
                  if (homeDownloadFails && url.Contains("/home/"))
                      return Task.FromException(new HttpRequestException("Hôte inaccessible"));
                  Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                  return File.WriteAllBytesAsync(path, url switch
                  {
                      PolaFixture.HomeDesignPngUrl => PolaFixture.HomeDesignPng,
                      NewHomeDesignPngUrl          => NewHomeDesignPng,
                      PolaFixture.DesignPngUrl     => PolaFixture.DesignPng,
                      PolaFixture.StripFramePngUrl     => PolaFixture.StripFramePng,
                      PolaFixture.LandscapeFramePngUrl => PolaFixture.LandscapeFramePng,
                      _                            => PolaFixture.HomeBackground,
                  });
              });

        (await NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken)).Should().NotBeNull();
    }

    private static Newtonsoft.Json.Linq.JObject DesignWithHome(string pngUrl)
    {
        var design = PolaFixture.DesignWithHome();
        design["home_design"]!["final_png_url"] = pngUrl;
        return design;
    }

    private byte[]? CachedHomeDesign() => NewService().GetHomeDesignPath() is { } path ? File.ReadAllBytes(path) : null;

    private string[] HomeDesignFiles()
    {
        var dir = Path.Combine(_kiosk.Dir.Path, "home-designs");
        return Directory.Exists(dir) ? Directory.GetFiles(dir) : [];
    }

    [Fact]
    public async Task A_validated_home_design_is_downloaded_once_and_kept_for_offline_use()
    {
        NewService().GetHomeDesignPath().Should().BeNull("aucun écran avant la première synchro");

        await SyncDesignOnlineAsync(PolaFixture.DesignWithHome());
        await SyncDesignOnlineAsync(PolaFixture.DesignWithHome());

        CachedHomeDesign().Should().Equal(PolaFixture.HomeDesignPng);
        DownloadsOf(PolaFixture.HomeDesignPngUrl).Should().Be(1, "l'écran en cache sert aux synchros suivantes");
        Path.GetFileName(HomeDesignFiles().Should().ContainSingle().Subject)
            .Should().MatchRegex($"^{PolaFixture.HomeDesignId:N}_[0-9A-F]{{12}}\\.png$");
        SingleTemplate().Id.Should().Be(PolaFixture.DesignId, "le modèle photo reste celui de la RPC");
    }

    [Fact]
    public async Task A_revalidated_home_design_replaces_the_cached_one()
    {
        await SyncDesignOnlineAsync(PolaFixture.DesignWithHome());

        await SyncDesignOnlineAsync(DesignWithHome(NewHomeDesignPngUrl));

        CachedHomeDesign().Should().Equal(NewHomeDesignPng);
        HomeDesignFiles().Should().ContainSingle("l'ancien écran est supprimé");
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Without_home_design_in_the_answer_the_cached_one_is_removed(bool hasPrintDesign)
    {
        await SyncDesignOnlineAsync(PolaFixture.DesignWithHome());

        // Option coupée ou écran refusé (home_design null), ou plus de modèle photo (réponse null).
        await SyncDesignOnlineAsync(hasPrintDesign ? PolaFixture.Design() : null);

        NewService().GetHomeDesignPath().Should().BeNull();
        HomeDesignFiles().Should().BeEmpty();
    }

    [Fact]
    public async Task The_cached_home_design_stays_when_the_sync_fails()
    {
        await SyncDesignOnlineAsync(PolaFixture.DesignWithHome());

        await SyncDesignOnlineAsync(null, rpcFails: true);
        CachedHomeDesign().Should().Equal(PolaFixture.HomeDesignPng, "RPC sans réponse : rien ne change");

        await SyncDesignOnlineAsync(DesignWithHome(NewHomeDesignPngUrl), homeDownloadFails: true);
        CachedHomeDesign().Should().Equal(PolaFixture.HomeDesignPng, "téléchargement en échec : l'ancien écran reste affiché");
    }

    [Fact]
    public async Task A_pola_file_with_the_home_design_gives_the_same_kiosk_as_the_online_sync()
    {
        using var online = new TestKiosk();
        online.Supabase.Setup(s => s.GetEventByCodeAsync(Code, It.IsAny<CancellationToken>()))
              .ReturnsAsync(SupabaseRpcResponses.ParseEventRpcResponse(PolaFixture.Event().ToString()));
        online.Supabase.Setup(s => s.GetApprovedDesignAsync(EventId, It.IsAny<CancellationToken>()))
              .ReturnsAsync(ApprovedDesignReader.ParseApprovedDesign(PolaFixture.DesignWithHome()));
        online.Supabase.Setup(s => s.GetOrgContactByEventAsync(EventId, It.IsAny<CancellationToken>()))
              .ReturnsAsync(PolaFixture.Contact());
        online.Supabase.Setup(s => s.DownloadAssetAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .Returns((string url, string path, CancellationToken _) =>
              {
                  Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                  return File.WriteAllBytesAsync(path, url switch
                  {
                      PolaFixture.BackgroundUrl    => PolaFixture.HomeBackground,
                      PolaFixture.DesignPngUrl     => PolaFixture.DesignPng,
                      PolaFixture.LogoUrl          => PolaFixture.Logo,
                      PolaFixture.HomeDesignPngUrl => PolaFixture.HomeDesignPng,
                      _ => throw new InvalidOperationException($"Téléchargement inattendu : {url}"),
                  });
              });
        await online.NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken);
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), PolaFixture.BundleWithHome());

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        _kiosk.DataFiles().Should().BeEquivalentTo(online.DataFiles());
        CachedHomeDesign().Should().Equal(PolaFixture.HomeDesignPng, "hors ligne, la borne affiche l'écran du fichier");
    }

    [Fact]
    public async Task A_pola_file_without_home_design_removes_the_cached_one()
    {
        await SyncDesignOnlineAsync(PolaFixture.DesignWithHome());

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        NewService().GetHomeDesignPath().Should().BeNull("un .pola sans écran garde l'accueil habituel");
        HomeDesignFiles().Should().BeEmpty();
    }

    // Le SaaS n'a pas pu embarquer le PNG : l'écran en cache est gardé s'il a le même id (docs/format-pola.md).
    [Theory]
    [InlineData(null, PolaFixture.HomeDesignPngUrl, true)]
    [InlineData(null, NewHomeDesignPngUrl, true)]                              // même écran, revalidé ailleurs
    [InlineData("2c3d4e5f-4444-4555-8666-c77788889999", PolaFixture.HomeDesignPngUrl, false)] // autre écran
    public async Task A_pola_file_describing_the_home_design_without_its_png_keeps_only_the_same_screen(
        string? otherId, string pngUrl, bool kept)
    {
        await SyncDesignOnlineAsync(PolaFixture.DesignWithHome());
        var bundle = PolaFixture.BundleWithHome();
        if (otherId != null) bundle["home_design"]!["id"] = otherId;
        bundle["home_design"]!["final_png_url"] = pngUrl;
        ((Newtonsoft.Json.Linq.JObject)bundle["assets"]!).Remove("home_design");
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), bundle);

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        if (kept) CachedHomeDesign().Should().Equal(PolaFixture.HomeDesignPng);
        else HomeDesignFiles().Should().BeEmpty("l'écran en cache n'est pas celui validé : accueil habituel");
    }

    [Fact]
    public void PolaBundle_reads_the_home_design_and_its_png()
    {
        var bundle = PolaBundle.Parse(PolaFixture.BundleWithHome().ToString());

        bundle.Design.HomeDesign.Should().Be(new HomeDesignDto(PolaFixture.HomeDesignId, PolaFixture.HomeDesignPngUrl));
        bundle.HomeDesignPng.Should().Equal(PolaFixture.HomeDesignPng);
        bundle.Design.Id.Should().Be(PolaFixture.DesignId, "le modèle photo reste celui du bloc design");
    }

    [Fact]
    public void PolaBundle_without_home_design_or_with_an_unreadable_one_has_none()
    {
        var without = PolaBundle.Parse(PolaFixture.Bundle().ToString());
        without.Design.HomeDesign.Should().BeNull();
        without.HomeDesignPng.Should().BeNull();

        var broken = PolaFixture.BundleWithHome();
        broken["home_design"]!["final_png_url"] = null;
        var parsed = PolaBundle.Parse(broken.ToString());
        parsed.Design.HomeDesign.Should().BeNull();
        parsed.HomeDesignPng.Should().BeNull("un PNG sans écran décrit n'est pas gardé");
    }

    // ── Choix du cadre (LAB-315) ──────────────────────────────────────────────

    private List<TemplateEntity> Frames()
    {
        using var ctx = _kiosk.Db.NewContext();
        return ctx.Templates.Where(t => t.EventId == EventId).ToList().OrderBy(t => t.SortOrder).ToList();
    }

    private string[] FramePngFiles() => Directory.GetFiles(Path.Combine(_kiosk.Dir.Path, "templates"));

    private void AssertTheThreeFrames()
    {
        var frames = Frames();
        frames.Select(f => f.Id).Should().Equal(PolaFixture.DesignId, PolaFixture.StripFrameId, PolaFixture.LandscapeFrameId);
        frames.Select(f => f.SortOrder).Should().Equal(0, 1, 2);
        frames.Select(f => f.Name).Should().Equal(PolaFixture.DesignLabel, PolaFixture.StripFrameLabel, "Cadre 3");
        frames.Select(f => f.Format).Should().Equal("stripV", "stripV", "landscape");
        frames.Select(f => File.ReadAllBytes(f.ThumbnailPath!))
            .Should().BeEquivalentTo([PolaFixture.DesignPng, PolaFixture.StripFramePng, PolaFixture.LandscapeFramePng],
                o => o.WithStrictOrdering());
        FramePngFiles().Should().HaveCount(3);
    }

    private void AssertOnlyTheMainDesign()
    {
        SingleTemplate().Id.Should().Be(PolaFixture.DesignId);
        Path.GetFileName(FramePngFiles().Should().ContainSingle("les PNG des cadres retirés sont supprimés").Subject)
            .Should().StartWith($"{PolaFixture.DesignId:N}_");
    }

    [Fact]
    public async Task The_online_sync_keeps_the_frames_received_in_their_order()
    {
        await SyncDesignOnlineAsync(PolaFixture.DesignWithFrames());

        AssertTheThreeFrames();
    }

    [Fact]
    public async Task A_frame_no_longer_received_loses_its_row_and_its_png()
    {
        await SyncDesignOnlineAsync(PolaFixture.DesignWithFrames());
        var withoutLandscape = PolaFixture.DesignWithFrames();
        ((Newtonsoft.Json.Linq.JArray)withoutLandscape["frames"]!).RemoveAt(1);

        await SyncDesignOnlineAsync(withoutLandscape);
        Frames().Select(f => f.Id).Should().Equal(PolaFixture.DesignId, PolaFixture.StripFrameId);
        FramePngFiles().Should().HaveCount(2);

        // Choix coupé dans l'admin : la RPC ne renvoie plus de frames.
        await SyncDesignOnlineAsync(PolaFixture.Design());
        AssertOnlyTheMainDesign();
    }

    [Fact]
    public async Task A_frame_whose_png_cannot_be_downloaded_keeps_its_row_and_is_logged()
    {
        _kiosk.Supabase.Setup(s => s.DownloadAssetAsync(PolaFixture.LandscapeFramePngUrl, It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .ThrowsAsync(new HttpRequestException("Hôte inaccessible"));
        await SyncDesignOnlineAsync(PolaFixture.DesignWithFrames());

        // SyncDesignOnlineAsync remplace le téléchargement : on refait l'échec pour ce cadre seulement.
        _kiosk.Supabase.Setup(s => s.DownloadAssetAsync(PolaFixture.LandscapeFramePngUrl, It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .ThrowsAsync(new HttpRequestException("Hôte inaccessible"));
        foreach (var file in Directory.GetFiles(Path.Combine(_kiosk.Dir.Path, "templates"), $"{PolaFixture.LandscapeFrameId:N}_*"))
            File.Delete(file);
        (await NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken)).Should().NotBeNull();

        Frames().Should().HaveCount(3, "l'accueil écarte le cadre sans PNG lisible");
        File.Exists(Frames()[2].ThumbnailPath).Should().BeFalse();
        _kiosk.Log.Verify(l => l.LogWarningAsync("sync-design",
            It.Is<string>(m => m.Contains(PolaFixture.LandscapeFrameId.ToString()))), Times.Once);
    }

    [Fact]
    public async Task A_pola_file_with_frames_gives_the_same_frames_as_the_online_sync()
    {
        PolaFixture.Write(_kiosk.PolaPath("mariage.pola"), PolaFixture.BundleWithFrames());

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        AssertTheThreeFrames();
    }

    [Fact]
    public async Task A_pola_file_without_frames_leaves_only_the_main_design()
    {
        await SyncDesignOnlineAsync(PolaFixture.DesignWithFrames());

        await NewService().ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        AssertOnlyTheMainDesign();
    }

    [Fact]
    public void PolaBundle_reads_the_frames_and_their_png()
    {
        var bundle = PolaBundle.Parse(PolaFixture.BundleWithFrames().ToString());

        bundle.Design.Name.Should().Be(PolaFixture.DesignLabel);
        bundle.Design.Frames.Select(f => f.Id).Should().Equal(PolaFixture.StripFrameId, PolaFixture.LandscapeFrameId);
        bundle.FramePngs.Should().NotBeNull();
        bundle.FramePngs![PolaFixture.StripFrameId].Should().Equal(PolaFixture.StripFramePng);
        bundle.FramePngs[PolaFixture.LandscapeFrameId].Should().Equal(PolaFixture.LandscapeFramePng);
    }

    [Theory]
    [InlineData(null)]          // PNG absent du fichier
    [InlineData("")]            // PNG vide
    [InlineData("pas du base64 !")]
    public void PolaBundle_drops_a_frame_without_a_readable_png(string? asset)
    {
        var file = PolaFixture.BundleWithFrames();
        var assets = (Newtonsoft.Json.Linq.JObject)file["assets"]!;
        if (asset == null) assets.Remove($"frame/{PolaFixture.LandscapeFrameId}");
        else assets[$"frame/{PolaFixture.LandscapeFrameId}"] = asset;

        var bundle = PolaBundle.Parse(file.ToString());

        bundle.Design.Frames.Select(f => f.Id).Should().Equal(PolaFixture.StripFrameId);
        bundle.FramePngs!.Keys.Should().Equal(PolaFixture.StripFrameId);
        bundle.Design.Id.Should().Be(PolaFixture.DesignId, "le design principal reste");
    }

    [Fact]
    public void PolaBundle_without_frames_has_only_the_main_design()
    {
        var bundle = PolaBundle.Parse(PolaFixture.Bundle().ToString());

        bundle.Design.Frames.Should().BeEmpty();
        bundle.FramePngs.Should().BeEmpty();
    }

    // ── Historique des .pola importés (LAB-321) ───────────────────────────────

    [Fact]
    public async Task ImportPolaFileAsync_keeps_a_copy_in_the_admin_history()
    {
        using var usb = new TempDir();
        var source = usb.File("mariage_julie_TUQNA5.pola");
        PolaFixture.Write(source, PolaFixture.Bundle());

        await NewService().ImportPolaFileAsync(source);

        var entry = _kiosk.History.List().Should().ContainSingle().Subject;
        entry.EventId.Should().Be(EventId);
        entry.DesignId.Should().Be(PolaFixture.DesignId);
        entry.EventName.Should().Be("Mariage Julie & Thomas");
        entry.StartDate.Should().Be(DateTimeOffset.Parse(PolaFixture.StartDate));
        entry.EndDate.Should().Be(DateTimeOffset.Parse(PolaFixture.EndDate));
        entry.FileName.Should().EndWith($"_Mariage_Julie_Thomas_{EventId.ToString("N")[..8]}.pola");
        File.ReadAllBytes(_kiosk.History.PathOf(entry)).Should().Equal(File.ReadAllBytes(source));
    }

    [Fact]
    public async Task The_same_file_imported_twice_is_one_history_entry()
    {
        var service = NewService();
        await service.ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));
        await service.ImportPolaFileAsync(_kiosk.PolaPath("mariage.pola"));

        _kiosk.History.List().Should().ContainSingle();
    }

    [Fact]
    public async Task A_refused_file_is_not_added_to_the_history()
    {
        PolaFixture.Write(_kiosk.PolaPath("ancien.pola"), PolaFixture.OldBundle());

        var act = () => NewService().ImportPolaFileAsync(_kiosk.PolaPath("ancien.pola"));

        await act.Should().ThrowAsync<InvalidDataException>();
        _kiosk.History.List().Should().BeEmpty();
    }

    [Fact]
    public async Task The_offline_code_fallback_does_not_add_to_the_history()
    {
        SetupEventByCode(new HttpRequestException("Hôte inaccessible"));

        (await NewService().SyncByCodeAsync(Code, TestContext.Current.CancellationToken)).Should().NotBeNull();

        _kiosk.History.List().Should().BeEmpty();
    }
}
