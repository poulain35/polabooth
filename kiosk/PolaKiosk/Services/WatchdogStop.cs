using System.IO;

namespace PolaKiosk.Services;

/// <summary>
/// « Quitter vers Windows » : fichier <c>stop.flag</c> de <c>%LocalAppData%\PolaKiosk</c>. Tant qu'il
/// existe, <c>scripts\watchdog.ps1</c> ne relance pas l'app. Le watchdog le supprime à l'ouverture de
/// session suivante, l'app à son démarrage (lancée à la main) : la surveillance reprend.
/// </summary>
public static class WatchdogStop
{
    public const string FileName = "stop.flag";

    public static string PathIn(string directory) => Path.Combine(directory, FileName);

    /// <summary>Pose le fichier. Une erreur remonte : sans lui, le watchdog relancerait l'app.</summary>
    public static void Request(string directory)
    {
        Directory.CreateDirectory(directory);
        File.WriteAllText(PathIn(directory), DateTimeOffset.Now.ToString("O"));
    }

    /// <summary>Retire le fichier s'il existe ; jamais d'erreur (au pire, la relance reste suspendue).</summary>
    public static void Clear(string directory)
    {
        try { File.Delete(PathIn(directory)); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}
