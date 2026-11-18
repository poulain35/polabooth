using System.IO;
using FluentAssertions;
using Moq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-326 : ligne de démarrage de la borne (journal « startup »).</summary>
public class StartupReportTests
{
    private static StartupFacts Facts() => new(
        AppVersion:    "1.0.16",
        Windows:       "Windows 11 24H2 (10.0.26100)",
        MachineName:   "LBAP5",
        Screen:        "1920 × 1080",
        FreeDiskBytes: 392L << 30,
        PrinterName:   "DNP DS-RX1",
        PrinterStatus: "ready",
        EventName:     "Mariage Julie & Tom",
        AccessCode:    "ABC123");

    [Fact]
    public void One_line_with_every_fact()
    {
        var line = StartupReport.Format(Facts());

        line.Should().StartWith("Démarrage de la borne : version 1.0.16 ; Windows 11 24H2 (10.0.26100) ; PC LBAP5 ; écran 1920 × 1080 ; espace disque libre 392");
        line.Should().Contain(" Go ; imprimante « DNP DS-RX1 » (prête) ; événement « Mariage Julie & Tom » (ABC123).");
        line.Should().NotContain("\n");
    }

    [Fact]
    public void Missing_facts_are_said_plainly()
    {
        var line = StartupReport.Format(Facts() with
        {
            Screen = null, FreeDiskBytes = null, PrinterName = "", PrinterStatus = "not_found",
            EventName = null, AccessCode = null,
        });

        line.Should().Contain("écran inconnu ;");
        line.Should().Contain("espace disque libre inconnu ;");
        line.Should().Contain("imprimante par défaut de Windows (introuvable)");
        line.Should().EndWith("; aucun événement actif.");
    }

    [Theory]
    [InlineData("ready", "prête")]
    [InlineData("offline", "hors ligne")]
    [InlineData("paper_out", "plus de papier")]
    [InlineData("paper_jam", "bourrage papier")]
    [InlineData("error", "en erreur")]
    [InlineData("not_found", "introuvable")]
    [InlineData("unknown", "état inconnu")]
    [InlineData("autre", "état inconnu")]
    public void Printer_status_is_written_in_french(string status, string expected)
        => StartupReport.PrinterStatusLabel(status).Should().Be(expected);

    [Theory]
    [InlineData(1920, 1080, 1.0, 1.0, "1920 × 1080")]
    [InlineData(1280, 720, 1.5, 1.5, "1920 × 1080 (échelle 150 %)")]
    [InlineData(1536, 864, 1.25, 1.25, "1920 × 1080 (échelle 125 %)")]
    public void Screen_is_given_in_real_pixels_with_the_windows_scale(double w, double h, double sx, double sy, string expected)
        => StartupReport.DescribeScreen(w, h, sx, sy).Should().Be(expected);

    [Theory]
    [InlineData("10.0.26200", "25H2", "Windows 11 25H2 (10.0.26200)")]
    [InlineData("10.0.22000", null, "Windows 11 (10.0.22000)")]
    [InlineData("10.0.19045", "22H2", "Windows 10 22H2 (10.0.19045)")]
    public void Windows_11_is_told_apart_from_windows_10_by_its_build(string version, string? release, string expected)
        => StartupReport.WindowsName(Version.Parse(version), release).Should().Be(expected);

    [Fact]
    public void Collect_reads_this_pc_and_the_active_event_without_failing()
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = Path.GetTempPath();
        settings.Kiosk.PrinterName = "Imprimante qui n'existe pas LAB-326";
        var state = new Mock<IKioskStateService>();
        state.SetupGet(s => s.ActiveEventName).Returns("Salon");
        state.SetupGet(s => s.LastAccessCode).Returns("XYZ789");

        var facts = StartupReport.Collect(settings, state.Object, "1920 × 1080");

        facts.MachineName.Should().Be(Environment.MachineName);
        facts.AppVersion.Should().NotBeNullOrWhiteSpace();
        facts.Windows.Should().StartWith("Windows");
        facts.FreeDiskBytes.Should().BePositive();
        facts.PrinterStatus.Should().BeOneOf("not_found", "unknown");
        StartupReport.Format(facts).Should().EndWith("événement « Salon » (XYZ789).");
    }
}
