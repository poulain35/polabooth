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
    public async Task An_animated_session_shows_its_poster_and_reopens_with_its_clip()
    {
        // Séance GIF (LAB-237) : montage + .share.json + animations\{séance}\ (clip, affiche).
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dir.Path;
        var paths = new SessionPathService(settings);
        var composites = paths.GetCompositesDirectory("Événement", EventId);
        Directory.CreateDirectory(composites);
        var gif = Path.Combine(composites, "gif.jpg");
        var photo = Path.Combine(composites, "photo.jpg");
        File.WriteAllText(gif, "jpg");
        File.WriteAllText(photo, "jpg");
        ShareInfoFile.Write(gif, new ShareInfo(SessionId, null, Guid.Empty));
        var animDir = SessionAnimation.DirectoryFor(composites, SessionId);
        Directory.CreateDirectory(animDir);
        File.WriteAllText(Path.Combine(animDir, AnimationService.VideoFileName), "mp4");
        File.WriteAllText(Path.Combine(animDir, AnimationService.PosterFileName), "jpg");

        var state = new Mock<IKioskStateService>();
        state.SetupGet(s => s.ActiveEventId).Returns(EventId);
        var sync = new Mock<ISyncService>();
        sync.Setup(s => s.GetTemplatesAsync(EventId)).ReturnsAsync([Main]);
        _sessions.Setup(s => s.ResolveSessionIdAsync(gif)).ReturnsAsync(SessionId);
        var vm = new GalleryViewModel(_nav.Object, state.Object, sync.Object, settings, paths, _sessions.Object);

        await vm.InitializeAsync();

        var cards = vm.Rows.SelectMany(r => r.Photos).ToList();
        cards.Should().HaveCount(2);
        var animated = cards.Single(c => c.Path == gif);
        animated.HasAnimation.Should().BeTrue();
        animated.Animation!.PosterPath.Should().Be(Path.Combine(animDir, AnimationService.PosterFileName));
        cards.Single(c => c.Path == photo).HasAnimation.Should().BeFalse();

        await vm.OpenPhotoCommand.ExecuteAsync(animated);

        var call = _nav.Invocations.Should().ContainSingle(i => i.Method.Name == nameof(INavigationService.NavigateTo)).Subject;
        var p = (ResultParameters)call.Arguments[0]!;
        p.CompositePath.Should().Be(gif, "la réimpression reste le montage des photos");
        p.VideoPath.Should().Be(Path.Combine(animDir, AnimationService.VideoFileName));
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
