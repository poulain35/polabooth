using FluentAssertions;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Tests.Services;

/// <summary>Lecture de <c>form_config.kiosk</c> en un seul endroit (LAB-401).</summary>
public class KioskConfigReadTests
{
    [Fact]
    public void Reads_the_kiosk_part_of_the_form_config()
    {
        var cfg = KioskConfig.FromFormConfig("""{"features":{},"kiosk":{"capture":{"countdown_seconds":3}}}""");

        cfg.Should().NotBeNull();
        cfg!.Capture.CountdownSeconds.Should().Be(3);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{pas du json")]
    [InlineData("""{"features":{}}""")]
    [InlineData("""{"kiosk":"oui"}""")]
    public void Missing_or_unreadable_config_gives_null(string? json)
        => KioskConfig.FromFormConfig(json).Should().BeNull();
}
