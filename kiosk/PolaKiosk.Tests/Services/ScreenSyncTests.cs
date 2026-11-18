using System.IO;
using FluentAssertions;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Services;
using SkiaSharp;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// LAB-297 : cache des écrans composés (screens\{kind}\), rempli par la synchro (kiosk_get_screens)
/// ou par le bloc « screens » du .pola. Téléchargements simulés, vraies images PNG.
/// </summary>
public class ScreenSyncTests : IDisposable
{
    private static readonly Guid EventId = PolaFixture.EventId;
    private const string Base = "https://projet.supabase.co/storage/v1/object/public/kiosk-backgrounds/org/abc/";

    private readonly TestKiosk _kiosk = new();
    private readonly Dictionary<string, byte[]> _remote = new(StringComparer.Ordinal);
    private readonly List<string> _downloads = [];

    public ScreenSyncTests()
    {
        _kiosk.Supabase.Setup(s => s.GetEventByCodeAsync(PolaFixture.Code, It.IsAny<CancellationToken>()))
              .ReturnsAsync(SupabaseRpcResponses.ParseEventRpcResponse(PolaFixture.Event().ToString()));
        _kiosk.Supabase.Setup(s => s.DownloadAssetAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .Returns((string url, string path, CancellationToken _) =>
              {
                  if (!url.StartsWith(Base, StringComparison.Ordinal)) return Task.CompletedTask; // fond, design, logo : hors sujet
                  _downloads.Add(url);
                  if (!_remote.TryGetValue(url, out var bytes)) throw new HttpRequestException("404");
                  Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                  return File.WriteAllBytesAsync(path, bytes);
              });
    }

    public void Dispose() => _kiosk.Dispose();

    // ── Plans et images ───────────────────────────────────────────────────────

    private static byte[] Png(SKColor color)
    {
        using var bitmap = new SKBitmap(8, 6);
        bitmap.Erase(color);
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    private static string Url(string name) => Base + name + "?v=1";

    private static JObject HomePlan(int version, bool withUnknownButton = false)
    {
        var plan = HomePlanCore(version);
        if (withUnknownButton)
            ((JArray)plan["buttons"]!).Add(new JObject { ["action"] = "dance", ["x"] = 0, ["y"] = 0, ["w"] = 10, ["h"] = 10, ["image"] = Url("ignored.png") });
        return plan;
    }

    private static JObject HomePlanCore(int version) => new()
    {
        ["version"] = version,
        ["kind"] = "home",
        ["size"] = new JObject { ["w"] = 1920, ["h"] = 1080 },
        ["background"] = Url($"screen-home-v{version}-bg.png"),
        ["background_neutral"] = Url($"screen-home-v{version}-bg-neutral.png"),
        ["transparent_background"] = false,
        ["buttons"] = new JArray(
            new JObject { ["action"] = "start", ["x"] = 660, ["y"] = 820, ["w"] = 600, ["h"] = 160, ["image"] = Url($"screen-home-v{version}-btn-start.png") }),
        ["texts"] = new JArray(),
        ["slots"] = new JArray(),
        ["published_at"] = "2026-11-15T10:00:00Z",
    };

    // LAB-331 : un texte vivant dans une police Google, publiée à côté des images.
    private static JObject HomePlanWithFont(int version)
    {
        var plan = HomePlanCore(version);
        plan["texts"] = new JArray(new JObject
        {
            ["variable"] = "event_name", ["x"] = 360, ["y"] = 420, ["w"] = 1200, ["h"] = 220,
            ["font"] = "Pacifico", ["weight"] = 400, ["font_file"] = Url($"screen-home-v{version}-font-0.ttf"),
        });
        return plan;
    }

    private static readonly Lazy<byte[]> FontBytes = new(() =>
        File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "fonts", "Fraunces72ptSuperSoft-SemiBold.ttf")));

    private static JObject ResultPlan(int version) => new()
    {
        ["version"] = version,
        ["kind"] = "result",
        ["size"] = new JObject { ["w"] = 1920, ["h"] = 1080 },
        ["background"] = Url($"screen-result-v{version}-bg.png"),
        ["buttons"] = new JArray(
            new JObject { ["action"] = "print", ["x"] = 1180, ["y"] = 420, ["w"] = 420, ["h"] = 120, ["image"] = Url($"screen-result-v{version}-btn-print.png") }),
    };

    private void Publish(JObject? home, JObject? result, bool withImages = true)
    {
        _kiosk.Supabase.Setup(s => s.GetScreensAsync(EventId, It.IsAny<CancellationToken>()))
              .ReturnsAsync(new PublishedScreens(home, result));
        if (!withImages) return;
        foreach (var plan in new[] { home, result }.OfType<JObject>())
        {
            foreach (var url in ScreenLayout.Parse(plan)?.ImageNames() ?? [])
                _remote[url] = Png(SKColors.Coral);
            foreach (var url in ScreenLayout.Parse(plan)?.FontFileNames() ?? [])
                _remote[url] = FontBytes.Value;
        }
    }

    private async Task SyncAsync()
    {
        // Le premier passage par le code d'accès garde l'événement en local ; SyncAsync relit ensuite par ce code.
        await _kiosk.NewService().SyncByCodeAsync(PolaFixture.Code, TestContext.Current.CancellationToken);
    }

    private CachedScreen? Cached(string kind) => _kiosk.NewService().GetScreen(kind);

    private string ScreensDir => Path.Combine(_kiosk.Dir.Path, "screens");

    private void VerifyScreensWarning(Times times)
        => _kiosk.Log.Verify(l => l.LogWarningAsync("screens", It.IsAny<string>()), times);

    // ── Synchro en ligne ──────────────────────────────────────────────────────

    [Fact]
    public async Task A_published_screen_is_cached_with_local_file_names()
    {
        Publish(HomePlan(3, withUnknownButton: true), ResultPlan(5));

        await SyncAsync();

        var home = Cached(ScreenLayout.KindHome)!;
        home.Layout.Version.Should().Be(3);
        home.Directory.Should().Be(Path.Combine(ScreensDir, "home"));
        home.Layout.Background.Should().Be("screen-home-v3-bg.png", "l'adresse est remplacée par le nom du fichier local");
        home.Layout.BackgroundNeutral.Should().Be("screen-home-v3-bg-neutral.png");
        home.Layout.Buttons.Should().ContainSingle().Which.Image.Should().Be("screen-home-v3-btn-start.png");
        home.Layout.ImageNames().Should().OnlyContain(n => File.Exists(Path.Combine(home.Directory, n)));

        Cached(ScreenLayout.KindResult)!.Layout.Buttons.Single().Image.Should().Be("screen-result-v5-btn-print.png");
        _downloads.Should().NotContain(Url("ignored.png"), "un bouton ignoré n'est pas téléchargé");
        Directory.GetDirectories(ScreensDir).Select(Path.GetFileName).Should().BeEquivalentTo(["home", "result"], "aucun dossier temporaire ne reste");
        _kiosk.Log.Verify(l => l.LogWarningAsync("screens", It.Is<string>(m => m.Contains("dance"))), Times.Once,
            "la valeur inconnue est journalisée");
    }

    [Fact]
    public async Task The_same_version_is_not_downloaded_again()
    {
        Publish(HomePlan(3), null);
        await SyncAsync();
        var first = _downloads.Count;

        await SyncAsync();

        first.Should().Be(3);
        _downloads.Should().HaveCount(first);
        Cached(ScreenLayout.KindHome)!.Layout.Version.Should().Be(3);
    }

    [Fact]
    public async Task A_new_version_replaces_the_previous_one()
    {
        Publish(HomePlan(3), null);
        await SyncAsync();

        Publish(HomePlan(4), null);
        await SyncAsync();

        var home = Cached(ScreenLayout.KindHome)!;
        home.Layout.Version.Should().Be(4);
        Directory.GetFiles(home.Directory).Select(Path.GetFileName).Should().NotContain(n => n!.Contains("-v3-"), "l'ancienne version est supprimée");
    }

    [Fact]
    public async Task Nothing_published_clears_the_cache()
    {
        Publish(HomePlan(3), ResultPlan(5));
        await SyncAsync();

        Publish(null, ResultPlan(5));
        await SyncAsync();

        Cached(ScreenLayout.KindHome).Should().BeNull();
        Directory.Exists(Path.Combine(ScreensDir, "home")).Should().BeFalse();
        Cached(ScreenLayout.KindResult).Should().NotBeNull("le partage reste publié");
    }

    [Fact]
    public async Task Unpublishing_both_screens_gives_the_standard_screens_and_forgets_the_cache()
    {
        Publish(HomePlan(3), ResultPlan(5));
        await SyncAsync();

        Publish(null, null);
        await SyncAsync();

        Cached(ScreenLayout.KindHome).Should().BeNull();
        Cached(ScreenLayout.KindResult).Should().BeNull();
        Directory.GetDirectories(ScreensDir).Should().BeEmpty("le cache est oublié, rien ne reste");
        VerifyScreensWarning(Times.Never());
    }

    [Fact]
    public async Task Unpublishing_clears_the_cache_even_when_an_image_is_held_open()
    {
        Publish(HomePlan(3), null);
        await SyncAsync();

        // Un antivirus ou un indexeur tient une image : le dossier ne peut pas être supprimé en entier.
        var held = Path.Combine(ScreensDir, "home", "screen-home-v3-bg.png");
        using (new FileStream(held, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            Publish(null, null);
            await SyncAsync();

            Cached(ScreenLayout.KindHome).Should().BeNull("l'écran dépublié ne doit plus s'afficher");
        }

        await SyncAsync();
        Directory.Exists(Path.Combine(ScreensDir, "home")).Should().BeFalse("le reste part à la synchro suivante");
    }

    [Fact]
    public async Task Republishing_after_an_unpublish_downloads_again()
    {
        Publish(HomePlan(3), null);
        await SyncAsync();
        Publish(null, null);
        await SyncAsync();

        Publish(HomePlan(3), null);
        await SyncAsync();

        Cached(ScreenLayout.KindHome)!.Layout.Version.Should().Be(3);
        _downloads.Should().HaveCount(6, "la même version est retéléchargée après la dépublication");
    }

    [Fact]
    public async Task A_partial_download_keeps_the_previous_version()
    {
        Publish(HomePlan(3), null);
        await SyncAsync();

        Publish(HomePlan(4), null, withImages: false);
        _remote[Url("screen-home-v4-bg.png")] = Png(SKColors.Teal); // le reste manque (404)
        await SyncAsync();

        Cached(ScreenLayout.KindHome)!.Layout.Version.Should().Be(3);
        VerifyScreensWarning(Times.AtLeastOnce());
        Directory.GetDirectories(ScreensDir).Select(Path.GetFileName).Should().BeEquivalentTo(["home"]);
    }

    [Fact]
    public async Task An_unreadable_image_without_any_version_gives_the_standard_screen()
    {
        Publish(HomePlan(3), null);
        _remote[Url("screen-home-v3-btn-start.png")] = "<html>pas une image</html>"u8.ToArray();

        await SyncAsync();

        Cached(ScreenLayout.KindHome).Should().BeNull();
        _kiosk.Log.Verify(l => l.LogWarningAsync("screens", It.Is<string>(m => m.Contains("illisible") && m.Contains("standard"))), Times.Once);
        (Directory.Exists(ScreensDir) ? Directory.GetDirectories(ScreensDir) : []).Should().BeEmpty("aucun dossier temporaire ne reste");
    }

    [Fact]
    public async Task A_failed_read_of_the_screens_keeps_the_cache()
    {
        Publish(HomePlan(3), null);
        await SyncAsync();

        _kiosk.Supabase.Setup(s => s.GetScreensAsync(EventId, It.IsAny<CancellationToken>()))
              .ThrowsAsync(new HttpRequestException("pas de réseau"));
        await SyncAsync();

        Cached(ScreenLayout.KindHome)!.Layout.Version.Should().Be(3);
        VerifyScreensWarning(Times.Once());
    }

    [Fact]
    public async Task A_refused_plan_keeps_the_previous_version()
    {
        Publish(HomePlan(3), null);
        await SyncAsync();

        var refused = HomePlan(4);
        refused["size"] = new JObject { ["w"] = 1280, ["h"] = 800 };
        Publish(refused, null);
        await SyncAsync();

        Cached(ScreenLayout.KindHome)!.Layout.Version.Should().Be(3);
        VerifyScreensWarning(Times.Once());
    }

    [Fact]
    public async Task A_damaged_cache_gives_the_standard_screen_then_is_downloaded_again()
    {
        Publish(HomePlan(3), null);
        await SyncAsync();
        File.Delete(Path.Combine(ScreensDir, "home", "screen-home-v3-bg.png"));

        Cached(ScreenLayout.KindHome).Should().BeNull("une image manque");

        await SyncAsync();
        Cached(ScreenLayout.KindHome)!.Layout.Version.Should().Be(3);
    }

    [Fact]
    public async Task Leftovers_of_an_interrupted_sync_are_removed()
    {
        Directory.CreateDirectory(Path.Combine(ScreensDir, "home.tmp-0123"));
        Directory.CreateDirectory(Path.Combine(ScreensDir, "home.old-4567"));
        Publish(HomePlan(3), null);

        await SyncAsync();

        Directory.GetDirectories(ScreensDir).Select(Path.GetFileName).Should().BeEquivalentTo(["home"]);
    }

    // ── Polices des textes vivants (LAB-331) ──────────────────────────────────

    private void VerifyFontWarning(string fragment, Times times)
        => _kiosk.Log.Verify(l => l.LogWarningAsync("screens", It.Is<string>(m => m.Contains(fragment) && m.Contains("DM Sans"))), times);

    [Fact]
    public async Task A_font_is_downloaded_with_the_images_and_loaded_by_the_screen()
    {
        Publish(HomePlanWithFont(3), null);

        await SyncAsync();

        var home = Cached(ScreenLayout.KindHome)!;
        var text = home.Layout.Texts.Single();
        text.FontFile.Should().Be("screen-home-v3-font-0.ttf", "l'adresse est remplacée par le nom du fichier local");
        File.ReadAllBytes(Path.Combine(home.Directory, text.FontFile!)).Should().Equal(FontBytes.Value);
        var content = ScreenContent.Load(home, out var error)!;
        error.Should().BeNull();
        content.FontWarnings.Should().BeEmpty();
        content.FontFor(text).Family.Should().NotBe(KioskFonts.Text);
        VerifyScreensWarning(Times.Never());
    }

    [Fact]
    public async Task A_font_that_fails_to_download_keeps_the_screen_then_is_asked_again()
    {
        Publish(HomePlanWithFont(3), null);
        _remote.Remove(Url("screen-home-v3-font-0.ttf"));

        await SyncAsync();

        var home = Cached(ScreenLayout.KindHome)!;
        home.Layout.Version.Should().Be(3, "une police manquante n'empêche pas l'écran");
        home.Layout.Texts.Single().FontFile.Should().Be("screen-home-v3-font-0.ttf");
        File.Exists(Path.Combine(home.Directory, "screen-home-v3-font-0.ttf")).Should().BeFalse();
        ScreenContent.Load(home, out _)!.FontFor(home.Layout.Texts.Single()).Should().Be(new ScreenFont(KioskFonts.Text, 400));
        VerifyFontWarning("police non récupérée (screen-home-v3-font-0.ttf)", Times.Once());

        _remote[Url("screen-home-v3-font-0.ttf")] = FontBytes.Value;
        await SyncAsync();

        File.Exists(Path.Combine(Cached(ScreenLayout.KindHome)!.Directory, "screen-home-v3-font-0.ttf"))
            .Should().BeTrue("la synchro suivante redemande la police");
    }

    [Fact]
    public async Task A_downloaded_file_that_is_not_a_font_is_dropped()
    {
        Publish(HomePlanWithFont(3), null);
        _remote[Url("screen-home-v3-font-0.ttf")] = Png(SKColors.Coral);

        await SyncAsync();

        var home = Cached(ScreenLayout.KindHome)!;
        File.Exists(Path.Combine(home.Directory, "screen-home-v3-font-0.ttf")).Should().BeFalse();
        VerifyFontWarning("police illisible (screen-home-v3-font-0.ttf)", Times.Once());
    }

    [Fact]
    public async Task A_pola_brings_the_font_of_its_screens()
    {
        await ImportAsync(BundleWithScreens(HomePlanWithFont(3), null));

        var home = Cached(ScreenLayout.KindHome)!;
        File.ReadAllBytes(Path.Combine(home.Directory, "screen-home-v3-font-0.ttf")).Should().Equal(FontBytes.Value);
        ScreenContent.Load(home, out _)!.FontWarnings.Should().BeEmpty();
    }

    [Fact]
    public async Task A_pola_without_the_font_shows_the_screen_in_dm_sans()
    {
        await ImportAsync(BundleWithScreens(HomePlanWithFont(3), null, embed: url => !url.EndsWith(".ttf?v=1", StringComparison.Ordinal)));

        var home = Cached(ScreenLayout.KindHome)!;
        home.Layout.Version.Should().Be(3);
        ScreenContent.Load(home, out _)!.FontWarnings.Should().ContainSingle();
        VerifyFontWarning("police non récupérée", Times.Once());
    }

    // ── Fichier .pola ─────────────────────────────────────────────────────────

    private JObject BundleWithScreens(JObject? home, JObject? result, Func<string, bool>? embed = null)
    {
        var bundle = PolaFixture.Bundle();
        bundle["screens"] = new JObject { ["home"] = home, ["result"] = result };
        var assets = (JObject)bundle["assets"]!;
        foreach (var plan in new[] { home, result }.OfType<JObject>())
        {
            foreach (var url in ScreenLayout.Parse(plan)!.ImageNames().Where(u => embed?.Invoke(u) ?? true))
                assets[PolaScreens.AssetPrefix + ScreenCache.LastSegment(url)] = Convert.ToBase64String(Png(SKColors.Coral));
            foreach (var url in ScreenLayout.Parse(plan)!.FontFileNames().Where(u => embed?.Invoke(u) ?? true))
                assets[PolaScreens.AssetPrefix + ScreenCache.LastSegment(url)] = Convert.ToBase64String(FontBytes.Value);
        }
        return bundle;
    }

    private Task ImportAsync(JObject bundle)
    {
        var path = _kiosk.PolaPath("import.pola");
        PolaFixture.Write(path, bundle);
        return _kiosk.NewService().ImportPolaFileAsync(path);
    }

    [Fact]
    public void The_screens_block_is_read_and_the_format_stays_at_version_2()
    {
        var bundle = BundleWithScreens(HomePlan(3), null);
        bundle["version"].Should().BeEquivalentTo(new JValue(PolaBundle.FormatVersion));

        var screens = PolaBundle.Parse(bundle.ToString()).Screens!;

        screens.Home!["version"]!.Value<int>().Should().Be(3);
        screens.Result.Should().BeNull();
        screens.Assets.Keys.Should().BeEquivalentTo(
            ["screen-home-v3-bg.png", "screen-home-v3-bg-neutral.png", "screen-home-v3-btn-start.png"]);
        screens.AssetFor(Url("screen-home-v3-bg.png")).Should().NotBeNull("l'asset est retrouvé par le dernier segment de l'adresse");
        PolaBundle.Parse(bundle.ToString()).Design.Should().NotBeNull();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    public void A_pola_without_a_screens_object_has_no_screens(string? block)
    {
        var bundle = PolaFixture.Bundle();
        if (block != null) bundle["screens"] = JToken.Parse(block);

        PolaBundle.Parse(bundle.ToString()).Screens.Should().BeNull();
    }

    [Fact]
    public async Task A_pola_with_screens_works_offline_like_the_online_sync()
    {
        await ImportAsync(BundleWithScreens(HomePlan(3), ResultPlan(5)));

        var home = Cached(ScreenLayout.KindHome)!;
        home.Layout.Background.Should().Be("screen-home-v3-bg.png");
        Cached(ScreenLayout.KindResult)!.Layout.Version.Should().Be(5);
        ScreenContent.Load(home, out var error).Should().NotBeNull(error);

        // Mêmes fichiers que la synchro en ligne du même plan.
        using var online = new TestKiosk();
        online.Supabase.Setup(s => s.GetEventByCodeAsync(PolaFixture.Code, It.IsAny<CancellationToken>()))
              .ReturnsAsync(SupabaseRpcResponses.ParseEventRpcResponse(PolaFixture.Event().ToString()));
        online.Supabase.Setup(s => s.GetScreensAsync(EventId, It.IsAny<CancellationToken>()))
              .ReturnsAsync(new PublishedScreens(HomePlan(3), ResultPlan(5)));
        online.Supabase.Setup(s => s.DownloadAssetAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .Returns((string _, string path, CancellationToken _) =>
              {
                  Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                  return File.WriteAllBytesAsync(path, Png(SKColors.Coral));
              });
        await online.NewService().SyncByCodeAsync(PolaFixture.Code, TestContext.Current.CancellationToken);

        static Dictionary<string, string> Files(string root) => Directory
            .EnumerateFiles(Path.Combine(root, "screens"), "*", SearchOption.AllDirectories)
            .ToDictionary(f => Path.GetRelativePath(root, f), f => Convert.ToBase64String(File.ReadAllBytes(f)));
        Files(_kiosk.Dir.Path).Should().BeEquivalentTo(Files(online.Dir.Path));
    }

    [Fact]
    public async Task A_pola_without_screens_gives_the_standard_screens()
    {
        await ImportAsync(BundleWithScreens(HomePlan(3), ResultPlan(5)));

        await ImportAsync(PolaFixture.Bundle());

        Cached(ScreenLayout.KindHome).Should().BeNull();
        Cached(ScreenLayout.KindResult).Should().BeNull();
    }

    [Fact]
    public async Task A_pola_with_an_unpublished_home_clears_only_the_home()
    {
        await ImportAsync(BundleWithScreens(HomePlan(3), ResultPlan(5)));

        await ImportAsync(BundleWithScreens(null, ResultPlan(5)));

        Cached(ScreenLayout.KindHome).Should().BeNull();
        Directory.Exists(Path.Combine(ScreensDir, "home")).Should().BeFalse();
        Cached(ScreenLayout.KindResult)!.Layout.Version.Should().Be(5);
    }

    [Fact]
    public async Task A_pola_with_an_empty_screens_block_gives_the_standard_screens()
    {
        await ImportAsync(BundleWithScreens(HomePlan(3), ResultPlan(5)));

        await ImportAsync(BundleWithScreens(null, null));

        Cached(ScreenLayout.KindHome).Should().BeNull();
        Cached(ScreenLayout.KindResult).Should().BeNull();
    }

    [Fact]
    public async Task A_pola_missing_an_image_keeps_the_previous_version()
    {
        await ImportAsync(BundleWithScreens(HomePlan(3), null));

        await ImportAsync(BundleWithScreens(HomePlan(4), null, embed: url => !url.Contains("btn-start")));

        Cached(ScreenLayout.KindHome)!.Layout.Version.Should().Be(3);
        VerifyScreensWarning(Times.Once());
    }

    [Fact]
    public async Task A_damaged_screens_asset_does_not_refuse_the_file()
    {
        var bundle = BundleWithScreens(HomePlan(3), null);
        ((JObject)bundle["assets"]!)[PolaScreens.AssetPrefix + "screen-home-v3-bg.png"] = "%%% pas du base64";

        await ImportAsync(bundle);

        Cached(ScreenLayout.KindHome).Should().BeNull();
        using var db = _kiosk.Db.NewContext();
        db.Events.Should().ContainSingle("l'événement est importé quand même");
    }

    // ── Noms des fichiers ─────────────────────────────────────────────────────

    [Theory]
    [InlineData("https://x.example/a/b/screen-home-v3-bg.png?token=1", "screen-home-v3-bg.png")]
    [InlineData("https://x.example/a/b/mon%20fond.png#x", "mon fond.png")]
    [InlineData("screen-home-v3-bg.png", "screen-home-v3-bg.png")]
    public void The_asset_name_is_the_last_segment_of_the_address(string url, string name)
        => ScreenCache.LastSegment(url).Should().Be(name);

    [Fact]
    public void Local_names_are_plain_and_unique()
    {
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        ScreenCache.LocalName("https://a.example/x/bg.png", 0, used).Should().Be("bg.png");
        ScreenCache.LocalName("https://b.example/y/BG.png", 1, used).Should().Be("1-BG.png");
        ScreenCache.LocalName("https://a.example/x/", 2, used).Should().Be("image-2.png");
        ScreenCache.LocalName("https://a.example/x/..", 3, used).Should().Be("image-3.png");
    }
}
