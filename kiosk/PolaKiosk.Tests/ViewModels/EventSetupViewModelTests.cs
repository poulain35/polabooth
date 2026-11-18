using System.Windows.Media;
using System.Windows.Media.Imaging;
using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Écran « Entrez votre code événement » : logo de la société à la place du nom (LAB-261).</summary>
public class EventSetupViewModelTests : IDisposable
{
    private readonly TempDir _dir = new();
    private readonly Mock<ISyncService> _sync = new();

    public void Dispose() => _dir.Dispose();

    private EventSetupViewModel Open()
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dir.Path;
        var state = new Mock<IKioskStateService>();
        state.SetupGet(s => s.ContactCompany).Returns("Studio Lumière");
        var nav = Mock.Of<INavigationService>();
        return new EventSetupViewModel(_sync.Object, state.Object, nav, settings, Mock.Of<IKioskLogService>(),
            new AdminPinPadViewModel(Mock.Of<IAdminPinService>(), nav, new PinAttemptLimiter()));
    }

    [Fact]
    public void Without_a_cached_logo_the_company_name_shows()
    {
        var vm = Open();

        vm.HasLogo.Should().BeFalse();
        vm.LogoImage.Should().BeNull();
        vm.ContactCompany.Should().Be("Studio Lumière");
    }

    [Fact]
    public void The_cached_logo_replaces_the_name_and_is_decoded_at_frame_size()
    {
        var path = Path.Combine(_dir.Path, "logo.img");
        WriteImage(path, 1600, 400);
        _sync.Setup(s => s.GetOrgLogoPath()).Returns(path);

        var vm = Open();

        vm.HasLogo.Should().BeTrue();
        vm.LogoImage!.PixelWidth.Should().BeLessThanOrEqualTo((int)(EventSetupViewModel.LogoMaxWidth * 2), "décodé à la taille du cadre");
    }

    [Fact]
    public void An_unreadable_logo_falls_back_to_the_name()
    {
        var path = Path.Combine(_dir.Path, "logo.img");
        File.WriteAllText(path, "pas une image");
        _sync.Setup(s => s.GetOrgLogoPath()).Returns(path);

        var vm = Open();

        vm.HasLogo.Should().BeFalse();
        vm.LogoImage.Should().BeNull();
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
}
