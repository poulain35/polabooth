using System.IO;

namespace PolaKiosk.Services;

/// <summary>Animation d'une séance (GIF, LAB-237) : clip MP4, affiche JPEG, durée et taille du clip.</summary>
public sealed record AnimationClip(string VideoPath, string PosterPath, int DurationMs, int Width, int Height);

/// <summary>
/// Dossier de l'animation d'une séance : <c>animations\{sessionId}\</c> (<c>clip.mp4</c>,
/// <c>poster.jpg</c>) à côté de <c>composites\</c>, dans le dossier de l'événement ou dans
/// <c>pending\{sessionId}\</c> (déplacé tel quel à la validation du questionnaire).
/// Statique : la galerie retrouve l'animation d'un montage sans la base.
/// </summary>
public static class SessionAnimation
{
    public const string DirectoryName = "animations";

    /// <summary>Dossier de l'animation pour le dossier des montages <paramref name="compositesDirectory"/>.</summary>
    public static string DirectoryFor(string compositesDirectory, Guid sessionId)
    {
        var parent = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(compositesDirectory)) ?? compositesDirectory;
        return Path.Combine(parent, DirectoryName, sessionId.ToString("D"));
    }

    /// <summary>
    /// Clip et affiche de la séance du montage, s'ils sont sur le disque ; null sinon (séance photo,
    /// animation indisponible ou supprimée). Durée et taille inconnues ici : 0.
    /// </summary>
    public static AnimationClip? Find(string compositePath, Guid sessionId)
    {
        var compositesDirectory = Path.GetDirectoryName(compositePath);
        if (string.IsNullOrEmpty(compositesDirectory) || sessionId == Guid.Empty) return null;

        var dir    = DirectoryFor(compositesDirectory, sessionId);
        var video  = Path.Combine(dir, AnimationService.VideoFileName);
        var poster = Path.Combine(dir, AnimationService.PosterFileName);
        return File.Exists(video) && File.Exists(poster) ? new AnimationClip(video, poster, 0, 0, 0) : null;
    }

    /// <summary>Animation de la galerie : séance lue dans le .share.json du montage.</summary>
    public static AnimationClip? FindForComposite(string compositePath)
    {
        try
        {
            return ShareInfoFile.Read(compositePath)?.SessionId is { } sessionId ? Find(compositePath, sessionId) : null;
        }
        catch { return null; /* fichier de partage illisible : montage seul */ }
    }
}
