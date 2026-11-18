using System.IO.Compression;
using FluentAssertions;
using Moq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-394 : .pola borné à la décompression, fond de l'écran de saisie mis en cache.
public sealed class SyncServiceLimitsTests : IDisposable
{
    private const string SetupBgUrl = "https://projet.supabase.co/storage/v1/object/public/kiosk-backgrounds/default/fond.jpg";

    private readonly TestKiosk _kiosk = new();

    public void Dispose() => _kiosk.Dispose();

    private SyncService NewService(long? maxPolaBytes = null)
    {
        var service = _kiosk.NewService();
        if (maxPolaBytes is { } max) service.MaxPolaBytes = max;
        return service;
    }

    /// <summary>Faux .pola : des zéros, quelques Ko compressés pour plusieurs Mo décompressés.</summary>
    private static void WriteZeroBomb(string path, int decompressedBytes)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var file = File.Create(path);
        using var gzip = new GZipStream(file, CompressionLevel.SmallestSize);
        gzip.Write(new byte[decompressedBytes]);
    }

    private void AssertNothingImported()
    {
        using var ctx = _kiosk.Db.NewContext();
        ctx.Events.Should().BeEmpty();
        ctx.Templates.Should().BeEmpty();
        _kiosk.DataFiles().Should().BeEmpty();
    }

    [Fact]
    public void The_pola_limit_is_300_mb()
        => SyncService.DefaultMaxPolaBytes.Should().Be(300L * 1024 * 1024);

    [Fact]
    public async Task A_pola_too_large_once_decompressed_is_refused_with_a_message()
    {
        using var usb = new TempDir();
        WriteZeroBomb(usb.File("piege.pola"), 2 * 1024 * 1024);
        new FileInfo(usb.File("piege.pola")).Length.Should().BeLessThan(64 * 1024);

        var act = () => NewService(maxPolaBytes: 1024 * 1024).ImportPolaFileAsync(usb.File("piege.pola"));

        (await act.Should().ThrowAsync<FileTooLargeException>()).WithMessage(PolaBundle.TooLargeMessage);
        AssertNothingImported();
    }

    [Fact]
    public async Task A_pola_under_the_limit_is_imported()
    {
        using var usb = new TempDir();
        PolaFixture.Write(usb.File("mariage.pola"), PolaFixture.Bundle());

        var ev = await NewService(maxPolaBytes: 1024 * 1024).ImportPolaFileAsync(usb.File("mariage.pola"));

        ev.Id.Should().Be(PolaFixture.EventId);
    }

    [Fact]
    public async Task Without_network_an_oversized_pola_is_skipped()
    {
        WriteZeroBomb(_kiosk.PolaPath("piege.pola"), 2 * 1024 * 1024);
        _kiosk.Supabase.Setup(s => s.GetEventByCodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                       .ThrowsAsync(new HttpRequestException("Hôte inaccessible"));

        var ev = await NewService(maxPolaBytes: 1024 * 1024).SyncByCodeAsync(PolaFixture.Code, TestContext.Current.CancellationToken);

        ev.Should().BeNull();
        _kiosk.Log.Verify(l => l.LogWarningAsync("sync-pola",
            It.Is<string>(m => m.Contains("piege.pola") && m.Contains(PolaBundle.TooLargeMessage))), Times.Once);
    }

    [Fact]
    public async Task Decompression_stops_at_the_limit()
    {
        using var dir = new TempDir();
        WriteZeroBomb(dir.File("a.pola"), 4096);

        (await SyncService.DecompressPolaFileAsync(dir.File("a.pola"), 4096)).Should().HaveLength(4096);
        var act = () => SyncService.DecompressPolaFileAsync(dir.File("a.pola"), 4095);
        await act.Should().ThrowAsync<FileTooLargeException>();
    }

    // ── Fond de l'écran de saisie (LAB-394) ───────────────────────────────────

    private void ServerHas(string configJson, byte[]? background = null)
    {
        _kiosk.Supabase.Setup(s => s.DownloadAssetAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns((string url, string path, CancellationToken _) =>
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                if (url.EndsWith("setup_config.json")) File.WriteAllText(path, configJson);
                else if (url == SetupBgUrl && background != null) File.WriteAllBytes(path, background);
                else throw new HttpRequestException("404");
                return Task.CompletedTask;
            });
    }

    private static string ImageConfig(string url) => $$"""{"bg_type":"image","bg_image_url":"{{url}}"}""";

    [Fact]
    public async Task The_setup_background_is_downloaded_into_the_cache()
    {
        ServerHas(ImageConfig(SetupBgUrl), [1, 2, 3]);
        var service = NewService();

        service.GetSetupBackgroundPath().Should().BeNull();
        await service.SyncSetupConfigAsync(TestContext.Current.CancellationToken);

        var path = service.GetSetupBackgroundPath();
        path.Should().NotBeNull();
        path.Should().StartWith(Path.Combine(_kiosk.Dir.Path, "setup_bg"));
        File.ReadAllBytes(path!).Should().Equal(1, 2, 3);
    }

    [Fact]
    public async Task The_setup_background_is_downloaded_only_once()
    {
        ServerHas(ImageConfig(SetupBgUrl), [1, 2, 3]);
        var service = NewService();

        await service.SyncSetupConfigAsync(TestContext.Current.CancellationToken);
        await service.SyncSetupConfigAsync(TestContext.Current.CancellationToken);

        _kiosk.Supabase.Verify(s => s.DownloadAssetAsync(SetupBgUrl, It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task A_new_setup_background_replaces_the_old_one()
    {
        ServerHas(ImageConfig(SetupBgUrl), [1, 2, 3]);
        var service = NewService();
        await service.SyncSetupConfigAsync(TestContext.Current.CancellationToken);
        var old = service.GetSetupBackgroundPath()!;

        const string newUrl = SetupBgUrl + "?v=2";
        _kiosk.Supabase.Setup(s => s.DownloadAssetAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns((string url, string path, CancellationToken _) =>
            {
                if (url.EndsWith("setup_config.json")) File.WriteAllText(path, ImageConfig(newUrl));
                else File.WriteAllBytes(path, [4, 5]);
                return Task.CompletedTask;
            });
        await service.SyncSetupConfigAsync(TestContext.Current.CancellationToken);

        File.ReadAllBytes(service.GetSetupBackgroundPath()!).Should().Equal(4, 5);
        File.Exists(old).Should().BeFalse();
    }

    [Theory]
    [InlineData("""{"bg_type":"color","bg_image_url":"https://projet.supabase.co/fond.jpg"}""")]
    [InlineData("""{"bg_type":"image","bg_image_url":""}""")]
    [InlineData("pas du JSON")]
    public async Task Without_an_image_config_there_is_no_setup_background(string configJson)
    {
        ServerHas(configJson);
        var service = NewService();

        await service.SyncSetupConfigAsync(TestContext.Current.CancellationToken);

        service.GetSetupBackgroundPath().Should().BeNull();
    }

    [Fact]
    public async Task A_failed_background_download_does_not_break_the_sync()
    {
        ServerHas(ImageConfig(SetupBgUrl));
        var service = NewService();

        await service.SyncSetupConfigAsync(TestContext.Current.CancellationToken);

        service.GetSetupBackgroundPath().Should().BeNull();
        _kiosk.Log.Verify(l => l.LogWarningAsync("sync-background", It.Is<string>(m => m.Contains("écran de saisie"))),
            Times.Once);
    }
}
