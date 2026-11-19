using FluentAssertions;
using Moq;
using PolaKiosk.Models;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Admin › Appareil photo (LAB-427) : boutons − / +, bornes de la liste, envoi, refus, persistance.</summary>
public sealed class AdminExposureTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 11, 19, 15, 0, 0, TimeSpan.Zero);

    private const int Tv125 = 0x70, Tv160 = 0x73, Tv200 = 0x75, Tv250 = 0x78;

    private readonly TempDir _dir = new();
    private readonly MachineSettingsService _machine;
    private readonly Mock<ICameraService> _camera = new();

    public AdminExposureTests()
    {
        _machine = new MachineSettingsService(_dir.Path);
        _camera.Setup(c => c.SupportsExposureSettings).Returns(true);
        _camera.Setup(c => c.InitializeAsync()).Returns(Task.CompletedTask);
        _camera.Setup(c => c.StartLiveViewAsync(It.IsAny<Action<byte[]>>())).Returns(Task.CompletedTask);
        _camera.Setup(c => c.StopLiveViewAsync()).Returns(Task.CompletedTask);
        AdminViewModel.ExposureRefreshDelay = TimeSpan.Zero;
    }

    public void Dispose() => _dir.Dispose();

    private AdminViewModel NewViewModel(ICameraService? camera)
    {
        var history = new Mock<IPolaHistory>();
        history.Setup(h => h.List()).Returns([]);
        var cameras = new Mock<ICameraDetectionService>();
        cameras.Setup(c => c.DetectAvailableCameras()).Returns([]);
        var print = new Mock<IPrintService>();
        print.Setup(p => p.GetAvailablePrinters()).Returns([]);
        var clock = new Mock<TimeProvider>();
        clock.Setup(c => c.GetUtcNow()).Returns(Now);

        return new AdminViewModel(Mock.Of<IKioskStateService>(), Mock.Of<INavigationService>(), Mock.Of<ISyncService>(),
            Mock.Of<IKioskService>(), print.Object, _machine, cameras.Object, new AppSettings(),
            Mock.Of<ISaasSwitchService>(), Mock.Of<IAppRestart>(), history.Object, Mock.Of<IPrinterDriver>(),
            camera, clock.Object);
    }

    private static CameraExposureState State(string mode = "M", int tv = Tv125, int wb = 1, int? kelvin = 5200) => new()
    {
        Model    = "Canon EOS R100",
        Mode     = mode,
        Settable = mode == "M",
        Values   = new CameraExposureValues { Tv = tv, Av = 0x30, Iso = 0x48, Wb = wb, Kelvin = kelvin },
        Options  = new Dictionary<string, List<CameraOption>>
        {
            [CameraExposureKeys.Tv]     = CanonExposure.Options(CameraExposureKeys.Tv, [Tv125, Tv160, Tv200, Tv250]),
            [CameraExposureKeys.Av]     = CanonExposure.Options(CameraExposureKeys.Av, [0x2B, 0x30, 0x40]),
            [CameraExposureKeys.Iso]    = CanonExposure.Options(CameraExposureKeys.Iso, [0x48, 0x50, 0x58]),
            [CameraExposureKeys.Wb]     = CanonExposure.Options(CameraExposureKeys.Wb, [0, 1, 9]),
            [CameraExposureKeys.Kelvin] = CanonExposure.KelvinOptions(),
        },
        At = Now,
    };

    private async Task<AdminViewModel> OpenWith(CameraExposureState state)
    {
        _camera.Setup(c => c.ReadExposureAsync()).ReturnsAsync(state);
        var vm = NewViewModel(_camera.Object);
        await vm.OpenExposureCommand.ExecuteAsync(null);
        return vm;
    }

    // ── Logique pure des boutons − / + ────────────────────────────────────────

    [Theory]
    [InlineData(0, 4, -1, 0)]
    [InlineData(0, 4, +1, 1)]
    [InlineData(3, 4, +1, 3)]
    [InlineData(3, 4, -1, 2)]
    [InlineData(0, 0, +1, 0)]
    [InlineData(9, 4, -1, 3)]
    public void Step_stays_within_the_list(int index, int count, int delta, int expected)
        => ExposureStepper.Step(index, count, delta).Should().Be(expected);

    [Fact]
    public void Index_is_the_position_of_the_code_or_the_nearest()
    {
        var options = CanonExposure.Options(CameraExposureKeys.Tv, [Tv125, Tv160, Tv200]);

        ExposureStepper.IndexFor(options, Tv160).Should().Be(1);
        ExposureStepper.IndexFor(options, 0x78).Should().Be(2);  // 1/250 absent : 1/200 au plus près
        ExposureStepper.IndexFor(options, 0x10).Should().Be(0);
        ExposureStepper.IndexFor(options, null).Should().Be(0);
        ExposureStepper.IndexFor([], Tv160).Should().Be(0);
    }

    [Fact]
    public void Plus_and_minus_send_the_neighbour_code_but_not_beyond_the_list()
    {
        var sent = new List<int>();
        var row = new ExposureSettingViewModel(CameraExposureKeys.Tv, "Vitesse", (_, code) => sent.Add(code));
        row.Update(CanonExposure.Options(CameraExposureKeys.Tv, [Tv125, Tv160, Tv200]), Tv125, enabled: true);

        row.CanDecrement.Should().BeFalse();
        row.DecrementCommand.Execute(null);
        row.IncrementCommand.Execute(null);
        row.IncrementCommand.Execute(null);
        row.CanIncrement.Should().BeFalse();
        row.IncrementCommand.Execute(null);

        sent.Should().Equal(Tv160, Tv200);
        row.ValueLabel.Should().Be("1/200");
    }

    [Fact]
    public void Values_read_from_the_camera_are_not_sent_back()
    {
        var sent = new List<int>();
        var row = new ExposureSettingViewModel(CameraExposureKeys.Tv, "Vitesse", (_, code) => sent.Add(code));

        row.Update(CanonExposure.Options(CameraExposureKeys.Tv, [Tv125, Tv160]), Tv160, enabled: true);

        sent.Should().BeEmpty();
        row.SelectedIndex.Should().Be(1);
        row.MaxIndex.Should().Be(1);
    }

    [Fact]
    public void A_disabled_row_sends_nothing_and_shows_a_value_missing_from_the_list()
    {
        var sent = new List<int>();
        var row = new ExposureSettingViewModel(CameraExposureKeys.Iso, "ISO", (_, code) => sent.Add(code));

        row.Update([], 0x68, enabled: true); // l'appareil ne décrit pas la liste
        row.IncrementCommand.Execute(null);

        row.ValueLabel.Should().Be("1600");
        row.IsEnabled.Should().BeFalse();
        sent.Should().BeEmpty();
    }

    // ── Écran Appareil photo ──────────────────────────────────────────────────

    [Fact]
    public async Task Webcam_or_simulated_camera_says_canon_only()
    {
        var vm = NewViewModel(new MockCameraService());

        await vm.OpenExposureCommand.ExecuteAsync(null);

        vm.IsExposureOpen.Should().BeTrue();
        vm.IsExposureSupported.Should().BeFalse();
        vm.ExposureMsg.Should().Be("Réglages disponibles avec un appareil Canon.");
    }

    [Fact]
    public async Task Opening_reads_the_camera_and_starts_the_preview()
    {
        var vm = await OpenWith(State());

        vm.IsExposureSupported.Should().BeTrue();
        vm.NeedsManualMode.Should().BeFalse();
        vm.ExposureMode.Should().Be("M");
        vm.ExposureSetting(CameraExposureKeys.Tv).ValueLabel.Should().Be("1/125");
        vm.ExposureSetting(CameraExposureKeys.Av).ValueLabel.Should().Be("5,6");
        vm.ExposureSetting(CameraExposureKeys.Iso).ValueLabel.Should().Be("100");
        vm.ExposureSetting(CameraExposureKeys.Wb).ValueLabel.Should().Be("Lumière du jour");
        vm.ExposureSetting(CameraExposureKeys.Tv).IsEnabled.Should().BeTrue();
        _camera.Verify(c => c.StartLiveViewAsync(It.IsAny<Action<byte[]>>()), Times.Once);
    }

    [Fact]
    public async Task Outside_manual_mode_the_banner_shows_and_settings_are_greyed()
    {
        var vm = await OpenWith(State(mode: "Av"));

        vm.NeedsManualMode.Should().BeTrue();
        vm.ExposureMode.Should().Be("Av");
        vm.ExposureSettings.Should().OnlyContain(s => !s.IsEnabled);

        vm.ExposureSetting(CameraExposureKeys.Tv).IncrementCommand.Execute(null);
        _camera.Verify(c => c.ApplyExposureAsync(It.IsAny<CameraExposureValues>()), Times.Never);
    }

    [Fact]
    public async Task Plus_sends_the_change_at_once_and_keeps_it_on_the_kiosk()
    {
        var vm = await OpenWith(State());
        _camera.Setup(c => c.ApplyExposureAsync(It.IsAny<CameraExposureValues>())).ReturnsAsync(State(tv: Tv160));

        vm.ExposureSetting(CameraExposureKeys.Tv).IncrementCommand.Execute(null);
        await vm.ApplyPendingExposureAsync();

        _camera.Verify(c => c.ApplyExposureAsync(It.Is<CameraExposureValues>(v =>
            v.Tv == Tv160 && v.Av == null && v.Iso == null && v.Wb == null && v.Kelvin == null)), Times.Once);
        var saved = new MachineSettingsService(_dir.Path).Current.CameraExposure;
        saved!.Values.Tv.Should().Be(Tv160);
        saved.Values.Av.Should().Be(0x30);
        saved.ChangedAt.Should().Be(Now);
        vm.ExposureSetting(CameraExposureKeys.Tv).ValueLabel.Should().Be("1/160");
        vm.ExposureMsg.Should().BeEmpty();
    }

    [Fact]
    public async Task A_refusal_shows_the_message_and_the_value_kept_by_the_camera()
    {
        var vm = await OpenWith(State());
        _camera.Setup(c => c.ApplyExposureAsync(It.IsAny<CameraExposureValues>()))
            .ThrowsAsync(new CameraExposureException("L'appareil a refusé 1/160.", State()));

        vm.ExposureSetting(CameraExposureKeys.Tv).IncrementCommand.Execute(null);
        await vm.ApplyPendingExposureAsync();

        vm.ExposureMsg.Should().Be("L'appareil a refusé 1/160.");
        vm.ExposureSetting(CameraExposureKeys.Tv).ValueLabel.Should().Be("1/125");
    }

    [Fact]
    public async Task Turning_the_dial_away_from_m_is_reported_and_nothing_is_saved()
    {
        var vm = await OpenWith(State());
        _camera.Setup(c => c.ApplyExposureAsync(It.IsAny<CameraExposureValues>()))
            .ThrowsAsync(new CameraExposureException("Mettez la molette de l'appareil sur M (mode actuel : Av).",
                State(mode: "Av")));

        vm.ExposureSetting(CameraExposureKeys.Tv).IncrementCommand.Execute(null);
        await vm.ApplyPendingExposureAsync();

        vm.ExposureMsg.Should().Contain("molette");
        vm.NeedsManualMode.Should().BeTrue();
        new MachineSettingsService(_dir.Path).Current.CameraExposure.Should().BeNull();
    }

    [Fact]
    public async Task Faster_than_1_200_shows_the_flash_warning()
    {
        var vm = await OpenWith(State(tv: Tv250));

        vm.ExposureSetting(CameraExposureKeys.Tv).Warning.Should().Be(CanonExposure.FlashSyncWarning);
        vm.ExposureSetting(CameraExposureKeys.Tv).HasWarning.Should().BeTrue();

        vm.ShowExposureState(State(tv: Tv200));
        vm.ExposureSetting(CameraExposureKeys.Tv).HasWarning.Should().BeFalse();
    }

    [Fact]
    public async Task Kelvin_row_shows_only_with_colour_temperature_white_balance()
    {
        var vm = await OpenWith(State(wb: 1));
        vm.ExposureSetting(CameraExposureKeys.Kelvin).IsVisible.Should().BeFalse();

        vm.ShowExposureState(State(wb: CanonExposure.WbColorTemperature, kelvin: 5600));

        var kelvin = vm.ExposureSetting(CameraExposureKeys.Kelvin);
        kelvin.IsVisible.Should().BeTrue();
        kelvin.ValueLabel.Should().Be("5600 K");
    }

    [Fact]
    public async Task A_camera_event_rereads_the_settings()
    {
        var vm = await OpenWith(State(mode: "M"));
        _camera.Setup(c => c.ReadExposureAsync()).ReturnsAsync(State(mode: "Av"));

        _camera.Raise(c => c.ExposureOptionsChanged += null, EventArgs.Empty);
        await vm.RefreshExposureAsync(); // relecture différée : s'assurer qu'elle a eu lieu

        _camera.Verify(c => c.ReadExposureAsync(), Times.AtLeast(2));
        vm.NeedsManualMode.Should().BeTrue();
        vm.ExposureMode.Should().Be("Av");
    }

    [Fact]
    public async Task Closing_stops_listening_to_the_camera()
    {
        var vm = await OpenWith(State());

        await vm.CloseExposureCommand.ExecuteAsync(null);

        vm.IsExposureOpen.Should().BeFalse();
        _camera.VerifyAdd(c => c.ExposureOptionsChanged += It.IsAny<EventHandler>(), Times.Once);
        _camera.VerifyRemove(c => c.ExposureOptionsChanged -= It.IsAny<EventHandler>(), Times.Once);
    }

    [Fact]
    public void Pending_changes_become_contract_values()
    {
        var values = AdminViewModel.ToValues(new Dictionary<string, int>
        {
            [CameraExposureKeys.Wb] = 9, [CameraExposureKeys.Kelvin] = 5600,
        });

        values.Should().Be(new CameraExposureValues { Wb = 9, Kelvin = 5600 });
    }
}
