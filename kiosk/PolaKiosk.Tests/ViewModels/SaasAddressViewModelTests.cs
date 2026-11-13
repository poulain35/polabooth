using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

// Open core K2 : écran « Adresse de votre SaaS ».
public sealed class SaasAddressViewModelTests : IDisposable
{
    private readonly TempDir _dir = new();
    private readonly Mock<IKioskConfigClient> _client = new();
    private readonly Mock<IAppRestart> _restart = new();
    private readonly MachineSettingsService _machine;
    private readonly SaasAddressViewModel _vm;

    public SaasAddressViewModelTests()
    {
        _machine = new MachineSettingsService(_dir.Path);
        _vm = new SaasAddressViewModel(_client.Object, _machine, _restart.Object);
    }

    public void Dispose() => _dir.Dispose();

    [Fact]
    public async Task Valid_address_is_saved_then_the_kiosk_restarts()
    {
        _client.Setup(c => c.FetchAsync("https://photobooth.mon-entreprise.fr", It.IsAny<CancellationToken>()))
               .ReturnsAsync(new SaasConfig("https://abc.supabase.co", "cle-anon"));

        _vm.Address = "photobooth.mon-entreprise.fr/";
        await _vm.ConnectCommand.ExecuteAsync(null);

        _vm.Error.Should().BeEmpty();
        _vm.IsSaved.Should().BeTrue();
        _vm.IsChecking.Should().BeFalse();
        _restart.Verify(r => r.Restart(), Times.Once);

        var saved = new MachineSettingsService(_dir.Path).Current;
        saved.SaasUrl.Should().Be("https://photobooth.mon-entreprise.fr");
        saved.SupabaseUrl.Should().Be("https://abc.supabase.co");
        saved.SupabaseAnonKey.Should().Be("cle-anon");

        // Après le redémarrage : l'adresse saisie est appliquée, la borne passe à l'association.
        var settings = new AppSettings();
        SaasEndpoint.Apply(settings, saved).Should().Be(SaasEndpointSource.MachineSettings);
        settings.Kiosk.ResolvePairingUrl().Should().Be("https://photobooth.mon-entreprise.fr/associer");
    }

    [Fact]
    public async Task Unreachable_address_shows_the_error_and_saves_nothing()
    {
        _client.Setup(c => c.FetchAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
               .ReturnsAsync((SaasConfig?)null);

        _vm.Address = "photobooth.mon-entreprise.fr";
        await _vm.ConnectCommand.ExecuteAsync(null);

        _vm.Error.Should().Be("Adresse introuvable. Vérifiez l'adresse et la connexion.");
        _vm.HasError.Should().BeTrue();
        _vm.IsSaved.Should().BeFalse();
        _restart.Verify(r => r.Restart(), Times.Never);
        _machine.Current.SupabaseUrl.Should().BeNull();
    }

    [Fact]
    public async Task Invalid_address_is_refused_without_any_request()
    {
        _vm.Address = "http://photobooth.mon-entreprise.fr";
        await _vm.ConnectCommand.ExecuteAsync(null);

        _vm.Error.Should().Be(SaasAddressViewModel.NotFoundMessage);
        _client.Verify(c => c.FetchAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Error_disappears_when_the_address_is_edited()
    {
        _vm.Address = "http://x.fr";
        await _vm.ConnectCommand.ExecuteAsync(null);
        _vm.HasError.Should().BeTrue();

        _vm.Address = "x.fr";

        _vm.HasError.Should().BeFalse();
    }

    [Fact]
    public void Empty_address_cannot_be_validated()
    {
        _vm.Address = "  ";
        _vm.ConnectCommand.CanExecute(null).Should().BeFalse();

        _vm.Address = "x.fr";
        _vm.ConnectCommand.CanExecute(null).Should().BeTrue();
    }
}
