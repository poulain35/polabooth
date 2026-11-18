using System.Windows.Media;
using System.Windows.Media.Imaging;
using FluentAssertions;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Accueil de la borne (LAB-251) : écran choisi, textes, dernière photo et démarrage.</summary>
// Même collection : HomeViewModel garde ses avertissements dans des champs statiques.
[Collection("HomeViewModelStatics")]
public class HomeViewModelTests : IDisposable
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private const string EventName = "Mariage Camille et Thomas";

    private readonly TempDir _dir = new();
    private readonly Mock<INavigationService> _nav = new();
    private readonly Mock<ISyncService> _sync = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly SessionPathService _paths;
    private EventEntity _event = new() { Id = EventId, Name = EventName };

    public HomeViewModelTests()
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dir.Path;
        _paths = new SessionPathService(settings);
        _sync.Setup(s => s.GetCurrentEventAsync(EventId)).ReturnsAsync(() => _event);
        _sync.Setup(s => s.GetTemplatesAsync(EventId)).ReturnsAsync(new List<TemplateEntity>());
        HomeViewModel.ResetCustomDesignWarning();
    }

    public void Dispose() => _dir.Dispose();

    private async Task<HomeViewModel> OpenHomeAsync(JObject? home = null, JObject? rgpd = null,
        DateTimeOffset? start = null, DateTimeOffset? end = null, string? company = null, string? instanceName = null)
    {
        var kiosk = new JObject { ["home"] = home ?? new JObject() };
        if (rgpd != null) kiosk["rgpd"] = rgpd;
        _event = new EventEntity
        {
            Id = EventId, Name = EventName, StartDate = start, EndDate = end,
            FormConfigJson = new JObject { ["kiosk"] = kiosk }.ToString(),
        };

        var state = new Mock<IKioskStateService>();
        state.SetupGet(s => s.ActiveEventId).Returns(EventId);
        state.SetupGet(s => s.ContactCompany).Returns(company);
        var vm = new HomeViewModel(_nav.Object, state.Object, _sync.Object, Mock.Of<IIdleTimeoutService>(),
            _paths, Mock.Of<ICompositeService>(), new AdminPinPadViewModel(Mock.Of<IAdminPinService>(), _nav.Object, new PinAttemptLimiter()),
            new AppSettings { Contact = { CompanyName = instanceName ?? "" } }, log: _log.Object);
        await vm.InitializeAsync();
        return vm;
    }

    [Fact]
    public async Task Without_personalization_the_neutral_home_shows()
    {
        var vm = await OpenHomeAsync(new JObject { ["personalized"] = false, ["display_name"] = "Camille & Thomas" });

        vm.Layout.Should().Be(HomeLayout.Neutral);
        vm.IsWholeScreenTappable.Should().BeTrue();
        vm.PrintFooterName.Should().Be("Photobooth");
    }

    [Fact]
    public async Task The_personalized_home_shows_the_name_and_the_dates()
    {
        var vm = await OpenHomeAsync(new JObject { ["personalized"] = true, ["display_name"] = "Anne-Sophie & Jean-Baptiste" },
            start: DateTimeOffset.Parse("2026-06-14T14:00:00Z"), end: DateTimeOffset.Parse("2026-06-15T02:00:00Z"));

        vm.Layout.Should().Be(HomeLayout.Personalized);
        vm.DisplayName.Should().Be("Anne-Sophie & Jean-Baptiste");
        vm.DateText.Should().Be("Du 14 au 15 juin 2026");
        vm.ShortDate.Should().Be("14 · 06 · 2026");
        vm.PrintFooterName.Should().Be("Anne-Sophie & Jean-Baptiste");
    }

    [Fact]
    public async Task Without_date_or_display_name_the_event_name_shows_alone()
    {
        var vm = await OpenHomeAsync(new JObject { ["personalized"] = true });

        vm.DisplayName.Should().Be(EventName);
        vm.HasDate.Should().BeFalse();
        vm.HasShortDate.Should().BeFalse();
    }

    [Fact]
    public async Task An_unreadable_config_falls_back_to_the_neutral_home()
    {
        _event = new EventEntity { Id = EventId, Name = EventName, FormConfigJson = "{pas du json" };
        var state = new Mock<IKioskStateService>();
        state.SetupGet(s => s.ActiveEventId).Returns(EventId);
        var vm = new HomeViewModel(_nav.Object, state.Object, _sync.Object, Mock.Of<IIdleTimeoutService>(),
            _paths, Mock.Of<ICompositeService>(), new AdminPinPadViewModel(Mock.Of<IAdminPinService>(), _nav.Object, new PinAttemptLimiter()));

        await vm.InitializeAsync();
        vm.StartCommand.Execute(null);

        vm.Layout.Should().Be(HomeLayout.Neutral);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
    }

    [Fact]
    public async Task The_last_photo_is_the_newest_composite_and_follows_each_session()
    {
        var empty = await OpenHomeAsync();
        empty.HasPhotos.Should().BeFalse();
        empty.OpenGalleryCommand.Execute(null);
        _nav.Verify(n => n.NavigateTo<GalleryView>(), Times.Never, "pas de galerie sans photo");

        WriteComposite("20261105_200000.png", 120, 180, DateTime.UtcNow.AddMinutes(-5));
        (await OpenHomeAsync()).LastPhoto!.PixelWidth.Should().Be(120);

        // Nouvelle séance : l'accueil suivant montre ce nouveau montage.
        WriteComposite("20261105_201000.png", 90, 180, DateTime.UtcNow);
        var vm = await OpenHomeAsync();
        vm.HasPhotos.Should().BeTrue();
        vm.LastPhoto!.PixelWidth.Should().Be(90);

        vm.OpenGalleryCommand.Execute(null);
        _nav.Verify(n => n.NavigateTo<GalleryView>(), Times.Once);
    }

    [Fact]
    public async Task A_tap_starts_with_the_photo_consent_when_it_is_on()
    {
        var vm = await OpenHomeAsync(rgpd: new JObject { ["enabled"] = true, ["message"] = "J'accepte" });

        vm.StartCommand.Execute(null);

        _nav.Verify(n => n.NavigateTo<RgpdView>(It.Is<object>(p => ((RgpdParameters)p).Message == "J'accepte")), Times.Once);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Never);
    }

    [Fact]
    public async Task With_format_tiles_only_a_tile_starts()
    {
        var vm = await OpenHomeAsync(new JObject { ["personalized"] = true });
        vm.Layout = HomeLayout.FormatChoice; // 1c : la borne ne gère encore qu'un format

        vm.StartCommand.Execute(null);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Never, "en 1c, un appui hors des tuiles ne démarre pas");

        vm.StartFormatCommand.Execute(vm.Tiles[0]);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
    }

    [Fact]
    public async Task Without_an_event_background_the_home_stays_cream()
    {
        var vm = await OpenHomeAsync();

        vm.HasBackgroundImage.Should().BeFalse();
    }

    [Fact]
    public async Task The_event_background_is_shown_full_screen()
    {
        const string url = "https://exemple.test/fond.png";
        var path = Path.Combine(_dir.Path, "home_background.png");
        WriteImage(path, 32, 20);
        _sync.Setup(s => s.GetHomeBackgroundPath(EventId, url)).Returns(path);

        var vm = await OpenHomeAsync(new JObject { ["background_url"] = url });

        vm.HasBackgroundImage.Should().BeTrue();
    }

    // ── Logo de la société (LAB-257) ──────────────────────────────────────────

    [Theory]
    [InlineData("Studio Lumière", "Studio Lumière")]
    [InlineData(null, "Photobooth")]
    public async Task Without_logo_the_icon_and_the_company_name_show(string? company, string expected)
    {
        var vm = await OpenHomeAsync(company: company);

        vm.HasLogo.Should().BeFalse();
        vm.LogoImage.Should().BeNull();
        vm.BrandName.Should().Be(expected);
    }

    [Fact]
    public async Task Without_company_the_instance_name_shows_on_the_home_and_the_print()
    {
        var vm = await OpenHomeAsync(new JObject { ["personalized"] = false }, instanceName: "Studio Lumière");

        vm.BrandName.Should().Be("Studio Lumière");
        vm.PrintFooterName.Should().Be("Studio Lumière");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task The_cached_logo_replaces_the_icon_and_the_name_on_every_home(bool personalized)
    {
        var path = Path.Combine(_dir.Path, "logo.img");
        WriteImage(path, 400, 100);
        _sync.Setup(s => s.GetOrgLogoPath()).Returns(path);

        var vm = await OpenHomeAsync(new JObject { ["personalized"] = personalized }, company: "Studio Lumière");

        vm.HasLogo.Should().BeTrue();
        vm.LogoImage!.PixelWidth.Should().BeLessThanOrEqualTo((int)(HomeViewModel.LogoMaxWidth * 2), "décodé à la taille du cadre");

        vm.Release();
        vm.HasLogo.Should().BeFalse();
        vm.LogoImage.Should().BeNull();
    }

    [Fact]
    public async Task An_unreadable_logo_falls_back_to_the_company_name()
    {
        var path = Path.Combine(_dir.Path, "logo.img");
        File.WriteAllText(path, "pas une image");
        _sync.Setup(s => s.GetOrgLogoPath()).Returns(path);

        var vm = await OpenHomeAsync(company: "Studio Lumière");

        vm.HasLogo.Should().BeFalse();
        vm.BrandName.Should().Be("Studio Lumière");
    }

    // ── Écran d'accueil créé par le client (LAB-291) ──────────────────────────

    private static JObject ClientHome(bool personalized = true, bool clientDesign = true)
        => new() { ["personalized"] = personalized, ["client_design"] = clientDesign, ["display_name"] = "Camille & Thomas" };

    private string CacheHomeDesign()
    {
        var path = Path.Combine(_dir.Path, "home-designs", "home.png");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        WriteImage(path, 192, 108);
        _sync.Setup(s => s.GetHomeDesignPath()).Returns(path);
        return path;
    }

    private void VerifyHomeWarnings(Times times)
        => _log.Verify(l => l.LogWarningAsync("home", It.IsAny<string>()), times);

    [Fact]
    public async Task The_validated_client_screen_replaces_the_home()
    {
        CacheHomeDesign();

        var vm = await OpenHomeAsync(ClientHome());

        vm.Layout.Should().Be(HomeLayout.CustomDesign);
        vm.IsCustomDesign.Should().BeTrue();
        vm.IsPersonalized.Should().BeFalse("le nom et la date de 1b ne s'affichent pas");
        vm.CustomDesignImage.Should().NotBeNull();
        vm.ShowCustomStartPill.Should().BeTrue("un seul format : pastille, tout l'écran démarre");
        vm.ShowCustomTiles.Should().BeFalse();
        vm.IsWholeScreenTappable.Should().BeTrue();
        VerifyHomeWarnings(Times.Never());

        vm.StartCommand.Execute(null);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
    }

    [Theory]
    [InlineData(true, false)]   // option coupée dans le SaaS : 1b
    [InlineData(false, true)]   // personnalisation coupée : 1a
    public async Task Without_the_option_or_personalization_the_client_screen_is_not_shown(bool personalized, bool clientDesign)
    {
        CacheHomeDesign();

        var vm = await OpenHomeAsync(ClientHome(personalized, clientDesign));

        vm.IsCustomDesign.Should().BeFalse();
        vm.CustomDesignImage.Should().BeNull("le PNG n'est même pas décodé");
        vm.Layout.Should().Be(personalized ? HomeLayout.Personalized : HomeLayout.Neutral);
        VerifyHomeWarnings(Times.Never());
    }

    [Theory]
    [InlineData(false)]   // absent du cache (synchro pas encore faite, ou .pola sans écran)
    [InlineData(true)]    // fichier abîmé
    public async Task A_missing_or_unreadable_client_screen_falls_back_to_the_usual_home_and_warns_once(bool fileExists)
    {
        if (fileExists)
        {
            var path = Path.Combine(_dir.Path, "home-designs", "home.png");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, "pas une image");
            _sync.Setup(s => s.GetHomeDesignPath()).Returns(path);
        }

        var vm = await OpenHomeAsync(ClientHome());
        await OpenHomeAsync(ClientHome()); // retour à l'accueil après une séance

        vm.Layout.Should().Be(HomeLayout.Personalized);
        vm.CustomDesignImage.Should().BeNull();
        VerifyHomeWarnings(Times.Once());
    }

    [Fact]
    public async Task With_several_formats_only_the_tiles_start_on_the_client_screen()
    {
        CacheHomeDesign();
        var vm = await OpenHomeAsync(ClientHome());
        // La borne ne sait faire que la photo : deux tuiles posées à la main.
        vm.Tiles = [vm.Tiles[0], new HomeFormatTile(CaptureFormat.Gif, "GIF", "Animé, à partager", IsPrimary: false)];

        vm.IsCustomDesign.Should().BeTrue();
        vm.ShowCustomTiles.Should().BeTrue();
        vm.ShowCustomStartPill.Should().BeFalse();
        vm.IsWholeScreenTappable.Should().BeFalse();

        vm.StartCommand.Execute(null);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Never, "un appui hors des tuiles ne démarre pas");

        vm.StartFormatCommand.Execute(vm.Tiles[0]);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
    }

    [Fact]
    public async Task The_photos_button_shows_only_when_photos_exist_and_opens_the_gallery()
    {
        CacheHomeDesign();
        var empty = await OpenHomeAsync(ClientHome());
        empty.ShowPhotosButton.Should().BeFalse();

        WriteComposite("20261105_200000.png", 120, 180, DateTime.UtcNow);
        var vm = await OpenHomeAsync(ClientHome());

        vm.HasPhotos.Should().BeTrue();
        vm.ShowPhotosButton.Should().BeTrue();
        vm.OpenGalleryCommand.Execute(null);
        _nav.Verify(n => n.NavigateTo<GalleryView>(), Times.Once);
    }

    [Fact]
    public async Task Leaving_the_client_screen_frees_its_image()
    {
        CacheHomeDesign();
        var vm = await OpenHomeAsync(ClientHome());

        vm.Release();

        vm.CustomDesignImage.Should().BeNull();
    }

    [Fact]
    public async Task Without_camera_the_client_screen_still_blocks_the_session()
    {
        CacheHomeDesign();
        _event = new EventEntity
        {
            Id = EventId, Name = EventName,
            FormConfigJson = new JObject { ["kiosk"] = new JObject { ["home"] = ClientHome() } }.ToString(),
        };

        var vm = await OpenHomeWithCameraAsync(new HealthStub { Status = CameraHealth.Absent }, eventId: EventId);

        vm.IsCustomDesign.Should().BeTrue();
        vm.IsCameraMissing.Should().BeTrue();
        vm.StartCommand.CanExecute(null).Should().BeFalse();
        vm.StartCommand.Execute(null);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Never);
    }

    // ── Accueil composé par l'admin pour l'organisation (LAB-297) ────────────

    // Plan en cache, avec ses images, comme l'écrit la synchro (un dossier par test).
    private CachedScreen CacheOrgHome(bool transparent = false, bool brokenBackground = false)
    {
        var dir = Path.Combine(_dir.Path, "screens", "home-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(dir);
        if (brokenBackground) File.WriteAllText(Path.Combine(dir, "bg.png"), "pas une image");
        else WriteImage(Path.Combine(dir, "bg.png"), 192, 108);
        WriteImage(Path.Combine(dir, "start.png"), 60, 16);
        WriteImage(Path.Combine(dir, "gallery.png"), 30, 10);
        var plan = new JObject
        {
            ["version"] = 4, ["kind"] = "home", ["size"] = new JObject { ["w"] = 1920, ["h"] = 1080 },
            ["background"] = transparent ? null : "bg.png", ["transparent_background"] = transparent,
            ["buttons"] = new JArray(
                new JObject { ["action"] = "start", ["x"] = 660, ["y"] = 820, ["w"] = 600, ["h"] = 160, ["image"] = "start.png" },
                new JObject { ["action"] = "gallery", ["x"] = 1560, ["y"] = 900, ["w"] = 300, ["h"] = 100, ["image"] = "gallery.png" }),
            ["texts"] = new JArray(new JObject
            {
                ["variable"] = "event_name", ["x"] = 100, ["y"] = 100, ["w"] = 800, ["h"] = 120, ["angle"] = 0,
                ["font"] = "Fraunces", ["weight"] = 600, ["size"] = 80, ["color"] = "#1B241F", ["align"] = "left",
                ["uppercase"] = false, ["char_spacing"] = 0, ["max_lines"] = 2, ["personalized_only"] = true,
            }),
            ["slots"] = new JArray(new JObject { ["slot"] = "last_photo", ["x"] = 1100, ["y"] = 120, ["w"] = 500, ["h"] = 700, ["angle"] = -4, ["radius"] = 6 }),
        };
        var screen = new CachedScreen(ScreenLayout.Parse(plan)!, dir);
        _sync.Setup(s => s.GetScreen(ScreenLayout.KindHome)).Returns(screen);
        return screen;
    }

    private void VerifyScreenWarnings(Times times)
        => _log.Verify(l => l.LogWarningAsync("screens", It.IsAny<string>()), times);

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task The_org_screen_replaces_the_standard_home(bool personalized)
    {
        CacheOrgHome();

        var vm = await OpenHomeAsync(new JObject { ["personalized"] = personalized, ["display_name"] = "Camille & Thomas" });

        vm.Layout.Should().Be(HomeLayout.OrgDesign);
        vm.IsOrgDesign.Should().BeTrue();
        vm.ShowStandardHome.Should().BeFalse("ni 1a, ni 1b, ni 1c");
        vm.DesignedHome.Should().NotBeNull();
        vm.DesignedHome!.Layout.Version.Should().Be(4);
        vm.HomePersonalized.Should().Be(personalized, "fond neutre et textes « personnalisé seulement » masqués sinon");
        vm.HasBackgroundImage.Should().BeFalse("le fond de 1a / 1b / 1c et son voile restent cachés");
        vm.IsWholeScreenTappable.Should().BeTrue("D5 : un appui n'importe où démarre");
        vm.HomeTexts["event_name"].Should().Be("Camille & Thomas");
        VerifyScreenWarnings(Times.Never());

        vm.StartCommand.Execute(null);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
    }

    [Fact]
    public async Task Without_display_name_the_event_name_is_written()
    {
        CacheOrgHome();

        var vm = await OpenHomeAsync(new JObject { ["personalized"] = true },
            start: DateTimeOffset.Parse("2026-06-14T14:00:00Z"));

        vm.HomeTexts["event_name"].Should().Be(EventName);
        vm.HomeTexts["event_date"].Should().Be(vm.DateText);
    }

    [Fact]
    public async Task Without_photo_the_gallery_is_hidden_and_the_slot_starts_the_session()
    {
        CacheOrgHome();

        var vm = await OpenHomeAsync(new JObject { ["personalized"] = true });

        vm.HomeActionStates["start"].Should().Be(ScreenActionState.Active);
        vm.HomeActionStates["gallery"].Should().Be(ScreenActionState.Hidden);
        vm.HomeSlots["last_photo"].Should().BeNull("ni photo ni design : l'emplacement montre le fond");
        vm.ScreenActionCommand.CanExecute("gallery").Should().BeFalse();
        vm.ScreenActionCommand.CanExecute("last_photo").Should().BeFalse("l'appui remonte alors à l'écran et démarre");

        vm.ScreenActionCommand.Execute("start");
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
        _nav.Verify(n => n.NavigateTo<GalleryView>(), Times.Never);
    }

    [Theory]
    [InlineData("gallery")]
    [InlineData("last_photo")]
    public async Task With_photos_the_gallery_button_and_the_slot_open_the_gallery(string action)
    {
        CacheOrgHome();
        WriteComposite("20261105_200000.png", 120, 180, DateTime.UtcNow);

        var vm = await OpenHomeAsync(new JObject { ["personalized"] = true });

        vm.HomeActionStates["gallery"].Should().Be(ScreenActionState.Active);
        vm.HomeSlots["last_photo"].Should().BeSameAs(vm.LastPhoto);
        vm.ScreenActionCommand.CanExecute(action).Should().BeTrue();

        vm.ScreenActionCommand.Execute(action);
        _nav.Verify(n => n.NavigateTo<GalleryView>(), Times.Once);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Never);
    }

    [Fact]
    public async Task An_unknown_action_does_nothing()
    {
        CacheOrgHome();
        var vm = await OpenHomeAsync(new JObject { ["personalized"] = true });

        vm.ScreenActionCommand.CanExecute("print").Should().BeFalse();
        vm.ScreenActionCommand.Execute("print");

        _nav.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task The_client_screen_wins_over_the_org_screen()
    {
        CacheHomeDesign();
        CacheOrgHome();

        var vm = await OpenHomeAsync(ClientHome());

        vm.Layout.Should().Be(HomeLayout.CustomDesign);
        vm.DesignedHome.Should().BeNull("l'écran de l'organisation n'est même pas décodé");
    }

    [Fact]
    public async Task Without_org_screen_the_standard_home_shows_without_warning()
    {
        _sync.Setup(s => s.GetScreen(ScreenLayout.KindHome)).Returns((CachedScreen?)null);

        var vm = await OpenHomeAsync(new JObject { ["personalized"] = true });

        vm.Layout.Should().Be(HomeLayout.Personalized);
        vm.ShowStandardHome.Should().BeTrue();
        vm.DesignedHome.Should().BeNull();
        VerifyScreenWarnings(Times.Never());
    }

    [Fact]
    public async Task An_unreadable_org_screen_falls_back_to_the_standard_home_and_warns_once()
    {
        CacheOrgHome(brokenBackground: true);

        var vm = await OpenHomeAsync(new JObject { ["personalized"] = false });
        await OpenHomeAsync(new JObject { ["personalized"] = false }); // retour à l'accueil après une séance

        vm.Layout.Should().Be(HomeLayout.Neutral);
        vm.DesignedHome.Should().BeNull();
        VerifyScreenWarnings(Times.Once());
    }

    [Fact]
    public async Task A_transparent_org_screen_lays_the_event_background_underneath()
    {
        var url = "https://cdn.example/fond.jpg";
        var path = Path.Combine(_dir.Path, "backgrounds", "fond.img");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        WriteImage(path, 160, 90);
        _sync.Setup(s => s.GetHomeBackgroundPath(EventId, url)).Returns(path);
        CacheOrgHome(transparent: true);

        var vm = await OpenHomeAsync(new JObject { ["personalized"] = true, ["background_url"] = url });

        vm.IsOrgDesign.Should().BeTrue();
        vm.BackgroundImage.Should().NotBeNull("posé sous le plan, là où il est transparent (D8)");
        vm.HasBackgroundImage.Should().BeFalse("pas de fond ni de voile de l'accueil standard");
    }

    [Fact]
    public async Task Without_camera_the_org_screen_still_blocks_the_session()
    {
        CacheOrgHome();
        _event = new EventEntity
        {
            Id = EventId, Name = EventName,
            FormConfigJson = new JObject { ["kiosk"] = new JObject { ["home"] = new JObject { ["personalized"] = true } } }.ToString(),
        };

        var vm = await OpenHomeWithCameraAsync(new HealthStub { Status = CameraHealth.Absent }, eventId: EventId);

        vm.IsOrgDesign.Should().BeTrue();
        vm.IsCameraMissing.Should().BeTrue();
        vm.ScreenActionCommand.CanExecute("start").Should().BeFalse();
        vm.ScreenActionCommand.Execute("start");
        vm.StartCommand.Execute(null);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Never);
    }

    [Fact]
    public async Task Leaving_the_org_screen_frees_its_images()
    {
        CacheOrgHome();
        var vm = await OpenHomeAsync(new JObject { ["personalized"] = true });

        vm.Release();

        vm.DesignedHome.Should().BeNull();
    }

    private void WriteComposite(string name, int width, int height, DateTime createdUtc)
    {
        var dir = _paths.GetCompositesDirectory(EventName, EventId);
        Directory.CreateDirectory(dir);
        WriteImage(Path.Combine(dir, name), width, height);
        File.SetCreationTimeUtc(Path.Combine(dir, name), createdUtc);
    }

    private static void WriteImage(string path, int width, int height)
    {
        var stride = width * 4;
        var bitmap = BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgr32, null, new byte[stride * height], stride);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var file = File.Create(path);
        encoder.Save(file);
    }

    // ── LAB-263 : appareil photo débranché → « Problème technique » ─────────────

    private sealed class HealthStub : ICameraHealthService
    {
        public Queue<CameraHealth> Answers { get; } = new();
        public CameraHealth Status { get; set; } = CameraHealth.Unknown;
        public string? HeartbeatValue => null;
        public int Checks;

        public Task<CameraHealth> CheckNowAsync(CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref Checks);
            if (Answers.Count > 0) Status = Answers.Dequeue();
            return Task.FromResult(Status);
        }

        public void ReportAbsent() => Status = CameraHealth.Absent;
    }

    private readonly List<(TimeSpan Delay, CancellationToken Token, TaskCompletionSource Done)> _delays = [];

    private async Task<HomeViewModel> OpenHomeWithCameraAsync(ICameraHealthService health,
        string? company = "Studio Exemple", string? phone = "06 12 34 56 78", Guid? eventId = null)
    {
        var state = new Mock<IKioskStateService>();
        state.SetupGet(s => s.ActiveEventId).Returns(eventId);
        state.SetupGet(s => s.ContactCompany).Returns(company);
        state.SetupGet(s => s.ContactPhone).Returns(phone);
        var vm = new HomeViewModel(_nav.Object, state.Object, _sync.Object, Mock.Of<IIdleTimeoutService>(),
            _paths, Mock.Of<ICompositeService>(), new AdminPinPadViewModel(Mock.Of<IAdminPinService>(), _nav.Object, new PinAttemptLimiter()),
            cameraHealth: health);
        vm.Delay = (delay, token) =>
        {
            var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            token.Register(() => done.TrySetCanceled(token));
            lock (_delays) _delays.Add((delay, token, done));
            return done.Task;
        };
        await vm.InitializeAsync();
        return vm;
    }

    private static async Task WaitUntil(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("condition jamais remplie");
            await Task.Delay(10, TestContext.Current.CancellationToken);
        }
    }

    [Fact]
    public async Task Without_camera_the_home_shows_technical_problem_and_blocks_the_session()
    {
        var health = new HealthStub();
        health.Answers.Enqueue(CameraHealth.Absent);

        var vm = await OpenHomeWithCameraAsync(health, eventId: EventId);

        vm.IsCameraMissing.Should().BeTrue();
        vm.TechnicalProblemText.Should().Be("L'appareil photo n'est pas branché. La borne ne peut pas prendre de photo "
            + "pour le moment. Contactez Studio Exemple au 06 12 34 56 78.");
        vm.StartCommand.CanExecute(null).Should().BeFalse();
        vm.StartFormatCommand.CanExecute(null).Should().BeFalse();

        vm.StartCommand.Execute(null); // appui sur l'écran (gestionnaire de la vue)
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Never);
        _nav.Verify(n => n.NavigateTo<RgpdView>(It.IsAny<object>()), Times.Never);

        // L'accès admin reste possible.
        vm.PinPad.OpenAdminPinCommand.CanExecute(null).Should().BeTrue();
    }

    [Fact]
    public async Task Without_phone_the_guest_is_told_to_contact_the_rental_company()
    {
        var vm = await OpenHomeWithCameraAsync(new HealthStub { Status = CameraHealth.Absent }, phone: null);

        vm.TechnicalProblemText.Should().EndWith(" Contactez votre loueur.");
    }

    [Fact]
    public async Task The_camera_is_checked_every_30_seconds_and_the_normal_home_comes_back()
    {
        var health = new HealthStub();
        health.Answers.Enqueue(CameraHealth.Absent);
        health.Answers.Enqueue(CameraHealth.Present);

        var vm = await OpenHomeWithCameraAsync(health, eventId: EventId);
        vm.IsCameraMissing.Should().BeTrue();
        await WaitUntil(() => { lock (_delays) return _delays.Count == 1; });
        _delays[0].Delay.Should().Be(TimeSpan.FromSeconds(30));

        _delays[0].Done.SetResult(); // 30 s plus tard : l'appareil est rebranché

        await WaitUntil(() => !vm.IsCameraMissing);
        vm.StartCommand.CanExecute(null).Should().BeTrue();
        vm.StartCommand.Execute(null);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
    }

    [Fact]
    public async Task Leaving_the_home_stops_the_camera_checks()
    {
        var health = new HealthStub { Status = CameraHealth.Present };
        var vm = await OpenHomeWithCameraAsync(health);
        await WaitUntil(() => { lock (_delays) return _delays.Count == 1; });

        vm.Release();

        _delays[0].Token.IsCancellationRequested.Should().BeTrue();
        await Task.Delay(50, TestContext.Current.CancellationToken);
        health.Checks.Should().Be(1);
    }

    [Fact]
    public async Task Unknown_camera_state_does_not_block_guests()
    {
        var vm = await OpenHomeWithCameraAsync(new HealthStub { Status = CameraHealth.Unknown }, eventId: EventId);

        vm.IsCameraMissing.Should().BeFalse();
        vm.StartCommand.CanExecute(null).Should().BeTrue();
    }
}
