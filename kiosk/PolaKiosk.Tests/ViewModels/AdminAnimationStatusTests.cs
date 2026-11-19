using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Admin › Borne : ligne « Animations : … » (LAB-234), contrôlée à l'ouverture puis par « Vérifier ».</summary>
public class AdminAnimationStatusTests
{
    private readonly Mock<IAnimationService> _animation = new();

    private AdminViewModel NewViewModel(IAnimationService? animation)
    {
        var history = new Mock<IPolaHistory>();
        history.Setup(h => h.List()).Returns([]);
        var machine = new Mock<IMachineSettingsService>();
        machine.SetupGet(m => m.Current).Returns(new MachineSettings());
        var print = new Mock<IPrintService>();
        print.Setup(p => p.GetAvailablePrinters()).Returns([]);
        var cameras = new Mock<ICameraDetectionService>();
        cameras.Setup(c => c.DetectAvailableCameras()).Returns([]);

        return new AdminViewModel(Mock.Of<IKioskStateService>(), Mock.Of<INavigationService>(), Mock.Of<ISyncService>(),
            Mock.Of<IKioskService>(), print.Object, machine.Object, cameras.Object, new AppSettings(),
            Mock.Of<ISaasSwitchService>(), Mock.Of<IAppRestart>(), history.Object, Mock.Of<IPrinterDriver>(),
            animation: animation);
    }

    [Fact]
    public void Shows_the_encoder_found_at_opening()
    {
        _animation.Setup(a => a.GetEncoderStatusAsync(false, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AnimationEncoderStatus(AnimationEncoderState.Ready, ["h264_mf"], "n9"));

        var vm = NewViewModel(_animation.Object);

        vm.AnimationStatus.Should().Be("Animations : prêtes (h264_mf)");
    }

    [Fact]
    public async Task Check_runs_the_detection_again()
    {
        _animation.Setup(a => a.GetEncoderStatusAsync(false, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AnimationEncoderStatus(AnimationEncoderState.FfmpegMissing, [], null));
        _animation.Setup(a => a.GetEncoderStatusAsync(true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AnimationEncoderStatus(AnimationEncoderState.NoEncoder, [], "n9"));
        var vm = NewViewModel(_animation.Object);
        vm.AnimationStatus.Should().Be("Animations : ffmpeg absent");

        await vm.CheckAnimationsCommand.ExecuteAsync(null);

        vm.AnimationStatus.Should().Be("Animations : encodeur H.264 absent");
        _animation.Verify(a => a.GetEncoderStatusAsync(true, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public void Without_the_service_the_line_says_unavailable()
        => NewViewModel(null).AnimationStatus.Should().Be("Animations : indisponibles");
}
