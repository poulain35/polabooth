using System.IO;

namespace PolaKiosk.Services;

/// <summary>
/// Fichiers et dossiers de la borne : seule source des noms. Données sous le DataDirectory
/// (<c>%AppData%\PolaKiosk</c> par défaut), journaux et mises à jour sous <see cref="LocalRoot"/>.
/// </summary>
public sealed class KioskPaths
{
    public KioskPaths(string root) => Root = root;

    public static KioskPaths From(AppSettings settings)
        => new(Environment.ExpandEnvironmentVariables(settings.Kiosk.DataDirectory));

    /// <summary><c>%LocalAppData%\PolaKiosk</c> : fatal.log, watchdog.log, mises à jour (hors du DataDirectory).</summary>
    public static string LocalRoot { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PolaKiosk");

    public string Root { get; }

    public string Database               => Path.Combine(Root, "polakiosk.db");
    public string StateFile              => Path.Combine(Root, "state.json");
    public string MachineSettingsFile    => Path.Combine(Root, "machine-settings.json");
    public string ActivationFile         => Path.Combine(Root, "activation.bin");
    public string AdminPinFile           => Path.Combine(Root, "admin-pin.bin");
    public string LicenseFile            => Path.Combine(Root, "license.json");
    public string LicenseKeyFile         => Path.Combine(Root, "license.key");
    public string PinAttemptsFile        => Path.Combine(Root, "pin-attempts.json");
    public string SetupConfigFile        => Path.Combine(Root, "setup_bg_config.json");

    /// <summary>Fichiers propres à l'association avec un SaaS (effacés par « Changer de SaaS »).</summary>
    public IReadOnlyList<string> PairingFiles => [ActivationFile, AdminPinFile, LicenseFile, LicenseKeyFile];

    public string EventsDirectory        => Path.Combine(Root, "events");
    public string PendingDirectory       => Path.Combine(Root, "pending");
    public string TemplatesDirectory     => Path.Combine(Root, "templates");
    public string BackgroundsDirectory   => Path.Combine(Root, "backgrounds");
    public string SetupBackgroundsDirectory => Path.Combine(Root, "setup_bg");
    public string LogoDirectory          => Path.Combine(Root, "logo");
    public string HomeDesignsDirectory   => Path.Combine(Root, "home-designs");
    public string ScreensDirectory       => Path.Combine(Root, "screens");
    public string PolaDirectory          => Path.Combine(Root, "pola");
    public string PolaHistoryDirectory   => Path.Combine(Root, "pola-history");
}
