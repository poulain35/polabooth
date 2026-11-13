using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.Services;

public class GuestJourneyServiceTests
{
    private readonly Mock<INavigationService> _nav = new();
    private Type? _current;

    public GuestJourneyServiceTests() => _nav.SetupGet(n => n.CurrentViewType).Returns(() => _current);

    private void NavigateTo<T>()
    {
        _current = typeof(T);
        _nav.Raise(n => n.Navigated += null, EventArgs.Empty);
    }

    [Fact]
    public void Journey_is_kept_until_the_home_screen()
    {
        var journey = new GuestJourneyService(_nav.Object) { QuestionnaireHandled = true, PrefillEmail = "jean@gmail.com" };

        NavigateTo<ResultView>();
        NavigateTo<LiveView>(); // « Reprendre »
        journey.QuestionnaireHandled.Should().BeTrue();

        NavigateTo<HomeView>();
        journey.QuestionnaireHandled.Should().BeFalse();
        journey.PrefillEmail.Should().BeNull();
    }

    [Fact]
    public void Photo_consent_is_kept_for_retakes_and_cleared_on_the_home_screen()
    {
        var consent = new PhotoConsent("J'accepte.", DateTime.UtcNow);
        var journey = new GuestJourneyService(_nav.Object) { PhotoConsent = consent };

        NavigateTo<ResultView>();
        NavigateTo<LiveView>(); // « Reprendre » : même consentement, nouvelle séance
        journey.PhotoConsent.Should().BeSameAs(consent);

        NavigateTo<HomeView>();
        journey.PhotoConsent.Should().BeNull();
    }
}
