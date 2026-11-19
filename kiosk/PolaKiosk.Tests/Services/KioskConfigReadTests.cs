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

    // capture.gif (LAB-237) : bornes du SaaS (kioskFormats.js, GIF_LIMITS), valeur par défaut sinon.
    [Theory]
    [InlineData("""{"shots":5,"interval_ms":1500}""", 5, 1500)]
    [InlineData("""{"shots":3,"interval_ms":500}""", 3, 500)]
    [InlineData("""{"shots":6,"interval_ms":3000}""", 6, 3000)]
    [InlineData("""{"shots":2,"interval_ms":400}""", 4, 1000)]
    [InlineData("""{"shots":7,"interval_ms":3500}""", 4, 1000)]
    [InlineData("""{"shots":"5","interval_ms":1.5}""", 4, 1000)]
    [InlineData("""{"shots":6}""", 6, 1000)]
    [InlineData("""{}""", 4, 1000)]
    [InlineData("null", 4, 1000)]
    [InlineData("\"x\"", 4, 1000)]
    public void Gif_capture_settings_are_bounded(string gif, int shots, int intervalMs)
    {
        var cfg = KioskConfig.FromFormConfig("""{"kiosk":{"capture":{"countdown_seconds":3,"gif":""" + gif + "}}}");

        cfg!.Capture.Gif.Shots.Should().Be(shots);
        cfg.Capture.Gif.IntervalMs.Should().Be(intervalMs);
        cfg.Capture.CountdownSeconds.Should().Be(3);
    }

    [Fact]
    public void Without_gif_settings_the_defaults_apply()
    {
        var cfg = KioskConfig.FromFormConfig("""{"kiosk":{"capture":{}}}""");

        cfg!.Capture.Gif.Shots.Should().Be(4);
        cfg.Capture.Gif.IntervalMs.Should().Be(1000);
    }
}
