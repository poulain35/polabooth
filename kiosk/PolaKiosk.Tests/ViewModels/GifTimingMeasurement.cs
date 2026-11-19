using System.Diagnostics;
using FluentAssertions;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;
using SkiaSharp;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>
/// Mesure du délai entre la dernière photo et l'animation prête (LAB-237, critère « moins de 5 s ») :
/// photos de la caméra simulée, vrai montage, vrai ffmpeg. Lancée à la main seulement (ffmpeg.exe
/// est gitignoré) : <c>dotnet test kiosk/PolaKiosk.slnx --filter GifTimingMeasurement -- xUnit.Explicit=only</c>.
/// </summary>
public sealed class GifTimingMeasurement(ITestOutputHelper output)
{
    [Theory(Explicit = true)]
    [InlineData(4, MockCameraService.PhotoWidth, MockCameraService.PhotoHeight)]
    [InlineData(6, MockCameraService.PhotoWidth, MockCameraService.PhotoHeight)]
    [InlineData(4, 3984, 2656)] // taille des photos M du Canon
    public async Task Animation_is_ready_quickly_after_the_last_photo(int shots, int photoWidth, int photoHeight)
    {
        var ffmpeg = new FfmpegRunner();
        Assert.SkipUnless(ffmpeg.IsAvailable, "ffmpeg.exe absent : lancer scripts/fetch-ffmpeg.ps1");
        using var dir = new TempDir();
        var log = new Mock<IKioskLogService>();
        var animation = new AnimationService(ffmpeg, log.Object);
        (await animation.GetEncoderStatusAsync(ct: TestContext.Current.CancellationToken)).IsReady
            .Should().BeTrue("contrôle fait au démarrage de la borne");

        // Cadre portrait 2400×3600 : bandeaux opaques, une zone photo transparente.
        var png = dir.File("cadre.png");
        using (var decor = new SKBitmap(new SKImageInfo(2400, 3600, SKColorType.Rgba8888, SKAlphaType.Premul)))
        {
            decor.Erase(SKColors.Transparent);
            using (var canvas = new SKCanvas(decor))
            using (var paint = new SKPaint { Color = new SKColor(40, 70, 50) })
            {
                canvas.DrawRect(0, 0, 2400, 420, paint);
                canvas.DrawRect(0, 3000, 2400, 600, paint);
            }
            using var data = decor.Encode(SKEncodedImageFormat.Png, 100);
            File.WriteAllBytes(png, data.ToArray());
        }
        var template = new TemplateEntity { Id = Guid.NewGuid(), Format = "portrait", ThumbnailPath = png, CanvasJson = """{"objects":[{"type":"rect","left":20,"top":70,"width":360,"height":430,"isPhotoZone":true}]}""" };
        var composite = new CompositeService(log.Object);

        var composites = Path.Combine(dir.Path, "event", "composites");
        Directory.CreateDirectory(composites);
        var photos = Enumerable.Range(1, shots).Select(i => WritePhoto(dir.File($"p{i}.jpg"), i, photoWidth, photoHeight)).ToList();
        var finisher = new CaptureFinisher(new Mock<ISyncService>().Object, composite, log.Object,
            new Mock<ISessionService>().Object, new Mock<INetworkMonitorService>().Object, null, animation);

        var watch = Stopwatch.StartNew();
        var result = await finisher.FinishCaptureAsync(new CaptureContext(
            Guid.NewGuid(), DateTime.UtcNow, Guid.NewGuid(), "Mesure", null, template, "portrait", photos,
            composites, false, false, "ABC123", "DNP", Format: CaptureFormat.Gif), TestContext.Current.CancellationToken);
        watch.Stop();

        result.Animation.Should().NotBeNull();
        var info = log.Invocations.Where(i => i.Method.Name == nameof(IKioskLogService.LogInfoAsync))
            .Select(i => (string)i.Arguments[1]!).Where(m => m.StartsWith("Animation prête")).ToList();
        output.WriteLine($"{shots} photos {photoWidth}×{photoHeight} : {watch.ElapsedMilliseconds} ms, " +
            $"clip {result.Animation!.Width}×{result.Animation.Height}, {new FileInfo(result.Animation.VideoPath).Length / 1024} Ko. {string.Join(" ", info)}");
        watch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(5));
    }

    private static string WritePhoto(string path, int shot, int w, int h)
    {
        if (w == MockCameraService.PhotoWidth && h == MockCameraService.PhotoHeight)
        {
            MockCameraService.WritePhoto(path, shot);
            return path;
        }
        using var bitmap = new SKBitmap(w, h);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColor.FromHsl(shot * 67 % 360, 45, 70));
            using var paint = new SKPaint { Color = SKColor.FromHsl((shot * 67 + 180) % 360, 55, 40), IsAntialias = true };
            canvas.DrawCircle(w * (0.25f + 0.5f * (shot % 4) / 3f), h / 2f, h / 4f, paint);
        }
        using var data = KioskJpeg.Encode(bitmap, 90)!;
        using var file = File.Create(path);
        data.SaveTo(file);
        return path;
    }
}
