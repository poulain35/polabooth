using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Chemins de la borne (LAB-401) : un seul endroit, variables d'environnement développées.</summary>
public class KioskPathsTests
{
    [Fact]
    public void Expands_the_data_directory_of_the_settings()
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = "%AppData%\\PolaKiosk";

        var paths = KioskPaths.From(settings);

        paths.Root.Should().Be(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PolaKiosk"));
        paths.Database.Should().Be(Path.Combine(paths.Root, "polakiosk.db"));
    }

    [Fact]
    public void Every_path_is_directly_under_the_data_directory()
    {
        var paths = new KioskPaths(Path.Combine(Path.GetTempPath(), "borne"));

        string[] all =
        [
            paths.Database, paths.StateFile, paths.MachineSettingsFile, paths.ActivationFile, paths.AdminPinFile,
            paths.LicenseFile, paths.LicenseKeyFile, paths.PinAttemptsFile, paths.SetupConfigFile,
            paths.EventsDirectory, paths.PendingDirectory, paths.TemplatesDirectory, paths.BackgroundsDirectory,
            paths.SetupBackgroundsDirectory, paths.LogoDirectory, paths.HomeDesignsDirectory, paths.ScreensDirectory,
            paths.PolaDirectory, paths.PolaHistoryDirectory,
        ];

        all.Should().OnlyHaveUniqueItems().And.OnlyContain(p => Path.GetDirectoryName(p) == paths.Root);
    }
}
