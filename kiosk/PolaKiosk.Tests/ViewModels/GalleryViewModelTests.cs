using FluentAssertions;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Réimpression depuis la galerie : papier du cadre de la séance (LAB-315).</summary>
public sealed class GalleryViewModelTests : IDisposable
{
    private static readonly Guid EventId   = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private static readonly Guid SessionId = Guid.Parse("7a8b9c0d-1111-4222-8333-944455556666");
    private static readonly TemplateEntity Main  = new() { Id = Guid.NewGuid(), EventId = EventId, Name = "Cadre 1", Format = "portrait", SortOrder = 0 };
    private static readonly TemplateEntity Strip = new() { Id = Guid.NewGuid(), EventId = EventId, Name = "Bandelette", Format = "stripV", SortOrder = 1 };

    private readonly TempDir _dir = new();
    private readonly Mock<INavigationService> _nav = new();
    private readonly Mock<ISessionService> _sessions = new();

    public void Dispose() => _dir.Dispose();

    private async Task<ResultParameters> ReopenAsync(Guid? sessionFrame)
    {
        var state = new Mock<IKioskStateService>();
        state.SetupGet(s => s.ActiveEventId).Returns(EventId);
        var sync = new Mock<ISyncService>();
        sync.Setup(s => s.GetTemplatesAsync(EventId)).ReturnsAsync([Main, Strip]);
        _sessions.Setup(s => s.ResolveSessionIdAsync(It.IsAny<string>())).ReturnsAsync(SessionId);
        _sessions.Setup(s => s.GetSessionTemplateIdAsync(SessionId)).ReturnsAsync(sessionFrame);
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dir.Path;

        var vm = new GalleryViewModel(_nav.Object, state.Object, sync.Object, settings,
            new SessionPathService(settings), _sessions.Object);
        await vm.InitializeAsync();
        await vm.OpenPhotoCommand.ExecuteAsync(new GalleryPhoto("photo.jpg", _ => null));

        var call = _nav.Invocations.Should().ContainSingle(i => i.Method.Name == nameof(INavigationService.NavigateTo)).Subject;
        call.Method.GetGenericArguments().Should().Equal(typeof(ResultView));
        return (ResultParameters)call.Arguments[0]!;
    }

    [Fact]
    public async Task A_strip_photo_is_reprinted_on_strip_paper()
        => (await ReopenAsync(Strip.Id)).PaperFormat.Should().Be("2x6");

    [Fact]
    public async Task A_photo_of_an_unknown_or_removed_frame_uses_the_first_frame_of_the_event()
    {
        (await ReopenAsync(null)).PaperFormat.Should().Be("4x6");
        _nav.Invocations.Clear();
        (await ReopenAsync(Guid.NewGuid())).PaperFormat.Should().Be("4x6");
    }
}
