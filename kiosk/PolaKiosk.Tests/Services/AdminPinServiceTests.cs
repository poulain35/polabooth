using FluentAssertions;
using Moq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-197 : PIN admin propre à chaque borne, haché par le SaaS (PBKDF2-SHA256), vérifié hors ligne.
public class AdminPinServiceTests : IDisposable
{
    // Vecteur partagé avec saas/supabase/functions/kiosk-admin-pin/kiosk-admin-pin.test.ts.
    private const string VectorPin  = "123456";
    private const string VectorHash = "pbkdf2$210000$AAECAwQFBgcICQoLDA0ODw==$986qxnMbMmzuHyS3MK9F7gz4EXIuhMjAubUlwLFpHTo=";
    private static readonly byte[] VectorSalt = Enumerable.Range(0, 16).Select(i => (byte)i).ToArray();

    // Itérations minimales acceptées : tests rapides, même code de vérification.
    private static readonly string Pin2580 = AdminPinService.HashPin("2580", VectorSalt, AdminPinService.MinIterations);

    private readonly TempDir _dir = new();
    private readonly Mock<ISupabaseService> _supabase = new();

    public void Dispose() => _dir.Dispose();

    private AdminPinService NewService(string? devPin = null) => new(_supabase.Object, _dir.Path, devPin);

    private void SaasSends(string hash)
        => _supabase.Setup(s => s.GetAdminPinAsync(It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new AdminPinHash(hash, new DateTime(2026, 11, 3, 9, 0, 0, DateTimeKind.Utc)));

    private void SaasOffline()
        => _supabase.Setup(s => s.GetAdminPinAsync(It.IsAny<CancellationToken>()))
                    .ThrowsAsync(new HttpRequestException("hors ligne"));

    [Fact]
    public void HashPin_matches_the_vector_shared_with_the_SaaS()
    {
        AdminPinService.HashPin(VectorPin, VectorSalt, 210_000).Should().Be(VectorHash);
        AdminPinService.VerifyHash(VectorPin, VectorHash).Should().BeTrue();
        AdminPinService.VerifyHash("654321", VectorHash).Should().BeFalse();
    }

    [Fact]
    public async Task Verify_accepts_the_right_pin_and_refuses_a_wrong_one()
    {
        SaasSends(Pin2580);
        var service = NewService();
        await service.RefreshAsync(TestContext.Current.CancellationToken);

        service.IsConfigured.Should().BeTrue();
        service.Verify("2580").Should().Be(PinCheckResult.Accepted);
        service.Verify("2581").Should().Be(PinCheckResult.Rejected);
        service.Verify("25800").Should().Be(PinCheckResult.Rejected);
        service.Verify("").Should().Be(PinCheckResult.Rejected);
    }

    [Fact]
    public void Verify_blocks_the_admin_screen_when_no_pin_was_received_in_production()
    {
        var service = NewService(devPin: null);

        service.IsConfigured.Should().BeFalse();
        service.Verify("1234").Should().Be(PinCheckResult.NotConfigured);
        service.Verify("").Should().Be(PinCheckResult.NotConfigured);
    }

    [Fact]
    public async Task The_received_pin_is_persisted_and_read_back_after_a_restart()
    {
        SaasSends(Pin2580);
        await NewService().RefreshAsync(TestContext.Current.CancellationToken);

        // Redémarrage hors ligne : le SaaS n'est plus joignable.
        SaasOffline();
        var restarted = NewService();
        await restarted.RefreshAsync(TestContext.Current.CancellationToken);

        restarted.IsConfigured.Should().BeTrue();
        restarted.Verify("2580").Should().Be(PinCheckResult.Accepted);
        File.ReadAllText(_dir.File("admin-pin.bin")).Should().NotContain("pbkdf2", "le hash est stocké chiffré (DPAPI)");
    }

    [Fact]
    public async Task RefreshAsync_keeps_the_local_pin_when_nothing_new_was_sent()
    {
        SaasSends(Pin2580);
        var service = NewService();
        await service.RefreshAsync(TestContext.Current.CancellationToken);

        _supabase.Setup(s => s.GetAdminPinAsync(It.IsAny<CancellationToken>())).ReturnsAsync((AdminPinHash?)null);
        await service.RefreshAsync(TestContext.Current.CancellationToken);

        service.Verify("2580").Should().Be(PinCheckResult.Accepted);
    }

    [Fact]
    public async Task RefreshAsync_replaces_the_pin_when_a_new_one_is_sent()
    {
        SaasSends(Pin2580);
        var service = NewService();
        await service.RefreshAsync(TestContext.Current.CancellationToken);

        SaasSends(AdminPinService.HashPin("97531", VectorSalt, AdminPinService.MinIterations));
        await service.RefreshAsync(TestContext.Current.CancellationToken);

        service.Verify("97531").Should().Be(PinCheckResult.Accepted);
        service.Verify("2580").Should().Be(PinCheckResult.Rejected);
    }

    [Theory]
    [InlineData("1234")]
    [InlineData("pbkdf2$1$AAECAwQFBgcICQoLDA0ODw==$986qxnMbMmzuHyS3MK9F7gz4EXIuhMjAubUlwLFpHTo=")]
    [InlineData("pbkdf2$210000$pas-du-base64$986qxnMbMmzuHyS3MK9F7gz4EXIuhMjAubUlwLFpHTo=")]
    public async Task RefreshAsync_ignores_a_malformed_hash(string hash)
    {
        SaasSends(hash);
        var service = NewService();

        await service.RefreshAsync(TestContext.Current.CancellationToken);

        service.IsConfigured.Should().BeFalse();
        service.Verify("1234").Should().Be(PinCheckResult.NotConfigured);
    }

    [Fact]
    public async Task RefreshAsync_never_throws_when_offline()
    {
        SaasOffline();

        var act = () => NewService().RefreshAsync(TestContext.Current.CancellationToken);

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task The_dev_pin_only_applies_until_a_pin_is_received()
    {
        var service = NewService(devPin: "1234");
        service.IsConfigured.Should().BeTrue();
        service.Verify("1234").Should().Be(PinCheckResult.Accepted);
        service.Verify("0000").Should().Be(PinCheckResult.Rejected);

        SaasSends(Pin2580);
        await service.RefreshAsync(TestContext.Current.CancellationToken);

        service.Verify("1234").Should().Be(PinCheckResult.Rejected);
        service.Verify("2580").Should().Be(PinCheckResult.Accepted);
    }
}
