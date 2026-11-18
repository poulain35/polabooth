using System.IO;
using System.Text.RegularExpressions;
using Newtonsoft.Json;

namespace PolaKiosk.Services;

/// <summary>Un .pola déjà importé, gardé sur la borne pour être rechargé depuis l'Admin (LAB-321).</summary>
public sealed record PolaHistoryEntry(
    string FileName,
    Guid EventId,
    Guid DesignId,
    string EventName,
    DateTimeOffset? StartDate,
    DateTimeOffset? EndDate,
    DateTimeOffset ImportedAt);

public interface IPolaHistory
{
    /// <summary>
    /// Archive le contenu d'un .pola importé. Même événement et même design qu'une entrée existante :
    /// l'entrée est remplacée (une seule, à la date du dernier import). Au-delà de
    /// <see cref="PolaHistory.MaxEntries"/>, les plus anciennes sont supprimées.
    /// </summary>
    PolaHistoryEntry Add(byte[] content, Guid eventId, Guid designId, string eventName,
        DateTimeOffset? startDate, DateTimeOffset? endDate);

    /// <summary>Entrées dont le fichier existe encore, la plus récente d'abord.</summary>
    IReadOnlyList<PolaHistoryEntry> List();

    /// <summary>Chemin du fichier archivé de l'entrée.</summary>
    string PathOf(PolaHistoryEntry entry);

    /// <summary>Retire l'entrée de la liste et supprime son fichier (fichier illisible ou disparu).</summary>
    void Remove(PolaHistoryEntry entry);
}

/// <summary>
/// Dossier <c>{DataDirectory}\pola-history\</c> : une copie de chaque .pola importé depuis l'Admin,
/// nommée <c>{yyyy-MM-dd_HH-mm-ss}_{nom}_{id8}.pola</c> (heure de Paris), et <c>history.json</c> qui
/// décrit chaque copie (événement, dates, design, date d'import). Hors de <c>pola\</c> : la saisie
/// du code sans réseau n'y cherche pas.
/// </summary>
public sealed class PolaHistory : IPolaHistory
{
    public const int MaxEntries = 20;
    public const string IndexFileName = "history.json";

    private readonly string _directory;
    private readonly Func<DateTimeOffset> _now;
    private readonly object _gate = new();

    public PolaHistory(string dataDirectory, Func<DateTimeOffset>? now = null)
    {
        _directory = new KioskPaths(dataDirectory).PolaHistoryDirectory;
        _now = now ?? (() => DateTimeOffset.Now);
    }

    public PolaHistoryEntry Add(byte[] content, Guid eventId, Guid designId, string eventName,
        DateTimeOffset? startDate, DateTimeOffset? endDate)
    {
        lock (_gate)
        {
            var importedAt = _now();
            var entry = new PolaHistoryEntry(FileNameFor(importedAt, eventName, eventId), eventId, designId,
                eventName, startDate, endDate, importedAt);
            AtomicFile.WriteAllBytes(PathOf(entry), content);

            var kept = ReadIndex()
                .Where(e => !IsSameFile(e, entry) && e.FileName != entry.FileName)
                .Prepend(entry)
                .OrderByDescending(e => e.ImportedAt)
                .Take(MaxEntries)
                .ToList();
            WriteIndex(kept);
            DeleteFilesNotIn(kept);
            return entry;
        }
    }

    public IReadOnlyList<PolaHistoryEntry> List()
    {
        lock (_gate)
        {
            var all = ReadIndex();
            var present = all.Where(e => File.Exists(PathOf(e))).OrderByDescending(e => e.ImportedAt).ToList();
            if (present.Count != all.Count) WriteIndex(present);
            return present;
        }
    }

    public string PathOf(PolaHistoryEntry entry) => Path.Combine(_directory, Path.GetFileName(entry.FileName));

    public void Remove(PolaHistoryEntry entry)
    {
        lock (_gate)
        {
            WriteIndex(ReadIndex().Where(e => e.FileName != entry.FileName).ToList());
            TryDelete(PathOf(entry));
        }
    }

    /// <summary>
    /// Doublon = même événement et même design. Le SaaS garde un seul design par événement : un
    /// nouvel export du même événement remplace donc l'ancien, même si son contenu a changé.
    /// </summary>
    internal static bool IsSameFile(PolaHistoryEntry a, PolaHistoryEntry b)
        => a.EventId == b.EventId && a.DesignId == b.DesignId;

    /// <summary>Nom du fichier archivé : date et heure de l'import (Paris), nom de l'événement, id court.</summary>
    internal static string FileNameFor(DateTimeOffset importedAt, string eventName, Guid eventId)
    {
        var paris = TimeZoneInfo.ConvertTime(importedAt, EventDateFormatter.Paris);
        var safe = Regex.Replace(eventName ?? "", @"[^\w\-]+", "_").Trim('_');
        if (safe.Length > 60) safe = safe[..60].TrimEnd('_');
        if (safe.Length == 0) safe = "evenement";
        return $"{paris:yyyy-MM-dd_HH-mm-ss}_{safe}_{SessionPathService.ShortId(eventId)}.pola";
    }

    private string IndexPath => Path.Combine(_directory, IndexFileName);

    private List<PolaHistoryEntry> ReadIndex()
    {
        try
        {
            if (!File.Exists(IndexPath)) return [];
            var entries = JsonConvert.DeserializeObject<List<PolaHistoryEntry>>(File.ReadAllText(IndexPath));
            return entries?.Where(e => e != null && !string.IsNullOrWhiteSpace(e.FileName)).ToList() ?? [];
        }
        // Index abîmé : liste vide ; les fichiers qu'il décrivait sont supprimés au prochain import.
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    private void WriteIndex(List<PolaHistoryEntry> entries)
        => AtomicFile.WriteAllText(IndexPath, JsonConvert.SerializeObject(entries, Formatting.Indented));

    private void DeleteFilesNotIn(List<PolaHistoryEntry> kept)
    {
        var names = kept.Select(e => e.FileName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var file in Directory.EnumerateFiles(_directory, "*.pola"))
            if (!names.Contains(Path.GetFileName(file))) TryDelete(file);
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Fichier en cours d'usage : retenté au prochain import (hors de la liste, plus proposé).
        }
    }
}
