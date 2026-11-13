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
    private static readonly object Gate = new();

    public static string FilePath { get; set; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PolaKiosk", "fatal.log");

    public static void Write(string context, Exception ex) => Write(context, ex.ToString());

    public static void Write(string context, string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
                if (File.Exists(FilePath) && new FileInfo(FilePath).Length > MaxBytes)
                    File.Move(FilePath, FilePath + ".old", overwrite: true);
                File.AppendAllText(FilePath,
                    $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] [{context}] {message}{Environment.NewLine}");
            }
        }
        catch { /* disque plein ou inaccessible : rien d'autre à faire */ }
    }
}
