using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace PolaKiosk.Services;

/// <summary>
/// Lancement de la borne à l'ouverture de session Windows (case « Démarrage de Windows » de l'Admin).
/// Le réglage est le raccourci « PolaKiosk Watchdog » du dossier Démarrage de l'utilisateur : présent, le
/// watchdog lance l'app à chaque ouverture de session. Depuis la 1.0.22, l'installeur ne le pose plus
/// (désactivé par défaut) ; une borne installée avant le garde, donc continue de démarrer seule.
/// </summary>
public interface IWindowsStartup
{
    /// <summary>App installée (scripts\watchdog.ps1 à côté de l'exe) : sinon (développement) la case est grisée.</summary>
    bool IsAvailable { get; }

    /// <summary>Raccourci présent dans le dossier Démarrage.</summary>
    bool IsEnabled { get; }

    /// <summary>Pose ou retire le raccourci. Une erreur remonte (dossier inaccessible…).</summary>
    void SetEnabled(bool enabled);
}

public sealed class WindowsStartup : IWindowsStartup
{
    /// <summary>Nom du raccourci, le même que celui des installeurs jusqu'à la 1.0.21 (repris tel quel).</summary>
    public const string ShortcutName = "PolaKiosk Watchdog.lnk";

    private readonly string _startupFolder;
    private readonly string _scriptPath;
    private readonly string _exePath;

    public WindowsStartup() : this(
        Environment.GetFolderPath(Environment.SpecialFolder.Startup),
        WatchdogLauncher.DefaultScriptPath,
        Environment.ProcessPath ?? "")
    { }

    internal WindowsStartup(string startupFolder, string scriptPath, string exePath)
    {
        _startupFolder = startupFolder;
        _scriptPath = scriptPath;
        _exePath = exePath;
    }

    public string ShortcutPath => Path.Combine(_startupFolder, ShortcutName);

    public bool IsAvailable => File.Exists(_scriptPath) && File.Exists(_exePath);

    public bool IsEnabled => File.Exists(ShortcutPath);

    public void SetEnabled(bool enabled)
    {
        if (!enabled)
        {
            File.Delete(ShortcutPath); // absent : rien à faire, pas d'erreur
            return;
        }
        if (!IsAvailable) throw new FileNotFoundException("Watchdog de la borne introuvable.", _scriptPath);
        Directory.CreateDirectory(_startupFolder);
        CreateShortcut(ShortcutPath, UpdateService.PowerShellPath,
            WatchdogLauncher.Arguments(_scriptPath, _exePath), Path.GetDirectoryName(_exePath) ?? "");
    }

    /// <summary>Raccourci Windows (.lnk) par WScript.Shell, présent sur tout Windows 10 ou 11.</summary>
    private static void CreateShortcut(string path, string target, string arguments, string workingDir)
    {
        var type = Type.GetTypeFromProgID("WScript.Shell")
                   ?? throw new InvalidOperationException("WScript.Shell indisponible : raccourci impossible à créer.");
        dynamic shell = Activator.CreateInstance(type)!;
        try
        {
            dynamic link = shell.CreateShortcut(path);
            try
            {
                link.TargetPath = target;
                link.Arguments = arguments;
                link.WorkingDirectory = workingDir;
                link.WindowStyle = 7; // réduit : la console de PowerShell ne s'affiche pas en grand
                link.Description = "Lance PolaKiosk à l'ouverture de session et le relance s'il s'arrête.";
                link.Save();
            }
            finally { Marshal.FinalReleaseComObject(link); }
        }
        finally { Marshal.FinalReleaseComObject(shell); }
    }
}

/// <summary>
/// Le watchdog relance l'app si elle plante et après une mise à jour. Lancé par le raccourci du dossier
/// Démarrage quand la case est cochée ; sinon l'app le lance elle-même à son démarrage, sans quoi une
/// borne ouverte à la main ne se relancerait ni après un plantage ni après une mise à jour.
/// </summary>
public static class WatchdogLauncher
{
    /// <summary>Mutex pris par scripts\watchdog.ps1 (un seul watchdog par session).</summary>
    public const string MutexName = @"Local\PolaKiosk.Watchdog";

    public static string DefaultScriptPath => Path.Combine(AppContext.BaseDirectory, "scripts", "watchdog.ps1");

    public static string Arguments(string scriptPath, string exePath)
        => $"-WindowStyle Hidden -ExecutionPolicy Bypass -File \"{scriptPath}\" -ExePath \"{exePath}\"";

    public static bool IsRunning()
    {
        if (!Mutex.TryOpenExisting(MutexName, out var mutex)) return false;
        mutex.Dispose();
        return true;
    }

    /// <summary>
    /// Lance le watchdog s'il ne tourne pas déjà et si l'app est installée (script présent ; jamais en
    /// développement). Jamais d'erreur : sans watchdog, la borne marche, sans relance automatique.
    /// </summary>
    public static void EnsureRunning()
    {
        try
        {
            var exe = Environment.ProcessPath;
            var script = DefaultScriptPath;
            if (string.IsNullOrEmpty(exe) || !File.Exists(script) || IsRunning()) return;
            Process.Start(new ProcessStartInfo(UpdateService.PowerShellPath, Arguments(script, exe))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(exe) ?? AppContext.BaseDirectory,
            })?.Dispose();
        }
        catch (Exception ex) { FatalLog.Write("watchdog", ex); }
    }
}
