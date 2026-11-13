using System.Net;
using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class NetworkMonitorServiceTests : IDisposable
{
    private readonly StubHandler _handler = new();
    private readonly NetworkMonitorService _monitor;

    public NetworkMonitorServiceTests()
    {
        var settings = new AppSettings();
        settings.Supabase.Url = "https://exemple.supabase.co";
        _monitor = new NetworkMonitorService(settings, _handler);
    }

    public void Dispose() => _monitor.Dispose();

    [Fact]
    public async Task An_exception_in_NetworkRestored_does_not_escape()
    {
        _monitor.NetworkRestored += (_, _) => throw new InvalidOperationException("abonné en panne");

        var act = () => _monitor.CheckNowAsync(TestContext.Current.CancellationToken);

        (await act.Should().NotThrowAsync()).Which.Should().BeTrue();
        _monitor.IsOnline.Should().BeTrue();
        File.ReadAllText(FatalLog.FilePath).Should().Contain("abonné en panne");
    }

    [Fact]
    public async Task NetworkRestored_is_raised_once_per_return_of_the_network()
    {
        var restored = 0;
        var lost = 0;
        _monitor.NetworkRestored += (_, _) => Interlocked.Increment(ref restored);
        _monitor.NetworkLost += (_, _) => Interlocked.Increment(ref lost);
        var ct = TestContext.Current.CancellationToken;

        await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => _monitor.CheckNowAsync(ct)));
        _handler.Online = false;
        await _monitor.CheckNowAsync(ct);
        _handler.Online = true;
        await _monitor.CheckNowAsync(ct);

        restored.Should().Be(2);
        lost.Should().Be(1);
    }

    [Fact]
    public async Task A_server_error_counts_as_offline_but_a_client_error_as_online()
    {
        var ct = TestContext.Current.CancellationToken;

        _handler.Status = HttpStatusCode.ServiceUnavailable;
        (await _monitor.CheckNowAsync(ct)).Should().BeFalse();

        _handler.Status = HttpStatusCode.Unauthorized;
        (await _monitor.CheckNowAsync(ct)).Should().BeTrue();
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        public bool Online { get; set; } = true;
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Online
                ? Task.FromResult(new HttpResponseMessage(Status))
                : throw new HttpRequestException("Hôte inaccessible");
    }
}
