using FluentAssertions;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class StartupFlowTests
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");

    private readonly Mock<ILicenseService> _license = new();
    private readonly Mock<IKioskStateService> _state = new();
    private readonly Mock<ISyncService> _sync = new();

    public StartupFlowTests() => _license.Setup(l => l.CheckAsync()).ReturnsAsync(LicenseStatus.Valid);

    private Task<StartScreen> Choose(bool eventPushed = false)
        => StartupFlow.ChooseStartScreenAsync(_license.Object, _state.Object, _sync.Object, eventPushed);

    [Fact]
    public async Task Resumes_on_home_when_the_active_event_is_cached()
    {
        _state.Setup(s => s.ActiveEventId).Returns(EventId);
        _sync.Setup(s => s.GetCurrentEventAsync(EventId)).ReturnsAsync(new EventEntity { Id = EventId });

        (await Choose()).Should().Be(StartScreen.Home);
    }

    [Fact]
    public async Task Asks_for_the_code_when_the_active_event_is_no_longer_cached()
    {
        _state.Setup(s => s.ActiveEventId).Returns(EventId);
        _sync.Setup(s => s.GetCurrentEventAsync(EventId)).ReturnsAsync((EventEntity?)null);

        (await Choose()).Should().Be(StartScreen.EventSetup);
    }

    [Fact]
    public async Task Asks_for_the_code_without_active_event()
    {
        _state.Setup(s => s.ActiveEventId).Returns((Guid?)null);

        (await Choose()).Should().Be(StartScreen.EventSetup);
        _sync.Verify(s => s.GetCurrentEventAsync(It.IsAny<Guid>()), Times.Never);
    }

    [Theory]
    [InlineData(LicenseStatus.Refused)]
    [InlineData(LicenseStatus.Unverified)]
    public async Task Shows_the_pairing_screen_first_without_a_valid_license(LicenseStatus status)
    {
        _license.Setup(l => l.CheckAsync()).ReturnsAsync(status);
        _state.Setup(s => s.ActiveEventId).Returns(EventId);
        _sync.Setup(s => s.GetCurrentEventAsync(EventId)).ReturnsAsync(new EventEntity { Id = EventId });

        (await Choose()).Should().Be(StartScreen.Pairing);
    }

    // LAB-245 : événement envoyé depuis le SaaS et chargé au démarrage → écran de chargement, sans code.
    [Fact]
    public async Task Shows_the_event_loading_screen_when_an_event_was_pushed_at_startup()
    {
        _state.Setup(s => s.ActiveEventId).Returns(EventId);

        (await Choose(eventPushed: true)).Should().Be(StartScreen.EventLoading);
    }

    [Fact]
    public async Task Checks_the_license_before_showing_a_pushed_event()
    {
        _license.Setup(l => l.CheckAsync()).ReturnsAsync(LicenseStatus.Refused);
        _state.Setup(s => s.ActiveEventId).Returns(EventId);

        (await Choose(eventPushed: true)).Should().Be(StartScreen.Pairing);
    }
}
