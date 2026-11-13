using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class OnlineSyncServiceTests : IDisposable
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");

    private readonly Mock<ISessionService> _sessions = new();
    private readonly Mock<IGuestResponseService> _responses = new();
    private readonly Mock<IPhotoConsentService> _consents = new();
    private readonly Mock<ISyncService> _sync = new();
    private readonly Mock<IPrintLogSyncService> _printLogs = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly Mock<IKioskStateService> _state = new();
    private readonly Mock<IAdminPinService> _adminPin = new();
    private readonly ServiceProvider _provider;

    public OnlineSyncServiceTests()
    {
        _provider = new ServiceCollection()
            .AddSingleton(_sessions.Object)
            .AddSingleton(_responses.Object)
            .AddSingleton(_consents.Object)
            .AddSingleton(_sync.Object)
            .BuildServiceProvider();
        _state.Setup(s => s.ActiveEventId).Returns(EventId);
        _sync.Setup(s => s.SyncAsync(EventId, It.IsAny<CancellationToken>())).ReturnsAsync(true);
    }

    public void Dispose() => _provider.Dispose();

    private OnlineSyncService NewService() => new(
        _provider.GetRequiredService<IServiceScopeFactory>(), _printLogs.Object, _log.Object, _state.Object, _adminPin.Object);

    [Fact]
    public async Task RunAsync_keeps_going_when_the_session_upload_fails()
    {
        _sessions.Setup(s => s.UploadPendingSessionsAsync()).ThrowsAsync(new InvalidOperationException("database is locked"));

        var act = () => NewService().RunAsync();

        await act.Should().NotThrowAsync();
        _responses.Verify(r => r.SendPendingAsync(), Times.Once);
        _consents.Verify(c => c.SendPendingAsync(), Times.Once);
        _printLogs.Verify(p => p.SendPendingAsync(), Times.Once);
        _log.Verify(l => l.UploadPendingAsync(), Times.Once);
        _sync.Verify(s => s.SyncAsync(EventId, It.IsAny<CancellationToken>()), Times.Once);
        _log.Verify(l => l.LogErrorAsync("sync-sessions", It.Is<string>(m => m.Contains("database is locked")), It.IsAny<string?>()), Times.Once);
    }

    [Fact]
    public async Task Guest_responses_step_failure_does_not_block_the_other_uploads()
    {
        _responses.Setup(r => r.SendPendingAsync()).ThrowsAsync(new InvalidOperationException("database is locked"));

        await NewService().UploadPendingAsync();

        _printLogs.Verify(p => p.SendPendingAsync(), Times.Once);
        _log.Verify(l => l.UploadPendingAsync(), Times.Once);
        _log.Verify(l => l.LogErrorAsync("sync-guest-responses", It.IsAny<string>(), It.IsAny<string?>()), Times.Once);
    }

    [Fact]
    public async Task Photo_consents_step_failure_does_not_block_the_other_uploads()
    {
        _consents.Setup(c => c.SendPendingAsync()).ThrowsAsync(new InvalidOperationException("database is locked"));

        await NewService().UploadPendingAsync();

        _responses.Verify(r => r.SendPendingAsync(), Times.Once);
        _printLogs.Verify(p => p.SendPendingAsync(), Times.Once);
        _log.Verify(l => l.UploadPendingAsync(), Times.Once);
        _log.Verify(l => l.LogErrorAsync("sync-photo-consents", It.IsAny<string>(), It.IsAny<string?>()), Times.Once);
    }

    [Fact]
    public async Task RunAsync_does_not_throw_when_every_step_fails()
    {
        _sessions.Setup(s => s.UploadPendingSessionsAsync()).ThrowsAsync(new HttpRequestException("coupure"));
        _responses.Setup(r => r.SendPendingAsync()).ThrowsAsync(new HttpRequestException("coupure"));
        _consents.Setup(c => c.SendPendingAsync()).ThrowsAsync(new HttpRequestException("coupure"));
        _printLogs.Setup(p => p.SendPendingAsync()).ThrowsAsync(new HttpRequestException("coupure"));
        _log.Setup(l => l.UploadPendingAsync()).ThrowsAsync(new HttpRequestException("coupure"));
        _sync.Setup(s => s.SyncSetupConfigAsync(It.IsAny<CancellationToken>())).ThrowsAsync(new FormatException("JSON tronqué"));
        // Même le journal kiosk est en panne : repli sur fatal.log.
        _log.Setup(l => l.LogErrorAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>()))
            .ThrowsAsync(new InvalidOperationException("base indisponible"));

        var act = () => NewService().RunAsync();

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task RunAsync_refreshes_the_admin_pin_when_the_network_is_back()
    {
        await NewService().RunAsync();

        _adminPin.Verify(p => p.RefreshAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ResyncAsync_syncs_the_setup_config_then_the_active_event()
    {
        var ok = await NewService().ResyncAsync(TestContext.Current.CancellationToken);

        ok.Should().BeTrue();
        _sync.Verify(s => s.SyncSetupConfigAsync(It.IsAny<CancellationToken>()), Times.Once);
        _sync.Verify(s => s.SyncAsync(EventId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ResyncAsync_returns_false_when_cancelled()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        _sync.Setup(s => s.SyncSetupConfigAsync(It.IsAny<CancellationToken>()))
             .ThrowsAsync(new TaskCanceledException());

        (await NewService().ResyncAsync(cts.Token)).Should().BeFalse();
        _sync.Verify(s => s.SyncAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
