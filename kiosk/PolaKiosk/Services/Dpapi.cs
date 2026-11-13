using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace PolaKiosk.Services;

/// <summary>
/// Fichiers protégés par DPAPI (portée utilisateur Windows) : illisibles hors de la session
/// qui les a écrits, et donc liés au poste. Chaque usage a sa propre entropie.
/// </summary>
internal static class Dpapi
{
    public static byte[] Protect(byte[] data, string purpose)
        => ProtectedData.Protect(data, Entropy(purpose), DataProtectionScope.CurrentUser);

    public static byte[] Unprotect(byte[] data, string purpose)
        => ProtectedData.Unprotect(data, Entropy(purpose), DataProtectionScope.CurrentUser);

    /// <summary>Écriture atomique (fichier temporaire puis remplacement) : pas de fichier à moitié écrit.</summary>
    public static void WriteFile(string path, byte[] data, string purpose)
        => AtomicFile.WriteAllBytes(path, Protect(data, purpose));

    /// <summary>Contenu déchiffré, ou null si le fichier est absent, modifié ou écrit par une autre session.</summary>
    public static byte[]? TryReadFile(string path, string purpose)
    {
        try
        {
            return File.Exists(path) ? Unprotect(File.ReadAllBytes(path), purpose) : null;
        }
        catch (Exception ex) when (ex is CryptographicException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static byte[] Entropy(string purpose) => Encoding.UTF8.GetBytes(purpose);
}
