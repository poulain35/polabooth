using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

// LAB-197 : pavé PIN de l'écran admin (accueil + saisie du code événement).
public class AdminPinPadViewModelTests
{
    private readonly Mock<IAdminPinService> _pins = new();
    private readonly Mock<INavigationService> _navigation = new();
    private DateTime _now = new(2026, 11, 3, 12, 0, 0, DateTimeKind.Utc);
    private readonly PinAttemptLimiter _attempts;

    public AdminPinPadViewModelTests()
    {
        _attempts = new PinAttemptLimiter(utcNow: () => _now);
        _pins.Setup(p => p.IsConfigured).Returns(true);
        _pins.Setup(p => p.Verify(It.IsAny<string>())).Returns(PinCheckResult.Rejected);
        _pins.Setup(p => p.Verify("2580")).Returns(PinCheckResult.Accepted);
    }

    private AdminPinPadViewModel NewPad()
    {
        var pad = new AdminPinPadViewModel(_pins.Object, _navigation.Object, _attempts);
        pad.OpenAdminPinCommand.Execute(null);
        return pad;
    }

    private static async Task TypeAndValidateAsync(AdminPinPadViewModel pad, string pin)
    {
        foreach (var digit in pin) pad.AppendDigitCommand.Execute(digit.ToString());
        await pad.ValidatePinCommand.ExecuteAsync(null);
    }

    [Fact]
    public async Task The_right_pin_opens_the_admin_screen()
    {
        var pad = NewPad();

        await TypeAndValidateAsync(pad, "2580");

        _navigation.Verify(n => n.NavigateTo<Views.AdminView>(), Times.Once);
        pad.ShowPinEntry.Should().BeFalse();
        pad.PinDots.Should().BeEmpty();
    }

    [Fact]
    public async Task A_wrong_pin_is_refused()
    {
        var pad = NewPad();

        await TypeAndValidateAsync(pad, "1234");

        _navigation.Verify(n => n.NavigateTo<Views.AdminView>(), Times.Never);
        pad.ShowPinEntry.Should().BeTrue();
        pad.HasPinError.Should().BeTrue();
        pad.PinError.Should().Contain("Code incorrect");
        pad.PinDots.Should().BeEmpty();
    }

    [Fact]
    public async Task Without_a_received_pin_the_admin_screen_stays_blocked()
    {
        _pins.Setup(p => p.IsConfigured).Returns(false);
        _pins.Setup(p => p.Verify(It.IsAny<string>())).Returns(PinCheckResult.NotConfigured);

        var pad = NewPad();
        pad.PinError.Should().Be(AdminPinPadViewModel.NotConfiguredMessage);

        await TypeAndValidateAsync(pad, "1234");

        _navigation.Verify(n => n.NavigateTo<Views.AdminView>(), Times.Never);
        pad.PinError.Should().Be("Définissez le PIN de cette borne dans le SaaS (page Licences) puis envoyez-le");
    }

    [Fact]
    public void Opening_the_pad_fetches_a_newly_sent_pin()
    {
        NewPad();

        _pins.Verify(p => p.RefreshAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_too_short_pin_is_not_checked()
    {
        var pad = NewPad();

        await TypeAndValidateAsync(pad, "12");

        _pins.Verify(p => p.Verify(It.IsAny<string>()), Times.Never);
        pad.PinError.Should().Contain("4 à 8 chiffres");
    }

    [Fact]
    public async Task Five_wrong_pins_lock_the_pad_for_30_seconds()
    {
        var pad = NewPad();
        for (var i = 0; i < PinAttemptLimiter.MaxAttempts; i++)
            await TypeAndValidateAsync(pad, "1111");

        await TypeAndValidateAsync(pad, "2580");
        _navigation.Verify(n => n.NavigateTo<Views.AdminView>(), Times.Never);
        pad.PinError.Should().Be("Trop de tentatives. Réessayez dans 30 s.");

        _now = _now.AddSeconds(31);
        await TypeAndValidateAsync(pad, "2580");
        _navigation.Verify(n => n.NavigateTo<Views.AdminView>(), Times.Once);
    }

    // LAB-394 : quitter l'écran (nouveau pavé, même compteur singleton) ne lève pas le blocage.
    [Fact]
    public async Task Five_wrong_pins_still_lock_the_pad_after_leaving_the_screen()
    {
        var pad = NewPad();
        for (var i = 0; i < PinAttemptLimiter.MaxAttempts; i++)
            await TypeAndValidateAsync(pad, "1111");
        pad.CloseAdminPinCommand.Execute(null);

        var newPad = NewPad();
        await TypeAndValidateAsync(newPad, "2580");

        _navigation.Verify(n => n.NavigateTo<Views.AdminView>(), Times.Never);
        _pins.Verify(p => p.Verify("2580"), Times.Never);
        newPad.PinError.Should().StartWith("Trop de tentatives");
    }

    [Fact]
    public async Task Wrong_pins_on_two_pads_add_up()
    {
        var home = NewPad();
        for (var i = 0; i < 3; i++) await TypeAndValidateAsync(home, "1111");

        var setup = NewPad();
        await TypeAndValidateAsync(setup, "1111");

        setup.PinError.Should().Contain("1 essai restant");
    }

    [Fact]
    public async Task The_second_lockout_lasts_longer()
    {
        var pad = NewPad();
        for (var i = 0; i < PinAttemptLimiter.MaxAttempts; i++) await TypeAndValidateAsync(pad, "1111");
        _now = _now.AddSeconds(31);

        for (var i = 0; i < PinAttemptLimiter.MaxAttempts; i++) await TypeAndValidateAsync(pad, "1111");

        pad.PinError.Should().Be("Trop de tentatives. Réessayez dans 1 min.");
    }

    [Theory]
    [InlineData(1, "1 s")]
    [InlineData(29.2, "30 s")]
    [InlineData(60, "1 min")]
    [InlineData(61, "2 min")]
    [InlineData(900, "15 min")]
    public void The_lockout_delay_is_shown_in_seconds_then_minutes(double seconds, string expected)
        => AdminPinPadViewModel.FormatDelay(TimeSpan.FromSeconds(seconds)).Should().Be(expected);

    [Fact]
    public void Digits_beyond_eight_are_ignored()
    {
        var pad = NewPad();

        foreach (var digit in "1234567890") pad.AppendDigitCommand.Execute(digit.ToString());

        pad.PinDots.Should().HaveLength(AdminPinPadViewModel.MaxPinLength);
    }
}
