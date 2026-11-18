using FluentAssertions;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Écran admin : carte « Événement actif » après l'import d'un .pola (LAB-320).</summary>
public class AdminViewModelTests
{
    private readonly Mock<IKioskStateService> _state = new();
    private readonly Mock<ISyncService> _sync = new();

    private readonly Mock<IPolaHistory> _history = new();

    public AdminViewModelTests() => _history.Setup(h => h.List()).Returns([]);

    private AdminViewModel NewViewModel() => NewViewModel(_state.Object, _sync.Object, _history.Object);

    internal static AdminViewModel NewViewModel(IKioskStateService state, ISyncService sync, IPolaHistory history,
        INavigationService? navigation = null)
    {
        var machine = new Mock<IMachineSettingsService>();
        machine.SetupGet(m => m.Current).Returns(new MachineSettings());
        var print = new Mock<IPrintService>();
        print.Setup(p => p.GetAvailablePrinters()).Returns([]);
        var cameras = new Mock<ICameraDetectionService>();
        cameras.Setup(c => c.DetectAvailableCameras()).Returns([]);

        return new AdminViewModel(state, navigation ?? Mock.Of<INavigationService>(), sync,
            Mock.Of<IKioskService>(), print.Object, machine.Object, cameras.Object, new AppSettings(),
            Mock.Of<ISaasSwitchService>(), Mock.Of<IAppRestart>(), history, Mock.Of<IPrinterDriver>());
    }

    [Fact]
    public async Task Imported_event_becomes_active_and_is_shown_at_once()
    {
        var ev = new EventEntity { Id = Guid.NewGuid(), Name = "Mariage Léa & Tom", AccessCode = "LEA2026" };
        _sync.Setup(s => s.ImportPolaFileAsync("mariage.pola")).ReturnsAsync(ev);
        var vm = NewViewModel();
        vm.ActiveEventName.Should().Be("Aucun événement chargé");

        await vm.ImportPolaFromPathAsync("mariage.pola");

        _state.Verify(s => s.SetActiveEventAsync(ev.Id, "Mariage Léa & Tom", "LEA2026"), Times.Once);
        vm.ActiveEventName.Should().Be("Mariage Léa & Tom");
        vm.ActiveEventId.Should().Be(ev.Id.ToString());
        vm.PolaStatusMsg.Should().StartWith("✓");
        vm.IsImporting.Should().BeFalse();
    }

    [Fact]
    public async Task Refused_file_keeps_the_current_event()
    {
        _state.SetupGet(s => s.ActiveEventName).Returns("Anniversaire");
        _sync.Setup(s => s.ImportPolaFileAsync(It.IsAny<string>()))
            .ThrowsAsync(new InvalidDataException("Fichier .pola d'un ancien format."));
        var vm = NewViewModel();

        await vm.ImportPolaFromPathAsync("ancien.pola");

        _state.Verify(s => s.SetActiveEventAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        vm.ActiveEventName.Should().Be("Anniversaire");
        vm.PolaStatusMsg.Should().Be("Erreur : Fichier .pola d'un ancien format.");
    }

    // ── Retour (LAB-389) ──

    private readonly Mock<INavigationService> _navigation = new();

    [Fact]
    public async Task Back_returns_to_the_active_event_home()
    {
        var id = Guid.NewGuid();
        _state.SetupGet(s => s.ActiveEventId).Returns(id);
        _sync.Setup(s => s.GetCurrentEventAsync(id)).ReturnsAsync(new EventEntity { Id = id, Name = "Mariage" });
        var vm = NewViewModel(_state.Object, _sync.Object, _history.Object, _navigation.Object);

        await vm.BackCommand.ExecuteAsync(null);

        _navigation.Verify(n => n.NavigateTo<PolaKiosk.Views.HomeView>(), Times.Once);
        _navigation.Verify(n => n.NavigateTo<PolaKiosk.Views.EventSetupView>(), Times.Never);
    }

    [Fact]
    public async Task Back_without_active_event_returns_to_code_entry()
    {
        _state.SetupGet(s => s.ActiveEventId).Returns((Guid?)null);
        var vm = NewViewModel(_state.Object, _sync.Object, _history.Object, _navigation.Object);

        await vm.BackCommand.ExecuteAsync(null);

        _navigation.Verify(n => n.NavigateTo<PolaKiosk.Views.EventSetupView>(), Times.Once);
        _navigation.Verify(n => n.NavigateTo<PolaKiosk.Views.HomeView>(), Times.Never);
    }

    [Fact]
    public async Task Back_with_an_event_missing_locally_returns_to_code_entry()
    {
        var id = Guid.NewGuid();
        _state.SetupGet(s => s.ActiveEventId).Returns(id);
        _sync.Setup(s => s.GetCurrentEventAsync(id)).ReturnsAsync((EventEntity?)null);
        var vm = NewViewModel(_state.Object, _sync.Object, _history.Object, _navigation.Object);

        await vm.BackCommand.ExecuteAsync(null);

        _navigation.Verify(n => n.NavigateTo<PolaKiosk.Views.EventSetupView>(), Times.Once);
    }
}
