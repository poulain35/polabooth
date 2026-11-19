using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Écran résultat d'un GIF (LAB-237) : animation en boucle, montage des photos à l'impression.</summary>
public sealed class ResultViewModelAnimationTests : IDisposable
{
    private readonly ResultViewModelHarness _h = new();
    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    [Fact]
    public async Task A_gif_plays_its_clip_and_prints_the_photo_montage()
    {
        var video = _dir.File("clip.mp4");
        File.WriteAllText(video, "mp4");
        var p = ResultViewModelHarness.Parameters() with { VideoPath = video };

        var result = await _h.OpenAsync(p);

        result.HasAnimation.Should().BeTrue();
        result.AnimationSource.Should().Be(new Uri(video));
        result.AnimationNotice.Should().BeEmpty();

        await result.PrintCommand.ExecuteAsync(null);
        _h.Print.Verify(x => x.PrintAsync(p.CompositePath, It.IsAny<string>(), It.IsAny<string>(), p.SessionId, p.EventId,
            It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string?>()), Times.Once);
    }

    [Fact]
    public async Task A_missing_clip_shows_the_montage()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters() with { VideoPath = _dir.File("absent.mp4") });

        result.HasAnimation.Should().BeFalse();
    }

    [Fact]
    public async Task A_failed_animation_says_so_and_shows_the_photos()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters() with { AnimationUnavailable = true });

        result.HasAnimation.Should().BeFalse();
        result.AnimationNotice.Should().Be(ResultViewModel.AnimationUnavailableText);
    }

    [Fact]
    public async Task A_clip_that_cannot_be_played_falls_back_to_the_montage_and_is_logged()
    {
        var video = _dir.File("clip.mp4");
        File.WriteAllText(video, "mp4");
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters() with { VideoPath = video });

        result.OnAnimationFailed("codec absent");

        result.HasAnimation.Should().BeFalse();
        _h.Log.Verify(l => l.LogWarningAsync(AnimationService.LogContext, It.Is<string>(m => m.Contains("codec absent"))), Times.Once);
    }

    [Fact]
    public async Task Leaving_the_screen_releases_the_clip()
    {
        var video = _dir.File("clip.mp4");
        File.WriteAllText(video, "mp4");
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters() with { VideoPath = video });

        result.Release();

        result.AnimationSource.Should().BeNull();
    }
}
