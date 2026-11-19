using System.IO;
using FluentAssertions;
using Moq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Série de prises du GIF (LAB-237) : même boucle pour le Canon, la webcam et la simulation.</summary>
public sealed class CameraSequenceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "polakiosk-seq-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { /* dossier temporaire */ }
    }

    [Fact]
    public async Task Shots_are_taken_in_order_between_their_hooks()
    {
        var camera = new Mock<ICameraService>();
        var log = new List<string>();
        int n = 0;
        camera.Setup(c => c.CaptureAsync("out")).ReturnsAsync(() => { log.Add("prise"); return $"p{++n}.jpg"; });

        var paths = await camera.Object.CaptureSequenceAsync("out", 3,
            (shot, _) => { log.Add($"avant {shot}"); return Task.CompletedTask; },
            (shot, path, _) => { log.Add($"après {shot} {path}"); return Task.CompletedTask; },
            CancellationToken.None);

        paths.Should().Equal("p1.jpg", "p2.jpg", "p3.jpg");
        log.Should().Equal("avant 1", "prise", "après 1 p1.jpg", "avant 2", "prise", "après 2 p2.jpg",
            "avant 3", "prise", "après 3 p3.jpg");
    }

    [Fact]
    public async Task A_failed_shot_or_a_cancel_stops_the_series()
    {
        var camera = new Mock<ICameraService>();
        camera.SetupSequence(c => c.CaptureAsync(It.IsAny<string>()))
              .ReturnsAsync("p1.jpg")
              .ThrowsAsync(new TimeoutException());

        var failed = () => camera.Object.CaptureSequenceAsync("out", 4,
            (_, _) => Task.CompletedTask, (_, _, _) => Task.CompletedTask, CancellationToken.None);
        await failed.Should().ThrowAsync<TimeoutException>();
        camera.Verify(c => c.CaptureAsync(It.IsAny<string>()), Times.Exactly(2));

        using var cts = new CancellationTokenSource();
        var canceled = () => camera.Object.CaptureSequenceAsync("out", 4,
            (_, _) => { cts.Cancel(); return Task.CompletedTask; }, (_, _, _) => Task.CompletedTask, cts.Token);
        await canceled.Should().ThrowAsync<OperationCanceledException>();
        camera.Verify(c => c.CaptureAsync(It.IsAny<string>()), Times.Exactly(2)); // aucune prise après l'annulation
    }

    [Fact]
    public async Task The_simulated_camera_writes_distinct_real_photos()
    {
        var camera = new MockCameraService();

        var paths = await camera.CaptureSequenceAsync(_dir, 2,
            (_, _) => Task.CompletedTask, (_, _, _) => Task.CompletedTask, CancellationToken.None);

        paths.Should().HaveCount(2).And.OnlyContain(p => File.Exists(p));
        using (var first = SkiaSharp.SKBitmap.Decode(paths[0]))
        {
            first.Width.Should().Be(MockCameraService.PhotoWidth);
            first.Height.Should().Be(MockCameraService.PhotoHeight);
        }
        File.ReadAllBytes(paths[0]).Should().NotEqual(File.ReadAllBytes(paths[1]));
    }
}
