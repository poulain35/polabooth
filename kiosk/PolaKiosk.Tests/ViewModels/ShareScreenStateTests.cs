using FluentAssertions;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Partage composé (LAB-297) : états des boutons et textes vivants, fonction pure.</summary>
public sealed class ShareScreenStateTests
{
    // Tout activé, photo en ligne, tirage sans plafond, 1 exemplaire sur 10.
    private static ShareScreenInputs Ready() => new(
        ShowPrintBlock: true, CanPrint: true, IsPrinting: false, Copies: 1, MaxCopies: 10,
        ShowEmailTile: true, ShowQrTile: true, IsShareReady: true, ShowRetake: true, ShowFinish: true);

    [Fact]
    public void Everything_ready_is_active_except_minus_at_one_copy()
    {
        var states = ShareScreenState.Actions(Ready());

        states.Should().HaveCount(7);
        states.Where(s => s.Key != "copies_minus").Should().OnlyContain(s => s.Value == ScreenActionState.Active);
        states["copies_minus"].Should().Be(ScreenActionState.Disabled);
    }

    [Fact]
    public void Copies_buttons_follow_the_bounds()
    {
        ShareScreenState.Actions(Ready() with { Copies = 3, MaxCopies = 3 })
            .Should().Contain("copies_minus", ScreenActionState.Active)
            .And.Contain("copies_plus", ScreenActionState.Disabled);
    }

    [Fact]
    public void Print_off_hides_the_whole_print_block()
    {
        var s = Ready() with { ShowPrintBlock = false, Copies = 2 };

        var states = ShareScreenState.Actions(s);
        states["print"].Should().Be(ScreenActionState.Hidden);
        states["copies_minus"].Should().Be(ScreenActionState.Hidden);
        states["copies_plus"].Should().Be(ScreenActionState.Hidden);

        var texts = ShareScreenState.Texts(s with { ShowRemainingPrints = true, RemainingPrints = 3, PrintStatus = "Impression…" });
        texts["copies"].Should().BeEmpty();
        texts["prints_remaining"].Should().BeEmpty();
        texts["print_status"].Should().BeEmpty();
    }

    [Fact]
    public void Quota_reached_greys_print_and_says_so()
    {
        var s = Ready() with { CanPrint = false, Copies = 1, MaxCopies = 1, ShowRemainingPrints = true, RemainingPrints = 0 };
        s = s with { PrintStatus = ShareScreenState.PrintStatus(false, "", "", canPrint: false) };

        var states = ShareScreenState.Actions(s);
        states["print"].Should().Be(ScreenActionState.Disabled);
        states["copies_minus"].Should().Be(ScreenActionState.Disabled);
        states["copies_plus"].Should().Be(ScreenActionState.Disabled);

        var texts = ShareScreenState.Texts(s);
        texts["print_status"].Should().Be("Plus de tirage disponible");
        texts["prints_remaining"].Should().BeEmpty();
    }

    [Fact]
    public void Printing_greys_the_print_block()
    {
        var states = ShareScreenState.Actions(Ready() with { IsPrinting = true, Copies = 2 });

        states["print"].Should().Be(ScreenActionState.Disabled);
        states["copies_minus"].Should().Be(ScreenActionState.Disabled);
        states["copies_plus"].Should().Be(ScreenActionState.Disabled);
        states["email"].Should().Be(ScreenActionState.Active);
    }

    [Fact]
    public void Photo_not_sent_yet_greys_email_and_qr_and_shows_the_status()
    {
        var s = Ready() with { IsShareReady = false, ShareStatus = "Préparation de votre photo…" };

        var states = ShareScreenState.Actions(s);
        states["email"].Should().Be(ScreenActionState.Disabled);
        states["qr"].Should().Be(ScreenActionState.Disabled);
        states["print"].Should().Be(ScreenActionState.Active, "l'impression n'attend pas l'envoi");

        ShareScreenState.Texts(s)["share_status"].Should().Be("Préparation de votre photo…");
        ShareScreenState.Texts(s with { IsShareReady = true })["share_status"].Should().BeEmpty();
    }

    [Fact]
    public void Disabled_features_are_hidden()
    {
        var s = Ready() with { ShowEmailTile = false, ShowQrTile = false, ShowRetake = false, ShowFinish = false, IsShareReady = false,
                               ShareStatus = "Préparation de votre photo…" };

        var states = ShareScreenState.Actions(s);
        foreach (var action in new[] { "email", "qr", "retake", "finish" })
            states[action].Should().Be(ScreenActionState.Hidden, action);

        ShareScreenState.Texts(s)["share_status"].Should().BeEmpty("ni QR code ni e-mail : rien à attendre");
    }

    [Fact]
    public void Remaining_prints_only_when_asked_and_known()
    {
        ShareScreenState.Texts(Ready() with { ShowRemainingPrints = true, RemainingPrints = 3 })["prints_remaining"]
            .Should().Be("encore 3 tirages possibles");
        ShareScreenState.Texts(Ready() with { ShowRemainingPrints = true, RemainingPrints = 1 })["prints_remaining"]
            .Should().Be("encore 1 tirage possible");
        ShareScreenState.Texts(Ready() with { ShowRemainingPrints = true, RemainingPrints = null })["prints_remaining"]
            .Should().BeEmpty("aucun plafond");
        ShareScreenState.Texts(Ready() with { ShowRemainingPrints = false, RemainingPrints = 3 })["prints_remaining"]
            .Should().BeEmpty("show_remaining_prints coupé");
    }

    [Fact]
    public void Copies_and_countdown_texts()
    {
        var texts = ShareScreenState.Texts(Ready() with { Copies = 4, ShowCountdown = true, SecondsLeft = 12 });
        texts["copies"].Should().Be("4");
        texts["countdown"].Should().Be("Retour à l'accueil dans 12 s");

        ShareScreenState.Texts(Ready() with { ShowCountdown = false, SecondsLeft = 12 })["countdown"]
            .Should().BeEmpty("auto_return_seconds = 0");
    }

    [Theory]
    [InlineData(true, "Erreur", "Notice", true, "Impression…")]
    [InlineData(false, "Erreur", "Notice", true, "Erreur")]
    [InlineData(false, "", "C'est parti !", false, "C'est parti !")]
    [InlineData(false, "", "", false, "Plus de tirage disponible")]
    [InlineData(false, "", "", true, "")]
    public void Print_status_priority(bool printing, string error, string notice, bool canPrint, string expected)
        => ShareScreenState.PrintStatus(printing, error, notice, canPrint).Should().Be(expected);

    [Fact]
    public void Print_banner_shows_the_status_only_without_a_print_status_text()
    {
        var error = Ready() with { PrintStatus = "Imprimante : plus de papier" };

        ShareScreenState.PrintBanner(layoutShowsPrintStatus: false, error).Should().Be("Imprimante : plus de papier");
        ShareScreenState.PrintBanner(layoutShowsPrintStatus: true, error).Should().BeEmpty();
        ShareScreenState.PrintBanner(layoutShowsPrintStatus: false, error with { ShowPrintBlock = false }).Should().BeEmpty();
        ShareScreenState.PrintBanner(layoutShowsPrintStatus: false, Ready()).Should().BeEmpty();
    }
}
