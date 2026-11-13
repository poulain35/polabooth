using FluentAssertions;
using Moq;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Écran de partage (3, LAB-252) : bloc d'impression, boutons réglés dans le SaaS, retour à l'accueil.</summary>
public sealed class ResultViewModelShareTests
{
    private readonly ResultViewModelHarness _h = new();

    private void RemainingPrints(params int?[] values)
    {
        var queue = new Queue<int?>(values);
        _h.Print.Setup(p => p.GetRemainingPrintsAsync(It.IsAny<Guid>(), It.IsAny<int?>(), It.IsAny<Guid>(), It.IsAny<int?>()))
                .ReturnsAsync(() => queue.Count > 1 ? queue.Dequeue() : queue.Peek());
    }

    private static ResultButtonsConfig Buttons(
        bool retake = true, bool print = true, bool qr = true, bool email = true, bool home = true) => new()
    {
        Retake = new() { Enabled = retake },
        Print  = new() { Enabled = print },
        Qr     = new() { Enabled = qr },
        Email  = new() { Enabled = email },
        Home   = new() { Enabled = home },
    };

    // ── Exemplaires et quotas ─────────────────────────────────────────────

    [Fact]
    public async Task Copies_stay_between_one_and_the_remaining_prints()
    {
        RemainingPrints(3);
        var result = await _h.OpenAsync();

        result.PrintCopies.Should().Be(1);
        result.MaxCopies.Should().Be(3);
        result.DecrementCopiesCommand.CanExecute(null).Should().BeFalse();

        for (var i = 0; i < 5; i++) result.IncrementCopiesCommand.Execute(null);
        result.PrintCopies.Should().Be(3);
        result.IncrementCopiesCommand.CanExecute(null).Should().BeFalse();
        result.PrintButtonText.Should().Be("Imprimer 3 exemplaires");

        for (var i = 0; i < 5; i++) result.DecrementCopiesCommand.Execute(null);
        result.PrintCopies.Should().Be(1);
        result.PrintButtonText.Should().Be("Imprimer 1 exemplaire");
    }

    [Fact]
    public async Task Without_a_limit_a_batch_goes_up_to_ten_copies()
    {
        var result = await _h.OpenAsync();

        for (var i = 0; i < 15; i++) result.IncrementCopiesCommand.Execute(null);

        result.PrintCopies.Should().Be(ResultViewModel.UnlimitedMaxCopies);
        result.PrintSubtitle.Should().Be("Tirage 10×15, prêt en quelques secondes");
    }

    [Fact]
    public async Task Printing_sends_the_chosen_copies_then_follows_the_new_quota()
    {
        RemainingPrints(3, 1);
        var p = ResultViewModelHarness.Parameters();
        var result = await _h.OpenAsync(p);
        result.PrintSubtitle.Should().Be("Tirage 10×15, encore 3 tirages possibles");

        result.IncrementCopiesCommand.Execute(null);
        await result.PrintCommand.ExecuteAsync(null);

        _h.Print.Verify(x => x.PrintAsync(p.CompositePath, p.PrinterName, "4x6", p.SessionId, p.EventId, 2,
            ResultViewModelHarness.PublicUrl, null), Times.Once);
        result.MaxCopies.Should().Be(1);
        result.PrintCopies.Should().Be(1);
        result.IsPrinting.Should().BeFalse();
    }

    [Fact]
    public async Task Print_block_stays_greyed_once_the_limit_is_reached_here()
    {
        RemainingPrints(1, 0);
        var result = await _h.OpenAsync();

        await result.PrintCommand.ExecuteAsync(null);

        result.ShowPrintBlock.Should().BeTrue("les autres boutons ne doivent pas bouger");
        result.CanPrint.Should().BeFalse();
        result.PrintCommand.CanExecute(null).Should().BeFalse();
        result.IncrementCopiesCommand.CanExecute(null).Should().BeFalse();
        result.PrintButtonText.Should().Be("Plus de tirage disponible");
    }

    [Fact]
    public async Task No_print_block_when_the_limit_is_already_reached()
    {
        RemainingPrints(0);
        var result = await _h.OpenAsync();

        result.ShowPrintBlock.Should().BeFalse();
        result.Subtitle.Should().Be("Envoyez ou récupérez vos photos.");
    }

    [Theory]
    [InlineData(typeof(PrintBusyException), "Une impression est encore en cours")]
    [InlineData(typeof(TimeoutException), "L'imprimante ne répond pas")]
    [InlineData(typeof(InvalidOperationException), "Impression indisponible")]
    public async Task A_print_failure_shows_a_plain_message_in_the_print_block(Type error, string message)
    {
        _h.Print.Setup(x => x.PrintAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid>(),
                It.IsAny<Guid>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string?>()))
            .ThrowsAsync((Exception)Activator.CreateInstance(error)!);
        var result = await _h.OpenAsync();

        await result.PrintCommand.ExecuteAsync(null);

        result.HasPrintError.Should().BeTrue();
        result.PrintSubtitle.Should().StartWith(message);
    }

    [Fact]
    public async Task A_strip_is_described_as_such()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(paperFormat: "2x6"));

        result.PrintSubtitle.Should().StartWith("Tirage bandelette 5×15");
    }

    [Theory]
    [InlineData(1, "Refaire la photo")]
    [InlineData(3, "Refaire les photos")]
    public async Task The_retake_button_matches_the_number_of_photos(int photoCount, string expected)
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters() with { PhotoCount = photoCount });

        result.RetakeText.Should().Be(expected);
    }

    // ── Boutons réglés dans le SaaS ───────────────────────────────────────

    [Fact]
    public async Task Everything_is_shown_by_default()
    {
        var result = await _h.OpenAsync();

        result.ShowPrintBlock.Should().BeTrue();
        result.ShowEmailTile.Should().BeTrue();
        result.ShowQrTile.Should().BeTrue();
        result.ShowRetake.Should().BeTrue();
        result.ShowFinish.Should().BeTrue();
        result.Subtitle.Should().Be("Imprimez, envoyez ou récupérez vos photos.");
    }

    [Fact]
    public async Task Print_only()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(Buttons(qr: false, email: false)));

        result.ShowPrintBlock.Should().BeTrue();
        result.ShowShareTiles.Should().BeFalse();
        result.Subtitle.Should().Be("Imprimez votre photo en quelques secondes.");
    }

    [Fact]
    public async Task Digital_only()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(Buttons(print: false)));

        result.ShowPrintBlock.Should().BeFalse();
        result.ShowShareTiles.Should().BeTrue();
        result.Subtitle.Should().Be("Envoyez ou récupérez vos photos.");
    }

    [Fact]
    public async Task QR_only()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(Buttons(print: false, email: false)));

        result.ShowPrintBlock.Should().BeFalse();
        result.ShowEmailTile.Should().BeFalse();
        result.ShowQrTile.Should().BeTrue();
    }

    [Fact]
    public async Task Email_tile_also_needs_email_sharing_on_the_event()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(emailEnabled: false));

        result.ShowEmailTile.Should().BeFalse();
        result.ShowQrTile.Should().BeTrue();
    }

    [Fact]
    public async Task Retake_and_finish_follow_the_settings()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(Buttons(retake: false, home: false)));

        result.ShowRetake.Should().BeFalse();
        result.ShowFinish.Should().BeFalse();
        result.ShowBottomRow.Should().BeFalse();
    }

    [Fact]
    public async Task Retake_is_hidden_for_a_photo_opened_from_the_gallery()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(fromGallery: true));

        result.ShowRetake.Should().BeFalse();
        result.ShowFinish.Should().BeTrue();
        result.ShowPrintBlock.Should().BeTrue();
    }

    [Fact]
    public async Task Retake_goes_back_to_the_shooting()
    {
        var result = await _h.OpenAsync();

        result.RetakeCommand.Execute(null);

        _h.Current.Should().Be(typeof(LiveView));
        _h.Timer.IsEnabled.Should().BeFalse();
    }

    // ── QR code ───────────────────────────────────────────────────────────

    [Fact]
    public async Task QR_screen_shows_the_code_and_the_gallery_link()
    {
        var result = await _h.OpenAsync();

        result.OpenQrCommand.Execute(null);

        result.Screen.Should().Be(ResultScreen.Qr);
        result.QrCodeImage.Should().NotBeNull();
        result.GalleryLink.Should().Be("photobooth.exemple.fr/photos/ABC123");

        result.BackToShareCommand.Execute(null);
        result.Screen.Should().Be(ResultScreen.Share);
    }

    [Theory]
    [InlineData("https://photobooth.exemple.fr/", "XY9", "photobooth.exemple.fr/photos/XY9")]
    [InlineData("http://localhost:5173", "XY9", "localhost:5173/photos/XY9")]
    [InlineData("https://photobooth.exemple.fr", "", "")]
    [InlineData("", "XY9", "")]
    public void Gallery_link_has_no_scheme_nor_parameters(string saasUrl, string code, string expected) =>
        ResultViewModel.BuildGalleryLink(saasUrl, code).Should().Be(expected);

    // ── Retour automatique à l'accueil ────────────────────────────────────

    [Fact]
    public async Task Countdown_goes_home_when_it_reaches_zero()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(autoReturnSeconds: 45));

        result.ShowCountdown.Should().BeTrue();
        result.AutoHomeSecondsLeft.Should().Be(45);
        _h.Timer.Interval.Should().Be(TimeSpan.FromSeconds(1));

        _h.Timer.Fire(44);
        result.AutoHomeSecondsLeft.Should().Be(1);
        _h.Current.Should().Be(typeof(ResultView));

        _h.Timer.Fire();
        _h.Current.Should().Be(typeof(HomeView));
        _h.Timer.IsEnabled.Should().BeFalse();
    }

    [Fact]
    public async Task Every_action_restarts_the_countdown()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(autoReturnSeconds: 30));
        var actions = new (string Name, Action Run)[]
        {
            ("touche", result.RegisterActivity),
            ("+", () => result.IncrementCopiesCommand.Execute(null)),
            ("−", () => result.DecrementCopiesCommand.Execute(null)),
            ("QR code", () => result.OpenQrCommand.Execute(null)),
            ("retour", () => result.BackToShareCommand.Execute(null)),
            ("email", () => result.OpenEmailCommand.Execute(null)),
            ("saisie", () => result.EmailInputText = "jean"),
            ("domaine", () => result.ApplyEmailDomainCommand.Execute("gmail.com")),
            ("accord", () => result.EmailConsent = true),
            ("impression", () => result.PrintCommand.ExecuteAsync(null).GetAwaiter().GetResult()),
        };

        foreach (var (name, run) in actions)
        {
            _h.Timer.Fire(10);
            result.AutoHomeSecondsLeft.Should().Be(20);
            run();
            result.AutoHomeSecondsLeft.Should().Be(30, $"l'action « {name} » remet le compte à rebours à zéro");
        }
    }

    [Fact]
    public async Task No_countdown_when_auto_return_is_off()
    {
        var result = await _h.OpenAsync(ResultViewModelHarness.Parameters(autoReturnSeconds: 0));

        result.ShowCountdown.Should().BeFalse();
        _h.Timer.IsEnabled.Should().BeFalse();
    }

    [Fact]
    public async Task Countdown_stops_once_another_screen_is_shown()
    {
        var result = await _h.OpenAsync();
        _h.NavigateTo<HomeView>(); // ex. délai d'inactivité global

        _h.Timer.Fire();

        _h.Timer.IsEnabled.Should().BeFalse();
        result.AutoHomeSecondsLeft.Should().Be(30);
    }
}
