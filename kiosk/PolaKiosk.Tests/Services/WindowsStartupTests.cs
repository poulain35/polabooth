using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Case « Lancer la borne au démarrage de Windows » : raccourci du watchdog dans le dossier Démarrage.</summary>
public class WindowsStartupTests
{
    private sealed class Install : IDisposable
    {
        private readonly TempDir _dir = new();
        public string StartupFolder => Path.Combine(_dir.Path, "Startup");
        public string Script => _dir.File("scripts\\watchdog.ps1");
        public string Exe => _dir.File("PolaKiosk.exe");

        public Install(bool installed = true)
        {
            if (!installed) return;
            Directory.CreateDirectory(Path.GetDirectoryName(Script)!);
            File.WriteAllText(Script, "# watchdog");
            File.WriteAllText(Exe, "");
        }

        public WindowsStartup Startup() => new(StartupFolder, Script, Exe);
        public void Dispose() => _dir.Dispose();
    }

    [Fact]
    public void Disabled_without_the_shortcut()
    {
        using var install = new Install();

        var startup = install.Startup();

        startup.IsAvailable.Should().BeTrue();
        startup.IsEnabled.Should().BeFalse("à l'installation, la borne ne démarre pas avec Windows");
    }

    [Fact]
    public void Enable_creates_the_watchdog_shortcut_then_disable_removes_it()
    {
        using var install = new Install();
        var startup = install.Startup();

        startup.SetEnabled(true);

        startup.IsEnabled.Should().BeTrue();
        File.Exists(Path.Combine(install.StartupFolder, "PolaKiosk Watchdog.lnk")).Should().BeTrue();
        var (target, arguments) = ReadShortcut(startup.ShortcutPath);
        target.Should().EndWith(@"\WindowsPowerShell\v1.0\powershell.exe");
        arguments.Should().Be($"-WindowStyle Hidden -ExecutionPolicy Bypass -File \"{install.Script}\" -ExePath \"{install.Exe}\"");

        startup.SetEnabled(true); // déjà coché : remplacé, pas d'erreur
        startup.SetEnabled(false);
        startup.SetEnabled(false); // déjà décoché : rien à faire

        startup.IsEnabled.Should().BeFalse();
    }

    [Fact]
    public void Not_installed_cannot_be_enabled()
    {
        using var install = new Install(installed: false);
        var startup = install.Startup();

        startup.IsAvailable.Should().BeFalse();
        startup.Invoking(s => s.SetEnabled(true)).Should().Throw<FileNotFoundException>();
        startup.IsEnabled.Should().BeFalse();
    }

    [Fact]
    public void Installer_no_longer_adds_the_shortcut_but_removes_it_on_uninstall()
    {
        var iss = File.ReadAllText(Repo("installer", "PolaKiosk.iss"));

        iss.Should().NotMatchRegex(@"(?m)^Name: ""\{userstartup\}", "désactivé par défaut à l'installation");
        iss.Should().Contain("Type: files; Name: \"{userstartup}\\{#AppName} Watchdog.lnk\"");
        WindowsStartup.ShortcutName.Should().Be("PolaKiosk Watchdog.lnk", "même nom que le raccourci des anciens installeurs");
    }

    [Fact]
    public void Watchdog_script_takes_the_mutex_the_app_looks_for()
    {
        var script = File.ReadAllText(Repo("scripts", "watchdog.ps1"));

        script.Should().Contain($"\"{WatchdogLauncher.MutexName}\"");
        script.Should().Contain("[string]$ExePath");
    }

    private static (string Target, string Arguments) ReadShortcut(string path)
    {
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
        try
        {
            dynamic link = shell.CreateShortcut(path);
            return ((string)link.TargetPath, (string)link.Arguments);
        }
        finally { Marshal.FinalReleaseComObject(shell); }
    }

    private static string Repo(string folder, string file, [CallerFilePath] string here = "")
        => Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, "..", "..", folder, file));
}
