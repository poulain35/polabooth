using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace PolaKiosk.Services;

/// <summary>Une entrée de fatal.log : heure locale du PC (à la seconde), contexte, texte (plusieurs lignes possibles).</summary>
public sealed record FatalLogEntry(DateTime LocalTime, string Context, string Message);

/// <summary>Journal kiosk tiré d'une entrée de fatal.log (LAB-332).</summary>
public sealed record ReplayedLog(string Level, string Context, string Message, string? StackTrace);

/// <summary>
/// Lecture de fatal.log (format exact de <see cref="FatalLog.Write(string, string)"/> :
/// <c>[yyyy-MM-dd HH:mm:ss] [contexte] texte</c>, le texte pouvant courir sur plusieurs lignes) et choix
/// des entrées à recopier dans les journaux kiosk. Logique pure : ne lève jamais, quel que soit le texte.
/// </summary>
public static partial class FatalLogParser
{
    private const string TimeFormat = "yyyy-MM-dd HH:mm:ss";

    /// <summary>Taille gardée d'une entrée à la lecture : bien au-delà des limites de la RPC (2000 + 4000).</summary>
    private const int MaxEntryLength = 16_000;

    [GeneratedRegex(@"^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[([^\]\r\n]{0,200})\] ?(.*)$")]
    private static partial Regex HeaderRegex();

    public static IReadOnlyList<FatalLogEntry> Parse(string? text)
    {
        var entries = new List<FatalLogEntry>();
        if (string.IsNullOrEmpty(text)) return entries;

        DateTime time = default;
        string? context = null;
        var message = new StringBuilder();

        void Flush()
        {
            if (context != null)
                entries.Add(new FatalLogEntry(time, context, message.ToString().TrimEnd('\r', '\n', ' ', '\t')));
            message.Clear();
        }

        foreach (var raw in text.Split('\n'))
        {
            var line = Clean(raw.TrimEnd('\r'));
            var header = HeaderRegex().Match(line);
            if (header.Success && DateTime.TryParseExact(header.Groups[1].Value, TimeFormat,
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
            {
                Flush();
                time = DateTime.SpecifyKind(parsed, DateTimeKind.Unspecified);
                context = header.Groups[2].Value.Trim();
                message.Append(header.Groups[3].Value);
            }
            else if (context != null && message.Length < MaxEntryLength)
            {
                // Suite de l'entrée en cours (pile d'appels). Avant la première entrée : ignoré (fichier abîmé).
                message.Append('\n').Append(line);
            }
        }
        Flush();
        return entries;
    }

    /// <summary>
    /// Entrées recopiées dans les journaux kiosk, toutes absentes de kiosk_logs aujourd'hui :
    /// <list type="bullet">
    /// <item><c>app</c> : exception non gérée, le processus s'arrête (erreur) ;</item>
    /// <item>arrêt volontaire pour le watchdog (<see cref="FatalLog.WatchdogExitNotice"/>), contexte d'origine
    /// <c>startup</c>, <c>ui</c>, <c>ui-recovery</c> (erreur) ;</item>
    /// <item><c>network-event</c> : exception d'un abonné au réseau, sans arrêt (erreur) ;</item>
    /// <item><c>exit</c> et <c>restart</c> : fermeture de la caméra ou de l'hôte, relance après changement de
    /// SaaS (avertissement : pas un plantage, mais utile au diagnostic).</item>
    /// </list>
    /// Écartées : « déjà lancé » (<c>startup</c> sans arrêt, pas une erreur) et toutes les autres, qui viennent
    /// de <c>App.LogError</c> et sont déjà dans kiosk_logs (recopiées, elles feraient doublon).
    /// </summary>
    public static ReplayedLog? Classify(FatalLogEntry entry)
    {
        var text = entry.Message.Trim();
        if (text.EndsWith(FatalLog.WatchdogExitNotice, StringComparison.Ordinal))
        {
            var reason = text[..^FatalLog.WatchdogExitNotice.Length].TrimEnd();
            return Build("error", entry.Context, "Arrêt de l'application, relancée par le watchdog : ", reason);
        }

        return entry.Context switch
        {
            "app"           => Build("error",   "app", "Plantage de l'application : ", text),
            "network-event" => Build("error",   "network-event", "Erreur au changement de réseau : ", text),
            "exit"          => Build("warning", "exit", "À la fermeture : ", text),
            "restart"       => Build("warning", "restart", "Relance impossible : ", text),
            _               => null,
        };
    }

    /// <summary>
    /// Identifiant stable d'une entrée sur une borne : la même entrée relue donne le même id, donc ni la
    /// base locale ni la RPC (idempotente sur id) ne l'enregistrent deux fois. La borne fait partie du
    /// calcul : deux bornes au même plantage à la même seconde gardent chacune leur ligne.
    /// </summary>
    public static Guid IdOf(FatalLogEntry entry, string machineId)
    {
        var key = $"fatal.log\n{machineId}\n{entry.LocalTime.ToString(TimeFormat, CultureInfo.InvariantCulture)}\n{entry.Context}\n{entry.Message}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(key)).AsSpan(0, 16).ToArray();
        bytes[7] = (byte)((bytes[7] & 0x0F) | 0x50); // version 5 (empreinte), octets dans l'ordre de System.Guid
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80); // variante RFC 4122
        return new Guid(bytes);
    }

    /// <summary>Heure locale du PC → UTC. Heure sautée au passage à l'heure d'été : décalée d'une heure.</summary>
    public static DateTime ToUtc(DateTime localTime, TimeZoneInfo zone)
    {
        var local = DateTime.SpecifyKind(localTime, DateTimeKind.Unspecified);
        try
        {
            if (zone.IsInvalidTime(local)) local = local.AddHours(1);
            return TimeZoneInfo.ConvertTimeToUtc(local, zone);
        }
        catch (ArgumentException)
        {
            return DateTime.SpecifyKind(local - zone.BaseUtcOffset, DateTimeKind.Utc);
        }
    }

    /// <summary>
    /// Message = lignes avant la pile d'appels (type et message de l'exception, raison de l'arrêt) ;
    /// pile = le reste.
    /// </summary>
    private static ReplayedLog Build(string level, string context, string prefix, string text)
    {
        var lines = text.Split('\n');
        var split = Array.FindIndex(lines, IsStackLine);
        if (split < 0) split = lines.Length;
        var head = string.Join("\n", lines[..split]).Trim();
        var stack = string.Join("\n", lines[split..]).Trim();
        return new ReplayedLog(level, context,
            prefix + (head.Length > 0 ? head : "(sans message)"),
            stack.Length > 0 ? stack : null);
    }

    private static bool IsStackLine(string line)
    {
        var t = line.TrimStart();
        return t.StartsWith("at ", StringComparison.Ordinal) || t.StartsWith("--- End of", StringComparison.Ordinal);
    }

    /// <summary>Caractères de contrôle retirés (NUL d'un fichier abîmé : refusé par Postgres dans du JSON).</summary>
    private static string Clean(string line)
    {
        if (!line.Any(c => char.IsControl(c) && c != '\t')) return line;
        return new string(line.Where(c => !char.IsControl(c) || c == '\t').ToArray());
    }
}
