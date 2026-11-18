using System.Windows.Media;
using System.Windows.Media.Imaging;
using FluentAssertions;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Choix du cadre par l'invité (LAB-315) : règles, écran de choix, accueil et cadre retenu.</summary>
// Même collection : HomeViewModel garde ses avertissements dans des champs statiques.
[Collection("HomeViewModelStatics")]
public class FrameChoiceTests : IDisposable
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private static readonly Guid MainId  = Guid.Parse("a0000000-0000-4000-8000-000000000001");
    private static readonly Guid StripId = Guid.Parse("a0000000-0000-4000-8000-000000000002");
    private static readonly Guid ThirdId = Guid.Parse("a0000000-0000-4000-8000-000000000003");

    private readonly TempDir _dir = new();
    private readonly Mock<INavigationService> _nav = new();
    private readonly Mock<ISyncService> _sync = new();
    private readonly Mock<ICompositeService> _composite = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly FrameSelection _selection = new();
    private List<TemplateEntity> _templates = [];

    private sealed class FrameSelection : IFrameSelection
    {
        public Guid? SelectedTemplateId { get; set; }
        public void Clear() => SelectedTemplateId = null;
    }

    public FrameChoiceTests()
    {
        _sync.Setup(s => s.GetTemplatesAsync(EventId)).ReturnsAsync(() => _templates);
        _composite.Setup(c => c.GetPhotoZonesAsync(It.IsAny<Guid>(), It.IsAny<string>()))
            .ReturnsAsync((Guid id, string _) => id == StripId
                ? [new PhotoZone(0, 0, 10, 10), new PhotoZone(0, 20, 10, 10), new PhotoZone(0, 40, 10, 10)]
                : [new PhotoZone(0, 0, 10, 10)]);
        HomeViewModel.ResetCustomDesignWarning();
    }

    public void Dispose() => _dir.Dispose();

    // ── Règles ─────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(true, 2, true)]
    [InlineData(true, 4, true)]
    [InlineData(true, 1, false)]
    [InlineData(true, 0, false)]
    [InlineData(false, 3, false)]
    public void The_choice_is_asked_only_when_enabled_with_two_usable_frames(bool enabled, int usable, bool expected)
        => FrameChoice.ShouldAsk(new FrameChoiceConfig { Enabled = enabled }, usable).Should().Be(expected);

    [Fact]
    public void Without_config_the_choice_is_never_asked()
        => FrameChoice.ShouldAsk(null, 3).Should().BeFalse();

    [Fact]
    public void Frames_are_ordered_main_design_first()
    {
        var templates = new[] { Template(ThirdId, 2), Template(StripId, 1), Template(MainId, 0) };

        FrameChoice.Ordered(templates).Select(t => t.Id).Should().Equal(MainId, StripId, ThirdId);
    }

    [Fact]
    public void The_chosen_frame_is_picked_otherwise_the_first_one()
    {
        var templates = new[] { Template(StripId, 1), Template(MainId, 0) };

        FrameChoice.Pick(templates, StripId)!.Id.Should().Be(StripId);
        FrameChoice.Pick(templates, null)!.Id.Should().Be(MainId);
        FrameChoice.Pick(templates, Guid.NewGuid())!.Id.Should().Be(MainId, "cadre retiré entre-temps");
        FrameChoice.Pick([], StripId).Should().BeNull();
    }

    [Theory]
    [InlineData(0, "1 photo")]
    [InlineData(1, "1 photo")]
    [InlineData(3, "3 photos")]
    public void The_photo_count_reads_in_french(int zones, string expected)
        => FrameChoice.PhotoCountText(FrameChoice.PhotoCount(zones)).Should().Be(expected);

    [Theory]
    [InlineData("portrait", 200, 300)]
    [InlineData("landscape", 220, 147)]
    [InlineData("stripV", 100, 300)]
    [InlineData("stripH", 220, 73)]
    [InlineData("inconnu", 200, 300)]
    public void The_thumbnail_keeps_the_print_proportions(string format, double width, double height)
        => FrameChoice.ThumbnailSize(format).Should().Be((width, height));

    [Fact]
    public void Unreadable_frames_are_left_out_and_four_tiles_at_most()
    {
        var image = Image();
        var candidates = new[]
        {
            new FrameCandidate(Template(MainId, 0), 1, image),
            new FrameCandidate(Template(StripId, 1, "stripV"), 3, null),
            new FrameCandidate(Template(ThirdId, 2), 0, image),
            new FrameCandidate(Template(Guid.NewGuid(), 3), 1, image),
            new FrameCandidate(Template(Guid.NewGuid(), 4), 1, image),
            new FrameCandidate(Template(Guid.NewGuid(), 5), 1, image),
        };

        var tiles = FrameChoice.Tiles(candidates);

        tiles.Should().HaveCount(4);
        tiles.Select(t => t.TemplateId).Should().NotContain(StripId);
        tiles[1].PhotoCountText.Should().Be("1 photo");
    }

    [Fact]
    public void The_frame_choice_config_is_read_leniently()
    {
        Read(new JObject { ["enabled"] = true, ["max_frames"] = 3 }).Should().BeEquivalentTo(new { Enabled = true, MaxFrames = 3 });
        Read(new JObject { ["enabled"] = "true", ["max_frames"] = 9 }).Should().BeEquivalentTo(new { Enabled = false, MaxFrames = 2 });
        Read(new JObject { ["enabled"] = true, ["max_frames"] = "3" }).Should().BeEquivalentTo(new { Enabled = true, MaxFrames = 2 });
        new JObject { ["frame_choice"] = "oui" }.ToObject<KioskConfig>()!.FrameChoice.Should().BeNull();
        new JObject().ToObject<KioskConfig>()!.FrameChoice.Should().BeNull();

        static FrameChoiceConfig? Read(JObject value) => new JObject { ["frame_choice"] = value }.ToObject<KioskConfig>()!.FrameChoice;
    }

    // ── Écran de choix ─────────────────────────────────────────────────────────

    [Fact]
    public void Touching_a_card_keeps_the_frame_and_goes_to_the_consent()
    {
        var rgpd = new RgpdParameters("J'accepte");
        var vm = SelectScreen(rgpd);

        vm.ChooseCommand.Execute(vm.Tiles[1]);

        _selection.SelectedTemplateId.Should().Be(StripId);
        _nav.Verify(n => n.NavigateTo<RgpdView>(rgpd), Times.Once);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Never);
    }

    [Fact]
    public void Without_consent_a_card_goes_straight_to_the_capture()
    {
        var vm = SelectScreen(rgpd: null);

        vm.ChooseCommand.Execute(vm.Tiles[0]);

        _selection.SelectedTemplateId.Should().Be(MainId);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
    }

    [Fact]
    public void Back_goes_home_and_clears_the_choice()
    {
        var vm = SelectScreen(rgpd: null);
        _selection.SelectedTemplateId = StripId;

        vm.BackCommand.Execute(null);

        _selection.SelectedTemplateId.Should().BeNull();
        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Once);
    }

    [Fact]
    public void Nothing_starts_while_the_admin_pin_pad_is_open()
    {
        var vm = SelectScreen(rgpd: null);
        vm.PinPad.OpenAdminPinCommand.Execute(null);

        vm.ChooseCommand.Execute(vm.Tiles[0]);
        vm.BackCommand.Execute(null);

        _selection.SelectedTemplateId.Should().BeNull();
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Never);
        _nav.Verify(n => n.NavigateTo<HomeView>(), Times.Never);
    }

    [Fact]
    public async Task A_missing_camera_shows_the_technical_problem_and_blocks_the_cards()
    {
        var health = new Mock<ICameraHealthService>();
        health.SetupGet(h => h.Status).Returns(CameraHealth.Absent);
        health.Setup(h => h.CheckNowAsync(It.IsAny<CancellationToken>())).ReturnsAsync(CameraHealth.Absent);
        var state = new Mock<IKioskStateService>();
        state.SetupGet(s => s.ContactCompany).Returns("Studio Exemple");
        state.SetupGet(s => s.ContactPhone).Returns("06 00 00 00 00");
        var vm = SelectScreen(rgpd: null, state.Object, health.Object);

        await vm.InitializeAsync();

        vm.IsCameraMissing.Should().BeTrue();
        vm.TechnicalProblemText.Should().Contain("Studio Exemple au 06 00 00 00 00");
        vm.ChooseCommand.CanExecute(vm.Tiles[0]).Should().BeFalse();
    }

    [Fact]
    public void The_choice_is_cleared_on_the_home_screen_only()
    {
        Type? current = null;
        _nav.SetupGet(n => n.CurrentViewType).Returns(() => current);
        var selection = new FrameSelectionService(_nav.Object) { SelectedTemplateId = StripId };

        foreach (var view in new[] { typeof(RgpdView), typeof(LiveView), typeof(ResultView), typeof(LiveView) })
        {
            current = view; // « Refaire les photos » : même cadre
            _nav.Raise(n => n.Navigated += null, EventArgs.Empty);
        }
        selection.SelectedTemplateId.Should().Be(StripId);

        current = typeof(HomeView);
        _nav.Raise(n => n.Navigated += null, EventArgs.Empty);
        selection.SelectedTemplateId.Should().BeNull();
    }

    // ── Accueil ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task With_two_readable_frames_the_home_opens_the_choice()
    {
        _templates = [Template(StripId, 1, "stripV", WritePng("strip.png")), Template(MainId, 0, "portrait", WritePng("main.png"))];
        var vm = await OpenHomeAsync(frameChoice: true, rgpd: true);

        await vm.FramesLoading!;
        vm.StartCommand.Execute(null);

        var sent = _nav.Invocations.Where(i => i.Method.Name == nameof(INavigationService.NavigateTo))
            .Select(i => i.Arguments.FirstOrDefault()).OfType<FrameSelectParameters>().Should().ContainSingle().Subject;
        sent.Tiles.Select(t => t.TemplateId).Should().Equal(MainId, StripId);
        sent.Tiles[1].PhotoCountText.Should().Be("3 photos");
        sent.Tiles[1].ImageWidth.Should().Be(100);
        sent.Rgpd!.Message.Should().Be("J'accepte");
        _nav.Verify(n => n.NavigateTo<FrameSelectView>(It.IsAny<object>()), Times.Once);
        _nav.Verify(n => n.NavigateTo<RgpdView>(It.IsAny<object>()), Times.Never);
    }

    [Fact]
    public async Task With_the_choice_off_the_home_goes_on_as_before()
    {
        _templates = [Template(StripId, 1, "stripV", WritePng("strip.png")), Template(MainId, 0, "portrait", WritePng("main.png"))];
        var vm = await OpenHomeAsync(frameChoice: false);

        vm.StartCommand.Execute(null);

        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
        _nav.Verify(n => n.NavigateTo<FrameSelectView>(It.IsAny<object>()), Times.Never);
    }

    [Fact]
    public async Task With_one_readable_frame_it_is_taken_without_asking()
    {
        _templates = [Template(MainId, 0, "portrait", Path.Combine(_dir.Path, "absent.png")), Template(StripId, 1, "stripV", WritePng("strip.png"))];
        var vm = await OpenHomeAsync(frameChoice: true);

        await vm.FramesLoading!;
        vm.StartCommand.Execute(null);

        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
        _nav.Verify(n => n.NavigateTo<FrameSelectView>(It.IsAny<object>()), Times.Never);
        _selection.SelectedTemplateId.Should().Be(StripId);
        _log.Verify(l => l.LogWarningAsync("frames", It.Is<string>(m => m.Contains(MainId.ToString()))), Times.Once);
    }

    [Fact]
    public async Task With_a_single_frame_there_is_no_choice()
    {
        _templates = [Template(MainId, 0, "portrait", WritePng("main.png"))];
        var vm = await OpenHomeAsync(frameChoice: true);

        await vm.FramesLoading!;
        vm.StartCommand.Execute(null);

        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
        _selection.SelectedTemplateId.Should().BeNull();
    }

    // ── Aides ──────────────────────────────────────────────────────────────────

    private FrameSelectViewModel SelectScreen(RgpdParameters? rgpd, IKioskStateService? state = null,
        ICameraHealthService? health = null)
    {
        var vm = new FrameSelectViewModel(_nav.Object, _selection, state ?? Mock.Of<IKioskStateService>(),
            new AdminPinPadViewModel(Mock.Of<IAdminPinService>(), _nav.Object, new PinAttemptLimiter()), health);
        var image = Image();
        vm.ReceiveParameter(new FrameSelectParameters(
            [
                new FrameTile(MainId, "Cadre 1", "portrait", 1, image, 200, 300),
                new FrameTile(StripId, "Bandelette", "stripV", 3, image, 100, 300),
            ], rgpd));
        return vm;
    }

    private async Task<HomeViewModel> OpenHomeAsync(bool frameChoice, bool rgpd = false)
    {
        var kiosk = new JObject { ["home"] = new JObject(), ["frame_choice"] = new JObject { ["enabled"] = frameChoice } };
        if (rgpd) kiosk["rgpd"] = new JObject { ["enabled"] = true, ["message"] = "J'accepte" };
        var ev = new EventEntity { Id = EventId, Name = "Mariage", FormConfigJson = new JObject { ["kiosk"] = kiosk }.ToString() };
        _sync.Setup(s => s.GetCurrentEventAsync(EventId)).ReturnsAsync(ev);

        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dir.Path;
        var state = new Mock<IKioskStateService>();
        state.SetupGet(s => s.ActiveEventId).Returns(EventId);
        var vm = new HomeViewModel(_nav.Object, state.Object, _sync.Object, Mock.Of<IIdleTimeoutService>(),
            new SessionPathService(settings), _composite.Object,
            new AdminPinPadViewModel(Mock.Of<IAdminPinService>(), _nav.Object, new PinAttemptLimiter()),
            settings, log: _log.Object, frameSelection: _selection);
        await vm.InitializeAsync();
        return vm;
    }

    private static TemplateEntity Template(Guid id, int order, string format = "portrait", string? png = null) => new()
    {
        Id = id, EventId = EventId, Name = $"Cadre {order + 1}", Format = format, SortOrder = order, ThumbnailPath = png,
    };

    private string WritePng(string name)
    {
        var path = Path.Combine(_dir.Path, name);
        var bitmap = BitmapSource.Create(40, 60, 96, 96, PixelFormats.Bgra32, null, new byte[40 * 4 * 60], 40 * 4);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var file = File.Create(path);
        encoder.Save(file);
        return path;
    }

    private static ImageSource Image()
    {
        var bitmap = BitmapSource.Create(2, 2, 96, 96, PixelFormats.Bgra32, null, new byte[16], 8);
        bitmap.Freeze();
        return bitmap;
    }
}
