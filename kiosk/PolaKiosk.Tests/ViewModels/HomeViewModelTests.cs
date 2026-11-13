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
public class HomeViewModelTests : IDisposable
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private const string EventName = "Mariage Camille et Thomas";

    private readonly TempDir _dir = new();
    private readonly Mock<INavigationService> _nav = new();
    private readonly Mock<ISyncService> _sync = new();
    private readonly SessionPathService _paths;
    private EventEntity _event = new() { Id = EventId, Name = EventName };

    public HomeViewModelTests()
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dir.Path;
        _paths = new SessionPathService(settings);
        _sync.Setup(s => s.GetCurrentEventAsync(EventId)).ReturnsAsync(() => _event);
        _sync.Setup(s => s.GetTemplatesAsync(EventId)).ReturnsAsync(new List<TemplateEntity>());
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
            _paths, Mock.Of<ICompositeService>(), new AdminPinPadViewModel(Mock.Of<IAdminPinService>(), _nav.Object),
            new AppSettings { Contact = { CompanyName = instanceName ?? "" } });
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
            _paths, Mock.Of<ICompositeService>(), new AdminPinPadViewModel(Mock.Of<IAdminPinService>(), _nav.Object));

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
            _paths, Mock.Of<ICompositeService>(), new AdminPinPadViewModel(Mock.Of<IAdminPinService>(), _nav.Object),
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
