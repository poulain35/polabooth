namespace PolaKiosk.Services;

/// <summary>
/// Série de prises au flash (GIF, LAB-237, méthode A de la spec LAB-207) : la prise d'une photo
/// répétée N fois, avec un temps propre à l'écran avant et après chaque prise. Aucune commande
/// nouvelle de l'appareil : la même boucle sert au Canon, à la webcam et à la caméra simulée.
/// </summary>
public static class CameraSequence
{
    /// <summary>
    /// Prend <paramref name="shots"/> photos dans <paramref name="outputDirectory"/>, dans l'ordre.
    /// <paramref name="beforeShot"/> (numéro 1 à N) précède chaque prise : compte à rebours, « k/N »,
    /// flash, arrêt du live view. <paramref name="afterShot"/> (numéro, chemin) la suit. Une prise en
    /// échec ou l'annulation arrête la série (exception) : aucune série partielle n'est renvoyée.
    /// </summary>
    public static async Task<IReadOnlyList<string>> CaptureSequenceAsync(
        this ICameraService camera,
        string outputDirectory,
        int shots,
        Func<int, CancellationToken, Task> beforeShot,
        Func<int, string, CancellationToken, Task> afterShot,
        CancellationToken token)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(shots, 1);
        var paths = new List<string>(shots);
        for (int shot = 1; shot <= shots; shot++)
        {
            token.ThrowIfCancellationRequested();
            await beforeShot(shot, token);
            token.ThrowIfCancellationRequested();
            var path = await camera.CaptureAsync(outputDirectory);
            paths.Add(path);
            await afterShot(shot, path, token);
        }
        return paths;
    }
}
