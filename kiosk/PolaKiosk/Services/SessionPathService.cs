using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace PolaKiosk.Services;

/// <summary>
/// Dossiers d'un événement : <c>{DataDirectory}\events\{nom}_{id8}\</c> avec <c>originals\</c>
/// (photos du Canon), <c>composites\</c> (montages imprimés et envoyés) et
/// <c>composites\thumbs\</c> (vignettes de la galerie, voir <see cref="CompositeThumbnail"/>).
/// </summary>
public class SessionPathService
{
    private readonly AppSettings _settings;

    public SessionPathService(AppSettings settings)
    {
        _settings = settings;
    }

    /// <summary>Racine des dossiers d'événements : seul endroit où le nettoyage du PC supprime.</summary>
    public string GetEventsRoot()
        => KioskPaths.From(_settings).EventsDirectory;

    public string GetEventDirectory(string eventName, Guid eventId)
    {
        var safe = Regex.Replace(eventName ?? "", @"[^\w\-]", "_").Trim('_');
        if (string.IsNullOrEmpty(safe)) safe = "event";
        return Path.Combine(GetEventsRoot(), $"{safe}_{ShortId(eventId)}");
    }

    /// <summary>8 premiers caractères de l'ID (hex) : suffixe du dossier de l'événement.</summary>
    public static string ShortId(Guid eventId) => eventId.ToString("N")[..8];

    /// <summary>Suffixe <c>_{id8}</c> d'un nom de dossier d'événement, ou null si le nom ne vient pas du kiosk.</summary>
    public static string? ShortIdFromDirectoryName(string directoryName)
    {
        var match = Regex.Match(directoryName, "_([0-9a-f]{8})$");
        return match.Success ? match.Groups[1].Value : null;
    }

    public string GetOriginalsDirectory(string eventName, Guid eventId)
        => Path.Combine(GetEventDirectory(eventName, eventId), "originals");

    public string GetCompositesDirectory(string eventName, Guid eventId)
        => Path.Combine(GetEventDirectory(eventName, eventId), "composites");

    public void EnsureDirectoriesExist(string eventName, Guid eventId)
    {
        Directory.CreateDirectory(GetOriginalsDirectory(eventName, eventId));
        Directory.CreateDirectory(GetCompositesDirectory(eventName, eventId));
    }

    // ── Photo en attente (questionnaire obligatoire, LAB-222) ─────────────────────────────
    // Hors du dossier des événements : ni la galerie, ni la vignette de l'accueil, ni la boucle
    // d'envoi ne la voient. Même disque que les événements : File.Move à la validation.

    /// <summary>Racine des photos en attente de validation : <c>{DataDirectory}\pending\</c>.</summary>
    public string GetPendingRoot()
        => KioskPaths.From(_settings).PendingDirectory;

    /// <summary>
    /// Dossier d'attente d'une séance : même structure que le dossier de l'événement
    /// (<c>originals\</c>, <c>composites\</c>, <c>composites\thumbs\</c>) pour un déplacement 1 pour 1.
    /// </summary>
    public string GetPendingDirectory(Guid sessionId)
        => Path.Combine(GetPendingRoot(), sessionId.ToString("D"));

    public string GetPendingOriginalsDirectory(Guid sessionId)
        => Path.Combine(GetPendingDirectory(sessionId), "originals");

    public string GetPendingCompositesDirectory(Guid sessionId)
        => Path.Combine(GetPendingDirectory(sessionId), "composites");

    public void EnsurePendingDirectoriesExist(Guid sessionId)
    {
        Directory.CreateDirectory(GetPendingOriginalsDirectory(sessionId));
        Directory.CreateDirectory(GetPendingCompositesDirectory(sessionId));
    }

    /// <summary>Composites de l'événement, du plus récent au plus ancien (pour la galerie accueil).</summary>
    public IReadOnlyList<string> GetCompositeFiles(string eventName, Guid eventId)
    {
        var dir = GetCompositesDirectory(eventName, eventId);
        if (!Directory.Exists(dir)) return Array.Empty<string>();

        // Dossier composites seul (pas thumbs\).
        return Directory.EnumerateFiles(dir)
            .Where(f => f.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase)
                     || f.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase)
                     || f.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(File.GetCreationTimeUtc)
            .ToList();
    }
}
