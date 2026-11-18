using System.IO;
using System.Text;
using Newtonsoft.Json;

namespace PolaKiosk.Services;

/// <summary>
/// Marque de position de <see cref="FatalLogForwarder"/> : heure (locale, à la seconde) de la dernière entrée
/// de fatal.log déjà lue, et ids des entrées de cette seconde-là. Une heure plutôt qu'une position dans le
/// fichier : elle survit à la rotation (fatal.log.old), à la troncature et à la suppression du fichier.
/// </summary>
public sealed record FatalLogMark(
    [property: JsonProperty("last_time")] DateTime LastTime,
    [property: JsonProperty("ids")] IReadOnlyList<Guid> Ids)
{
    public bool HasRead(FatalLogEntry entry, Guid id)
        => entry.LocalTime < LastTime || (entry.LocalTime == LastTime && Ids.Contains(id));

    /// <summary>Marque après lecture de <paramref name="entries"/> (non vide) : la plus récente seconde lue.</summary>
    public static FatalLogMark After(IReadOnlyList<(FatalLogEntry Entry, Guid Id)> entries, FatalLogMark? previous)
    {
        var last = entries.Max(e => e.Entry.LocalTime);
        if (previous != null && previous.LastTime > last) return previous; // rien de plus récent que la marque
        var ids = entries.Where(e => e.Entry.LocalTime == last).Select(e => e.Id);
        if (previous != null && previous.LastTime == last) ids = ids.Concat(previous.Ids);
        return new FatalLogMark(last, ids.Distinct().ToList());
    }
}

/// <summary>
/// LAB-332 : au démarrage, recopie dans les journaux kiosk les plantages de fatal.log écrits depuis le
/// dernier passage (<see cref="FatalLogParser.Classify"/>), à leur heure d'origine. Ils partent ensuite
/// avec la synchro habituelle (kiosk_record_logs). Ne lève jamais : fichier absent, illisible ou abîmé,
/// la borne démarre normalement.
/// </summary>
public sealed class FatalLogForwarder
{
    /// <summary>
    /// Au-delà, l'entrée n'est pas envoyée (elle reste dans fatal.log) : l'alerte du SaaS ne regarde que les
    /// 30 dernières minutes, et une borne restée éteinte longtemps ou une première installation de cette
    /// version n'ont pas à vider tout l'historique dans le SaaS. Une ligne de bilan les compte.
    /// </summary>
    internal static readonly TimeSpan MaxAge = TimeSpan.FromDays(7);

    /// <summary>Entrées recopiées au plus par démarrage, les plus récentes (limite de débit : 600 lignes / 15 min).</summary>
    internal const int MaxEntriesPerStart = 50;

    /// <summary>Lecture bornée de chaque fichier (fatal.log tourne à 1 Mo) : fichier anormal, on garde la fin.</summary>
    private const long MaxReadBytes = 4_000_000;

    internal const string LogContext = "fatal-log";

    private readonly string _logPath;
    private readonly string _oldLogPath;
    private readonly string _markPath;
    private readonly IKioskLogService _log;
    private readonly string _machineId;
    private readonly TimeProvider _clock;
    private readonly TimeZoneInfo _zone;

    public FatalLogForwarder(string logPath, string oldLogPath, string markPath, IKioskLogService log, string machineId,
        TimeProvider? clock = null, TimeZoneInfo? zone = null)
    {
        _logPath    = logPath;
        _oldLogPath = oldLogPath;
        _markPath   = markPath;
        _log        = log;
        _machineId  = machineId;
        _clock      = clock ?? TimeProvider.System;
        _zone       = zone ?? TimeZoneInfo.Local; // FatalLog écrit l'heure locale du PC
    }

    /// <summary>Marque à côté de fatal.log (%LocalAppData%\PolaKiosk), hors du dossier de données.</summary>
    public static string MarkPathFor(string logPath)
        => Path.Combine(Path.GetDirectoryName(logPath) ?? "", "fatal-log-forwarded.json");

    /// <summary>Nombre d'entrées recopiées. Marque avancée seulement si toutes ont été écrites.</summary>
    public async Task<int> ForwardAsync()
    {
        try
        {
            // fatal.log d'abord : une rotation pendant la lecture donne des doublons (écartés), jamais de trou.
            var current = ReadShared(_logPath);
            var old     = ReadShared(_oldLogPath);
            var entries = FatalLogParser.Parse(old).Concat(FatalLogParser.Parse(current))
                .Select(e => (Entry: e, Id: FatalLogParser.IdOf(e, _machineId)))
                .DistinctBy(e => e.Id)
                .OrderBy(e => e.Entry.LocalTime)
                .ToList();

            var mark = ReadMark();
            var unread = entries.Where(e => mark?.HasRead(e.Entry, e.Id) != true).ToList();
            if (unread.Count == 0) return 0;

            var minUtc = _clock.GetUtcNow().UtcDateTime - MaxAge;
            var candidates = unread
                .Select(e => (e.Id, Log: FatalLogParser.Classify(e.Entry), Utc: FatalLogParser.ToUtc(e.Entry.LocalTime, _zone)))
                .Where(e => e.Log != null)
                .ToList();
            var recent = candidates.Where(e => e.Utc >= minUtc).ToList();
            var tooOld = candidates.Count - recent.Count;
            var dropped = Math.Max(0, recent.Count - MaxEntriesPerStart);
            var toSend = recent.Skip(dropped).ToList();

            foreach (var (id, log, utc) in toSend)
            {
                // Échec d'écriture : marque inchangée, nouvel essai au prochain démarrage (ids stables, sans doublon).
                if (!await _log.RecordPastAsync(id, log!.Level, log.Context, log.Message, log.StackTrace, utc))
                    return 0;
            }

            if (tooOld + dropped > 0)
                await _log.LogWarningAsync(LogContext, SkippedMessage(tooOld, dropped));

            WriteMark(FatalLogMark.After(unread, mark));
            return toSend.Count;
        }
        catch
        {
            return 0; // jamais bloquant pour le démarrage
        }
    }

    internal static string SkippedMessage(int tooOld, int dropped)
    {
        var parts = new List<string>();
        if (tooOld > 0) parts.Add($"{tooOld} de plus de {MaxAge.TotalDays:0} jours");
        if (dropped > 0) parts.Add($"{dropped} au-delà des {MaxEntriesPerStart} plus récentes");
        return $"Erreurs de fatal.log non envoyées : {string.Join(", ", parts)}. Elles restent dans fatal.log sur le PC.";
    }

    private static string ReadShared(string path)
    {
        try
        {
            if (!File.Exists(path)) return "";
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (stream.Length > MaxReadBytes) stream.Seek(-MaxReadBytes, SeekOrigin.End);
            // UTF-8 imposé (celui de FatalLog.Write) : un début abîmé ne doit pas passer pour un BOM UTF-16/32.
            using var reader = new StreamReader(stream, new UTF8Encoding(false), detectEncodingFromByteOrderMarks: false);
            return reader.ReadToEnd().TrimStart('﻿');
        }
        catch
        {
            return ""; // illisible (verrouillé, droits) : rien à recopier cette fois
        }
    }

    private FatalLogMark? ReadMark()
    {
        try
        {
            if (!File.Exists(_markPath)) return null;
            var mark = JsonConvert.DeserializeObject<FatalLogMark>(File.ReadAllText(_markPath));
            return mark is { Ids: not null } ? mark : null;
        }
        catch
        {
            return null; // marque abîmée : tout est relu, les ids stables évitent les doublons
        }
    }

    private void WriteMark(FatalLogMark mark)
    {
        try { AtomicFile.WriteAllText(_markPath, JsonConvert.SerializeObject(mark)); }
        catch { /* disque plein : relu au prochain démarrage, sans doublon */ }
    }
}
