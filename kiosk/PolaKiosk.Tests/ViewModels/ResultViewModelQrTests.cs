using FluentAssertions;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>LAB-231 : le lien du QR code porte <c>via=qr</c> pour compter les scans dans le rapport.</summary>
public sealed class ResultViewModelQrTests
{
    private const string SaasUrl = "https://photobooth.exemple.fr";
    private const string PublicUrl = "https://photos.example.com/photos/mariage/s/c.jpg";
    private static readonly Guid PhotoId = Guid.Parse("0a0b0c0d-1111-4222-8333-944455556666");

    [Fact]
    public void Qr_link_opens_the_photo_in_the_gallery_and_is_marked_as_scanned()
        => ShareLinks.BuildQrUrl(SaasUrl, "TUQNA5", PhotoId, PublicUrl)
            .Should().Be("https://photobooth.exemple.fr/photos/TUQNA5?photo=0a0b0c0d-1111-4222-8333-944455556666&via=qr");

    [Fact]
    public void Qr_link_without_photo_id_opens_the_gallery_and_is_still_marked()
        => ShareLinks.BuildQrUrl(SaasUrl + "/", "TUQNA5", Guid.Empty, PublicUrl)
            .Should().Be("https://photobooth.exemple.fr/photos/TUQNA5?via=qr");

    [Fact]
    public void Qr_link_without_access_code_falls_back_to_the_photo_file()
        => ShareLinks.BuildQrUrl(SaasUrl, null, PhotoId, PublicUrl).Should().Be(PublicUrl);

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public void Qr_link_without_saas_address_falls_back_to_the_photo_file(string saasUrl)
        => ShareLinks.BuildQrUrl(saasUrl, "TUQNA5", PhotoId, PublicUrl).Should().Be(PublicUrl);
}
