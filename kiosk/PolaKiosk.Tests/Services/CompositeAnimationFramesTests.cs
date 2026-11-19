using FluentAssertions;
using PolaKiosk.Services;
using SkiaSharp;

namespace PolaKiosk.Tests.Services;

/// <summary>Images de l'animation du GIF (LAB-237) : une par photo, toutes les zones, décor du cadre.</summary>
public class CompositeAnimationFramesTests
{
    private static readonly SKColor[] Colors = [new(220, 30, 30), new(30, 180, 30), new(30, 30, 220), new(230, 200, 20)];
    private static readonly SKColor DecorColor = new(120, 0, 120);

    [Theory]
    [InlineData("portrait", 1080, 720, 1080)]
    [InlineData("landscape", 1080, 1080, 720)]
    [InlineData("stripV", 1080, 360, 1080)]
    [InlineData("stripH", 1080, 1080, 360)]
    [InlineData("portrait", 100000, 2400, 3600)] // jamais agrandie au-delà du montage
    public void Frame_size_is_the_export_size_scaled_down_to_the_long_side(string format, int maxLongSide, int w, int h)
        => CompositeService.AnimationFrameSize(format, maxLongSide).Should().Be((w, h));

    [Fact]
    public async Task Each_frame_shows_its_own_photo_in_every_zone_under_the_decor()
    {
        using var dir = new TempDir();
        var photos = Colors.Select((c, i) => WriteImage(dir.File($"photo{i}.jpg"), 600, 400, c, SKEncodedImageFormat.Jpeg)).ToList();
        // Décor 400×600 (canvas SaaS) : bandeau opaque en haut, deux trous en dessous.
        var template = dir.File("template.png");
        using (var bmp = new SKBitmap(new SKImageInfo(400, 600, SKColorType.Rgba8888, SKAlphaType.Premul)))
        {
            bmp.Erase(SKColors.Transparent);
            using (var canvas = new SKCanvas(bmp))
            using (var paint = new SKPaint { Color = DecorColor })
                canvas.DrawRect(0, 0, 400, 100, paint);
            Save(bmp, template, SKEncodedImageFormat.Png);
        }
        PhotoZone[] zones = [new(0, 100, 400, 250), new(0, 350, 400, 250)];
        var svc = new CompositeService();

        var frames = await svc.CreateAnimationFramesAsync(photos, template, zones, "portrait", 300);
        try
        {
            frames.Should().HaveCount(4);
            for (int i = 0; i < frames.Count; i++)
            {
                var f = frames[i];
                (f.Width, f.Height).Should().Be((200, 300));
                IsClose(f.GetPixel(100, 20), DecorColor).Should().BeTrue("le décor est dessiné sur chaque image");
                IsClose(f.GetPixel(100, 110), Colors[i]).Should().BeTrue("la photo {0} remplit la première zone", i);
                IsClose(f.GetPixel(100, 240), Colors[i]).Should().BeTrue("la photo {0} remplit aussi la seconde zone", i);
            }
        }
        finally
        {
            foreach (var f in frames) f.Dispose();
        }
    }

    [Fact]
    public async Task Without_zone_or_template_the_photo_fills_the_frame()
    {
        using var dir = new TempDir();
        var photo = WriteImage(dir.File("photo.jpg"), 300, 200, Colors[0], SKEncodedImageFormat.Jpeg);
        var svc = new CompositeService();

        var frames = await svc.CreateAnimationFramesAsync([photo], null, [], "landscape", 240);
        try
        {
            frames.Should().ContainSingle();
            (frames[0].Width, frames[0].Height).Should().Be((240, 160));
            IsClose(frames[0].GetPixel(2, 2), Colors[0]).Should().BeTrue();
            IsClose(frames[0].GetPixel(120, 80), Colors[0]).Should().BeTrue();
        }
        finally
        {
            foreach (var f in frames) f.Dispose();
        }
    }

    [Fact]
    public async Task No_photo_is_an_error()
    {
        var svc = new CompositeService();
        await svc.Invoking(s => s.CreateAnimationFramesAsync([], null, [], "portrait", 300))
            .Should().ThrowAsync<ArgumentException>();
    }

    [Fact]
    public async Task An_unreadable_photo_is_an_error()
    {
        using var dir = new TempDir();
        var good = WriteImage(dir.File("photo.jpg"), 300, 200, Colors[0], SKEncodedImageFormat.Jpeg);
        var bad = dir.File("bad.jpg");
        File.WriteAllText(bad, "pas une image");
        var svc = new CompositeService();

        await svc.Invoking(s => s.CreateAnimationFramesAsync([good, bad], null, [], "portrait", 300))
            .Should().ThrowAsync<Exception>();
    }

    private static string WriteImage(string path, int w, int h, SKColor color, SKEncodedImageFormat format)
    {
        using var bmp = new SKBitmap(w, h);
        bmp.Erase(color);
        Save(bmp, path, format);
        return path;
    }

    private static void Save(SKBitmap bmp, string path, SKEncodedImageFormat format)
    {
        using var data = bmp.Encode(format, 95);
        File.WriteAllBytes(path, data.ToArray());
    }

    private static bool IsClose(SKColor actual, SKColor expected) =>
        Math.Abs(actual.Red - expected.Red) < 40
        && Math.Abs(actual.Green - expected.Green) < 40
        && Math.Abs(actual.Blue - expected.Blue) < 40;
}
