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

    public AdminPinPadViewModelTests()
    {
        _pins.Setup(p => p.IsConfigured).Returns(true);
        _pins.Setup(p => p.Verify(It.IsAny<string>())).Returns(PinCheckResult.Rejected);
        _pins.Setup(p => p.Verify("2580")).Returns(PinCheckResult.Accepted);
    }

    private AdminPinPadViewModel NewPad()
    {
        var pad = new AdminPinPadViewModel(_pins.Object, _navigation.Object, () => _now);
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
        for (var i = 0; i < AdminPinPadViewModel.MaxPinAttempts; i++)
            await TypeAndValidateAsync(pad, "1111");

        await TypeAndValidateAsync(pad, "2580");
        _navigation.Verify(n => n.NavigateTo<Views.AdminView>(), Times.Never);
        pad.PinError.Should().Contain("Trop de tentatives");

        _now = _now.AddSeconds(AdminPinPadViewModel.PinLockoutSeconds + 1);
        await TypeAndValidateAsync(pad, "2580");
        _navigation.Verify(n => n.NavigateTo<Views.AdminView>(), Times.Once);
    }

    [Fact]
    public void Digits_beyond_eight_are_ignored()
    {
        var pad = NewPad();

        foreach (var digit in "1234567890") pad.AppendDigitCommand.Execute(digit.ToString());

        pad.PinDots.Should().HaveLength(AdminPinPadViewModel.MaxPinLength);
    }
}
