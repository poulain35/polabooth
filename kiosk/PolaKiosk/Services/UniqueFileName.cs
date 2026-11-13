namespace PolaKiosk.Services;

/// <summary>
/// Noms de fichiers photo / montage : horodatés pour le tri chronologique, avec un suffixe
/// aléatoire pour qu'aucune prise ni aucun montage ne remplace le précédent dans la même milliseconde.
/// </summary>
internal static class UniqueFileName
{
    public static string Create(string prefix, string extension)
        => $"{prefix}_{DateTime.Now:yyyyMMdd_HHmmss_fff}_{Guid.NewGuid().ToString("N")[..8]}{extension}";
}
