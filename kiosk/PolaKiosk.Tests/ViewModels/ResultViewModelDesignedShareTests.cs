using System.ComponentModel;
using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using FluentAssertions;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Partage composé par l'admin pour l'organisation (LAB-297) : bascule, actions, états et textes.</summary>
public sealed class ResultViewModelDesignedShareTests : IDisposable
{
    private static readonly string[] AllActions = ["print", "copies_minus", "copies_plus", "email", "qr", "retake", "finish"];

    private readonly ResultViewModelHarness _h = new();
    private readonly TempDir _dir = new();

    public ResultViewModelDesignedShareTests() => DesignedShareLoader.ResetWarning();

    public void Dispose() => _dir.Dispose();

    // Plan en cache, avec ses images, comme l'écrit la synchro : un bouton par action.
    private CachedScreen CacheShare(bool brokenBackground = false, bool withPrintStatus = true)
    {
        var dir = Path.Combine(_dir.Path, "screens", "result");
        Directory.CreateDirectory(dir);
        if (brokenBackground) File.WriteAllText(Path.Combine(dir, "bg.png"), "pas une image");
        else WriteImage(Path.Combine(dir, "bg.png"), 192, 108);
        var buttons = new JArray();
        for (var i = 0; i < AllActions.Length; i++)
        {
            WriteImage(Path.Combine(dir, $"{AllActions[i]}.png"), 30, 10);
            buttons.Add(new JObject
            {
                ["action"] = AllActions[i], ["x"] = 1200, ["y"] = 100 + i * 130, ["w"] = 600, ["h"] = 110,
                ["image"] = $"{AllActions[i]}.png",
            });
        }
        var texts = new JArray();
        foreach (var variable in new[] { "copies", "prints_remaining", "print_status", "countdown", "share_status" }
                     .Where(v => withPrintStatus || v != "print_status"))
            texts.Add(new JObject
            {
                ["variable"] = variable, ["x"] = 100, ["y"] = 900, ["w"] = 800, ["h"] = 60, ["angle"] = 0,
                ["font"] = "DM Sans", ["weight"] = 500, ["size"] = 36, ["color"] = "#1B241F", ["align"] = "left",
                ["uppercase"] = false, ["char_spacing"] = 0, ["max_lines"] = 1, ["personalized_only"] = false,
            });
        var plan = new JObject
        {
            ["version"] = 2, ["kind"] = "result", ["size"] = new JObject { ["w"] = 1920, ["h"] = 1080 },
            ["background"] = "bg.png", ["transparent_background"] = false,
            ["buttons"] = buttons, ["texts"] = texts,
            ["slots"] = new JArray(new JObject { ["slot"] = "photo_preview", ["x"] = 120, ["y"] = 100, ["w"] = 900, ["h"] = 760, ["angle"] = 0, ["radius"] = 0 }),
        };
        var screen = new CachedScreen(ScreenLayout.Parse(plan)!, dir);
        _h.Sync.Setup(s => s.GetScreen(ScreenLayout.KindResult)).Returns(screen);
        return screen;
    }

    private static void WriteImage(string path, int width, int height)
    {
        var stride = width * 4;
        var bitmap = BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgr32, null, new byte[stride * height], stride);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var file = File.Create(path);
        encoder.Save(file);
    }

    private void RemainingPrints(params int?[] values)
    {
        var queue = new Queue<int?>(values);
        _h.Print.Setup(p => p.GetRemainingPrintsAsync(It.IsAny<Guid>(), It.IsAny<int?>(), It.IsAny<Guid>(), It.IsAny<int?>()))
                .ReturnsAsync(() => queue.Count > 1 ? queue.Dequeue() : queue.Peek());
    }

    private void VerifyScreenWarnings(Times times)
        => _h.Log.Verify(l => l.LogWarningAsync("screens", It.IsAny<string>()), times);

    private static ResultButtonsConfig Buttons(
        bool retake = true, bool print = true, bool qr = true, bool email = true, bool home = true) => new()
    {
        Retake = new() { Enabled = retake },
        Print  = new() { Enabled = print },
        Qr     = new() { Enabled = qr },
        Email  = new() { Enabled = email },
        Home   = new() { Enabled = home },
    };

    // ── Bascule standard / composé ────────────────────────────────────────

    [Fact]
    public async Task Without_published_screen_the_standard_share_shows_without_warning()
    {
        var result = await _h.OpenAsync();

        result.DesignedShare.Should().BeNull();
        result.ShowStandardShare.Should().BeTrue();
        result.ShowDesignedShare.Should().BeFalse();
        VerifyScreenWarnings(Times.Never());
    }

    [Fact]
    public async Task The_org_screen_replaces_only_the_share_screen()
    {
        CacheShare();
        var result = await _h.OpenAsync();

        result.DesignedShare.Should().NotBeNull();
        result.DesignedShare!.Layout.Version.Should().Be(2);
        result.ShowDesignedShare.Should().BeTrue();
        result.ShowStandardShare.Should().BeFalse();
        result.ShareSlots.Should().ContainKey("photo_preview");
        result.ShareSlots["photo_preview"].Should().BeSameAs(result.CompositeImage);

        result.ShareActionCommand.Execute("qr");
        result.IsQrScreen.Should().BeTrue();
        result.ShowDesignedShare.Should().BeFalse("le QR code reste l'écran standard");
        result.ShowStandardShare.Should().BeFalse();

        result.BackToShareCommand.Execute(null);
        result.ShowDesignedShare.Should().BeTrue();
        VerifyScreenWarnings(Times.Never());
    }

    [Fact]
    public async Task An_unreadable_org_screen_falls_back_to_the_standard_share_and_warns_once()
    {
        CacheShare(brokenBackground: true);

        var result = await _h.OpenAsync();
        await _h.OpenAsync(); // séance suivante

        result.DesignedShare.Should().BeNull();
        result.ShowStandardShare.Should().BeTrue();
        VerifyScreenWarnings(Times.Once());
    }

    [Fact]
    public async Task A_sync_failure_shows_the_standard_share()
    {
        _h.Sync.Setup(s => s.GetScreen(ScreenLayout.KindResult)).Throws(new IOException("disque"));

        var result = await _h.OpenAsync();

        result.ShowStandardShare.Should().BeTrue();
    }

    [Fact]
    public async Task Leaving_the_screen_frees_its_images()
    {
        CacheShare();
        var result = await _h.OpenAsync();

        result.Release();

        result.DesignedShare.Should().BeNull();
    }

    // ── Actions ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Print_and_copies_run_the_print_commands()
    {
        RemainingPrints(5, 3);
        CacheShare();
        var p = ResultViewModelHarness.Parameters();
        var result = await _h.OpenAsync(p);

        result.ShareActionCommand.Execute("copies_plus");
        result.ShareActionCommand.Execute("copies_plus");
        result.ShareActionCommand.Execute("copies_minus");
        result.PrintCopies.Should().Be(2);
        result.ShareTexts["copies"].Should().Be("2");

        result.ShareActionCommand.Execute("print");
        await (result.PrintCommand.ExecutionTask ?? Task.CompletedTask);

        _h.Print.Verify(x => x.PrintAsync(p.CompositePath, p.PrinterName, "4x6", p.SessionId, p.EventId, 2,
            ResultViewModelHarness.PublicUrl, null), Times.Once);
    }

    [Theory]
    [InlineData("email", ResultScreen.Email)]
    [InlineData("qr", ResultScreen.Qr)]
    public async Task Email_and_qr_open_their_standard_screens(string action, ResultScreen expected)
    {
        CacheShare();
        var result = await _h.OpenAsync();

        result.ShareActionCommand.CanExecute(action).Should().BeTrue();
        result.ShareActionCommand.Execute(action);

        result.Screen.Should().Be(expected);
    }

    [Fact]
    public async Task Retake_goes_back_to_the_shooting_and_finish_goes_home()
    {
        CacheShare();
        var result = await _h.OpenAsync();

        result.ShareActionCommand.Execute("retake");
        _h.Navigation.Verify(n => n.NavigateTo<LiveView>(), Times.Once);

        result.ShareActionCommand.Execute("finish");
        _h.Navigation.Verify(n => n.NavigateTo<HomeView>(), Times.Once);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("start")]
    [InlineData("inconnue")]
    public async Task An_unknown_action_does_nothing(string? action)
    {
        CacheShare();
        var result = await _h.OpenAsync();

        result.ShareActionCommand.CanExecute(action).Should().BeFalse();
        result.ShareActionCommand.Execute(action);

        result.Screen.Should().Be(ResultScreen.Share);
        _h.Navigation.Verify(n => n.NavigateTo<LiveView>(), Times.Never);
        _h.Navigation.Verify(n => n.NavigateTo<HomeView>(), Times.Never);
    }

    // ── États : masqué (coupé pour l'événement) ou grisé (indisponible) ───

    [Fact]
    public async Task Buttons_turned_off_for_the_event_are_hidden_and_inert()
    {
        CacheShare();
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(
            Buttons(retake: false, print: false, qr: false, email: false, home: false)));

        result.ShareActionStates.Values.Should().OnlyContain(s => s == ScreenActionState.Hidden);
        foreach (var action in AllActions)
            result.ShareActionCommand.CanExecute(action).Should().BeFalse(action);
        result.ShareTexts["copies"].Should().BeEmpty();
    }

    [Fact]
    public async Task Email_needs_email_sharing_on_the_event()
    {
        CacheShare();
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(emailEnabled: false));

        result.ShareActionStates["email"].Should().Be(ScreenActionState.Hidden);
        result.ShareActionStates["qr"].Should().Be(ScreenActionState.Active);
    }

    [Fact]
    public async Task Retake_is_hidden_for_a_photo_opened_from_the_gallery()
    {
        CacheShare();
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(fromGallery: true));

        result.ShareActionStates["retake"].Should().Be(ScreenActionState.Hidden);
        result.ShareActionCommand.CanExecute("retake").Should().BeFalse();
    }

    [Fact]
    public async Task Photo_not_sent_yet_greys_email_and_qr_until_it_is()
    {
        _h.Network.SetupGet(n => n.IsOnline).Returns(false);
        CacheShare();
        var result = await _h.OpenAsync();

        result.ShareActionStates["email"].Should().Be(ScreenActionState.Disabled);
        result.ShareActionStates["qr"].Should().Be(ScreenActionState.Disabled);
        result.ShareActionCommand.CanExecute("qr").Should().BeFalse();
        result.ShareTexts["share_status"].Should().StartWith("Photo gardée sur la borne");

        result.ShareActionCommand.Execute("qr");
        result.Screen.Should().Be(ResultScreen.Share, "un bouton grisé ne fait rien");
    }

    [Fact]
    public async Task Quota_reached_here_greys_print_and_says_so()
    {
        RemainingPrints(1, 0);
        CacheShare();
        var result = await _h.OpenAsync();
        result.ShareActionStates["print"].Should().Be(ScreenActionState.Active);
        result.ShareTexts["prints_remaining"].Should().Be("encore 1 tirage possible");

        result.ShareActionCommand.Execute("print");
        await (result.PrintCommand.ExecutionTask ?? Task.CompletedTask);

        result.ShareActionStates["print"].Should().Be(ScreenActionState.Disabled);
        result.ShareActionCommand.CanExecute("print").Should().BeFalse();
        result.ShareTexts["prints_remaining"].Should().BeEmpty();
        result.ShareTexts["print_status"].Should().NotBeEmpty("confirmation, puis « Plus de tirage disponible »");
    }

    [Fact]
    public async Task Remaining_prints_text_follows_show_remaining_prints()
    {
        RemainingPrints(4);
        CacheShare();
        var p = ResultViewModelHarness.Parameters();
        p.ResultCfg!.ShowRemainingPrints = false;
        var result = await _h.OpenAsync(p);

        result.ShareTexts["prints_remaining"].Should().BeEmpty();
    }

    [Fact]
    public async Task Countdown_text_follows_the_timer_and_is_announced()
    {
        CacheShare();
        var result = await _h.OpenAsync();
        result.ShareTexts["countdown"].Should().Be("Retour à l'accueil dans 30 s");

        var changed = new List<string?>();
        result.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        var canExecuteChanged = 0;
        result.ShareActionCommand.CanExecuteChanged += (_, _) => canExecuteChanged++;

        _h.Timer.Fire(2);

        result.ShareTexts["countdown"].Should().Be("Retour à l'accueil dans 28 s");
        changed.Should().Contain(nameof(ResultViewModel.ShareTexts)).And.Contain(nameof(ResultViewModel.ShareActionStates));
        canExecuteChanged.Should().BePositive();
    }

    [Fact]
    public async Task No_countdown_text_when_auto_return_is_off()
    {
        CacheShare();
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(autoReturnSeconds: 0));

        result.ShareTexts["countdown"].Should().BeEmpty();
    }

    // ── Bandeau d'impression gardé par la borne (D9) ──────────────────────

    [Fact]
    public async Task Without_print_status_text_the_kiosk_shows_print_errors_in_a_banner()
    {
        CacheShare(withPrintStatus: false);
        var result = await _h.OpenAsync();
        result.HasSharePrintBanner.Should().BeFalse();

        result.PrintError = "Imprimante : plus de papier";

        result.HasSharePrintBanner.Should().BeTrue();
        result.SharePrintBanner.Should().Be("Imprimante : plus de papier");
    }

    [Fact]
    public async Task With_print_status_text_no_banner_is_added()
    {
        CacheShare();
        var result = await _h.OpenAsync();

        result.PrintError = "Imprimante : plus de papier";

        result.HasSharePrintBanner.Should().BeFalse();
        result.ShareTexts["print_status"].Should().Be("Imprimante : plus de papier");
    }
}
