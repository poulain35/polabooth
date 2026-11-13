using FluentAssertions;
using Moq;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>
/// Envoi par e-mail (écran 3b, LAB-252) : adresse pré-remplie depuis le questionnaire pour ce parcours
/// seulement (LAB-225), case d'accord toujours décochée, puis écran « C'est envoyé ! ».
/// </summary>
public sealed class ResultViewModelEmailTests
{
    private readonly ResultViewModelHarness _h = new();

    [Fact]
    public async Task Email_field_is_prefilled_for_this_guest_then_empty_for_the_next()
    {
        _h.Journey.PrefillEmail = "jean@gmail.com"; // saisi au questionnaire (prefill_share_email)
        var result = await _h.OpenAsync();

        result.OpenEmailCommand.Execute(null);
        result.EmailInputText.Should().Be("jean@gmail.com");

        result.EmailInputText = "autre@gmail.com";
        result.BackToShareCommand.Execute(null); // retour : saisie effacée
        result.EmailInputText.Should().BeEmpty();
        result.OpenEmailCommand.Execute(null);   // rouvert : de nouveau pré-rempli
        result.EmailInputText.Should().Be("jean@gmail.com");

        _h.NavigateTo<HomeView>(); // invité suivant
        _h.NavigateTo<ResultView>();
        var next = await _h.OpenAsync();
        next.OpenEmailCommand.Execute(null);
        next.EmailInputText.Should().BeEmpty();
    }

    [Fact]
    public async Task Email_field_stays_empty_without_prefill()
    {
        var result = await _h.OpenAsync();

        result.OpenEmailCommand.Execute(null);

        result.Screen.Should().Be(ResultScreen.Email);
        result.EmailInputText.Should().BeEmpty();
    }

    [Fact]
    public async Task Consent_box_is_unchecked_even_when_the_address_is_prefilled()
    {
        _h.Journey.PrefillEmail = "jean@gmail.com";
        var result = await _h.OpenAsync();

        result.OpenEmailCommand.Execute(null);

        result.EmailInputText.Should().Be("jean@gmail.com");
        result.EmailConsent.Should().BeFalse();

        result.EmailConsent = true;
        result.BackToShareCommand.Execute(null);
        result.OpenEmailCommand.Execute(null);
        result.EmailConsent.Should().BeFalse("chaque ouverture redemande l'accord");
    }

    [Fact]
    public async Task Send_is_impossible_until_the_consent_box_is_checked()
    {
        var result = await _h.OpenAsync();
        result.OpenEmailCommand.Execute(null);
        result.EmailInputText = "jean@gmail.com";

        result.SendEmailCommand.CanExecute(null).Should().BeFalse();
        await result.SendEmailCommand.ExecuteAsync(null);
        _h.Supabase.Verify(s => s.SendKioskPhotoEmailAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string>()),
            Times.Never);

        result.EmailConsent = true;
        result.SendEmailCommand.CanExecute(null).Should().BeTrue();
    }

    [Theory]
    [InlineData("")]
    [InlineData("jean")]
    [InlineData("jean@gmail")]
    [InlineData("jean @gmail.com")]
    public async Task Send_needs_a_plausible_address(string address)
    {
        var result = await _h.OpenAsync();
        result.OpenEmailCommand.Execute(null);
        result.EmailConsent = true;

        result.EmailInputText = address;

        result.SendEmailCommand.CanExecute(null).Should().BeFalse();
    }

    [Fact]
    public async Task Sending_shows_the_sent_screen_then_Finish_goes_home()
    {
        var result = await _h.OpenAsync();
        result.OpenEmailCommand.Execute(null);
        result.EmailInputText = " jean@gmail.com ";
        result.EmailConsent = true;

        await result.SendEmailCommand.ExecuteAsync(null);

        _h.Supabase.Verify(s => s.SendKioskPhotoEmailAsync(
            ResultViewModelHarness.EventId, "jean@gmail.com", ResultViewModelHarness.PublicUrl), Times.Once);
        result.Screen.Should().Be(ResultScreen.EmailSent);
        result.IsEmailSentScreen.Should().BeTrue();
        result.SentToAddress.Should().Be("jean@gmail.com");

        result.GoHomeCommand.Execute(null);
        _h.Current.Should().Be(typeof(HomeView));
    }

    [Fact]
    public async Task A_failed_send_stays_on_the_email_screen_with_a_plain_message()
    {
        _h.Supabase.Setup(s => s.SendKioskPhotoEmailAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string>()))
              .ThrowsAsync(new HttpRequestException("500 Internal Server Error"));
        var result = await _h.OpenAsync();
        result.OpenEmailCommand.Execute(null);
        result.EmailInputText = "jean@gmail.com";
        result.EmailConsent = true;

        await result.SendEmailCommand.ExecuteAsync(null);

        result.Screen.Should().Be(ResultScreen.Email);
        result.EmailError.Should().NotBeEmpty().And.NotContain("500");
        result.EmailInputText.Should().Be("jean@gmail.com");
    }

    [Fact]
    public async Task Email_and_QR_wait_for_the_photo_to_be_online()
    {
        _h.Network.SetupGet(n => n.IsOnline).Returns(false);
        var result = await _h.OpenAsync();

        result.IsShareReady.Should().BeFalse();
        result.OpenEmailCommand.CanExecute(null).Should().BeFalse();
        result.OpenQrCommand.CanExecute(null).Should().BeFalse();
        result.ShowShareStatus.Should().BeTrue();
        result.QrCodeImage.Should().BeNull();
    }

    [Fact]
    public async Task Domain_shortcut_replaces_what_follows_the_at_sign()
    {
        var result = await _h.OpenAsync();
        result.OpenEmailCommand.Execute(null);

        result.EmailInputText = "jean";
        result.ApplyEmailDomainCommand.Execute("gmail.com");
        result.EmailInputText.Should().Be("jean@gmail.com");

        result.ApplyEmailDomainCommand.Execute("orange.fr");
        result.EmailInputText.Should().Be("jean@orange.fr");
    }

    [Fact]
    public async Task Domain_shortcuts_follow_the_typed_domain()
    {
        var result = await _h.OpenAsync();
        result.OpenEmailCommand.Execute(null);

        result.DomainSuggestions.Should().HaveCount(4).And.StartWith("gmail.com");
        result.EmailInputText = "jean@hot";
        result.DomainSuggestions.Should().Equal("hotmail.fr", "hotmail.com");
    }
}
