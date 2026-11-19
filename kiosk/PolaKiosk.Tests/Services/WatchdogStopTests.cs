using System.Runtime.CompilerServices;
using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>« Quitter vers Windows » : fichier stop.flag lu par scripts\watchdog.ps1.</summary>
public class WatchdogStopTests
{
    [Fact]
    public void Request_creates_the_flag_even_without_the_folder()
    {
        using var dir = new TempDir();
        var folder = Path.Combine(dir.Path, "PolaKiosk");

        WatchdogStop.Request(folder);

        File.Exists(Path.Combine(folder, "stop.flag")).Should().BeTrue();
    }

    [Fact]
    public void Clear_removes_the_flag_and_ignores_a_missing_one()
    {
        using var dir = new TempDir();
        WatchdogStop.Request(dir.Path);

        WatchdogStop.Clear(dir.Path);
        WatchdogStop.Clear(dir.Path);

        File.Exists(dir.File("stop.flag")).Should().BeFalse();
    }

    [Fact]
    public void Watchdog_script_reads_the_same_file()
    {
        var script = File.ReadAllText(WatchdogScript());

        script.Should().Contain($"Join-Path $dataDir \"{WatchdogStop.FileName}\"");
    }

    private static string WatchdogScript([CallerFilePath] string here = "")
        => Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, "..", "..", "scripts", "watchdog.ps1"));
}
