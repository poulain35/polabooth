using System.IO;
using System.Text;

namespace PolaKiosk.Services;

/// <summary>
/// Écriture atomique : contenu écrit dans un fichier temporaire du même dossier, forcé sur le
/// disque, puis substitué au fichier final. Une coupure de courant laisse l'ancien fichier ou le
/// nouveau, jamais un fichier tronqué.
/// </summary>
internal static class AtomicFile
{
    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    public static void WriteAllText(string path, string contents)
        => WriteAllBytes(path, Utf8NoBom.GetBytes(contents));

    public static void WriteAllBytes(string path, byte[] bytes)
        => Write(path, stream => stream.Write(bytes));

    public static Task WriteAllTextAsync(string path, string contents)
        => Task.Run(() => WriteAllText(path, contents));

    public static void Write(string path, Action<Stream> write)
    {
        var fullPath = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        // Nom temporaire unique : deux écritures simultanées du même fichier ne se gênent pas.
        var tmp = $"{fullPath}.{Guid.NewGuid():N}.tmp";
        try
        {
            using (var stream = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                write(stream);
                stream.Flush(flushToDisk: true);
            }
            File.Move(tmp, fullPath, overwrite: true);
        }
        catch
        {
            try { File.Delete(tmp); } catch { /* fichier temporaire seulement : l'erreur d'origine prime */ }
            throw;
        }
    }

    public static async Task WriteAsync(string path, Func<Stream, CancellationToken, Task> write, CancellationToken ct = default)
    {
        var fullPath = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        var tmp = $"{fullPath}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var stream = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                             bufferSize: 81920, useAsync: true))
            {
                await write(stream, ct);
                await stream.FlushAsync(ct);
                stream.Flush(flushToDisk: true);
            }
            File.Move(tmp, fullPath, overwrite: true);
        }
        catch
        {
            try { File.Delete(tmp); } catch { /* fichier temporaire seulement : l'erreur d'origine prime */ }
            throw;
        }
    }
}
