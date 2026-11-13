using System.Windows.Media;
using System.Windows.Media.Imaging;
using FluentAssertions;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Galerie virtualisée : une vignette n'est en mémoire que tant qu'une carte l'affiche.</summary>
public class GalleryPhotoTests
{
    [Fact]
    public async Task Thumbnail_is_loaded_once_while_shown_and_released_when_no_card_shows_it()
    {
        var loads = 0;
        var bitmap = Bitmap(320, 640);
        var photo = new GalleryPhoto("a.jpg", _ => { Interlocked.Increment(ref loads); return bitmap; });

        await photo.AddViewerAsync();
        await photo.AddViewerAsync();
        photo.Thumb.Should().BeSameAs(bitmap);
        loads.Should().Be(1);
        photo.ImageHeight.Should().Be(GalleryViewModel.DisplayWidth * 2.0);

        photo.RemoveViewer();
        photo.Thumb.Should().NotBeNull();
        photo.RemoveViewer();
        photo.Thumb.Should().BeNull();
        photo.RemoveViewer();
        photo.Thumb.Should().BeNull();
    }

    [Fact]
    public async Task A_card_removed_while_loading_does_not_keep_the_thumbnail()
    {
        var gate = new TaskCompletionSource();
        var photo = new GalleryPhoto("a.jpg", _ => { gate.Task.Wait(); return Bitmap(10, 10); });

        var loading = photo.AddViewerAsync();
        photo.RemoveViewer();
        gate.SetResult();
        await loading;

        photo.Thumb.Should().BeNull();
    }

    [Fact]
    public void ToRows_splits_photos_by_column_count()
    {
        var photos = Enumerable.Range(0, 7).Select(i => new GalleryPhoto($"{i}.jpg", _ => null)).ToList();

        var rows = GalleryViewModel.ToRows(photos, 3);

        rows.Select(r => r.Photos.Count).Should().Equal(3, 3, 1);
        rows.SelectMany(r => r.Photos).Should().Equal(photos);
        GalleryViewModel.ToRows(photos, 0).Should().HaveCount(7);
    }

    private static BitmapSource Bitmap(int w, int h)
    {
        var bmp = BitmapSource.Create(w, h, 96, 96, PixelFormats.Gray8, null, new byte[w * h], w);
        bmp.Freeze();
        return bmp;
    }
}
