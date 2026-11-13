using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>LAB-223 : l'écran de consentement ne fait plus d'appel réseau, il garde le choix pour le parcours.</summary>
public class RgpdViewModelTests
{
    private const string Message = "J'accepte que ma photo soit prise par Camille & Hugo.";

    private readonly Mock<INavigationService> _nav = new();
    private readonly Mock<IGuestJourneyService> _journey = new();

    private RgpdViewModel Create(string? homeNotice = null)
    {
        _journey.SetupProperty(j => j.PhotoConsent);
        var vm = new RgpdViewModel(_nav.Object, _journey.Object);
        vm.ReceiveParameter(new RgpdParameters(Message, homeNotice));
        return vm;
    }

    [Fact]
    public void Accept_keeps_the_displayed_message_and_goes_to_the_capture()
    {
        var vm = Create();
        var before = DateTime.UtcNow;

        vm.AcceptCommand.Execute(null);

        var consent = _journey.Object.PhotoConsent;
        consent.Should().NotBeNull();
        consent!.Text.Should().Be(Message);
        consent.ConsentedAtUtc.Kind.Should().Be(DateTimeKind.Utc);
        consent.ConsentedAtUtc.Should().BeOnOrAfter(before).And.BeOnOrBefore(DateTime.UtcNow);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Once);
        _nav.Verify(n => n.GoBack(), Times.Never);
    }

    [Fact]
    public void Refuse_keeps_nothing_and_goes_back_home()
    {
        var vm = Create();
        _journey.Object.PhotoConsent = new PhotoConsent("ancien", DateTime.UtcNow);

        vm.RefuseCommand.Execute(null);

        _journey.Object.PhotoConsent.Should().BeNull();
        _nav.Verify(n => n.GoBack(), Times.Once);
        _nav.Verify(n => n.NavigateTo<LiveView>(), Times.Never);
    }

    [Fact]
    public void Home_notice_is_shown_only_when_given()
    {
        Create().ShowHomeNotice.Should().BeFalse();

        var vm = Create("Vos réponses sont transmises à Camille & Hugo.");
        vm.ShowHomeNotice.Should().BeTrue();
        vm.HomeNotice.Should().Be("Vos réponses sont transmises à Camille & Hugo.");
        vm.ConsentMessage.Should().Be(Message);
    }
}
