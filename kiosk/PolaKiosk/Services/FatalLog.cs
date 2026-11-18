using System.IO;

namespace PolaKiosk.Services;

/// <summary>
/// Journal des erreurs graves, écrit de façon synchrone dans
/// <c>%LocalAppData%\PolaKiosk\fatal.log</c> (à côté de watchdog.log). Utilisable avant
/// l'initialisation de la base et juste avant un arrêt brutal : rien n'est perdu.
/// </summary>
public static class FatalLog
{
    private const long MaxBytes = 1_000_000;

    /// <summary>Dernière ligne d'un arrêt volontaire (App.ExitForWatchdog), reconnue par <see cref="FatalLogParser"/>.</summary>
    public const string WatchdogExitNotice = "Arrêt de l'application, relance par le watchdog.";

    /// <summary>Copie déplacée ici au-delà de 1 Mo (rotation).</summary>
    public static string OldFilePath => FilePath + ".old";
    private static readonly object Gate = new();

    public static string FilePath { get; set; } = Path.Combine(KioskPaths.LocalRoot, "fatal.log");

    public static void Write(string context, Exception ex) => Write(context, ex.ToString());

    public static void Write(string context, string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
                if (File.Exists(FilePath) && new FileInfo(FilePath).Length > MaxBytes)
                    File.Move(FilePath, OldFilePath, overwrite: true);
                File.AppendAllText(FilePath,
                    $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] [{context}] {message}{Environment.NewLine}");
            }
        }
        catch { /* disque plein ou inaccessible : rien d'autre à faire */ }
    }
}
