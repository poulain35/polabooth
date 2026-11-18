using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace PolaKiosk.Services;

/// <summary>Format de papier proposé par le pilote : nom et dimensions en centièmes de pouce (comme <c>PaperSize</c>).</summary>
public readonly record struct PaperOption(string Name, int Width, int Height);

public enum PaperMatch
{
    /// <summary>Nom exact (après normalisation), dimensions plausibles.</summary>
    Name,
    /// <summary>Dimensions à la tolérance près, nom d'un format simple.</summary>
    Dimensions,
    /// <summary>Planche de bandes (ex. « (2x6) x2 ») dont la page a la taille d'une bande : le pilote la répète.</summary>
    MultiUp,
}

/// <summary>Format retenu : position dans la liste du pilote.</summary>
public sealed record PaperChoice(int Index, PaperOption Option, PaperMatch Match);

/// <summary>
/// Choix exact du format de papier (LAB-320), sans « contient » : « 10x15in » ou « (4x6) x2 » ne sont
/// jamais pris pour du 10×15. Ordre : nom exact, puis dimensions, puis (bande seulement) planche de bandes.
/// </summary>
public static class PaperSizeChooser
{
    /// <summary>≈ 3 mm : couvre 10×15 cm (394×591) et 5×15 cm (197×591), écarte A6 (413×583).</summary>
    internal const int DimensionTolerance = 12;

    /// <summary>
    /// Écart admis pour un nom exact : les pilotes DNP annoncent la page avec son débord
    /// (4x6 ≈ 413×615), un nom exact ne doit pas être refusé pour si peu.
    /// </summary>
    internal const double NameTolerance = 0.06;

    // AllowMultiUp : une planche doublée n'est acceptée que pour la bande (« (2x6) x2 » des DNP) ;
    // jamais pour le 10×15, où « (4x6) x2 » sortirait deux photos par tirage.
    private sealed record Target(int Width, int Height, bool AllowMultiUp, string[] Names);

    // Noms normalisés, par ordre de préférence.
    private static readonly Dictionary<string, Target> Targets = new()
    {
        ["4x6"] = new(400, 600, false, ["4x6", "6x4", "pc4x6", "pc6x4", "4x6in", "6x4in", "10x15", "15x10", "10x15cm", "15x10cm"]),
        ["2x6"] = new(200, 600, true, ["2x6", "6x2", "pc2x6", "pc6x2", "2x6in", "6x2in", "5x15", "15x5", "5x15cm", "15x5cm"]),
    };

    // « 2x6x2 », « pc4x6x2 », « 4x6inx2 » : un format suivi d'un nombre de tirages par planche.
    private static readonly Regex MultiUpPattern = new(
        @"^(?:pc)?(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:in|cm)?x(\d+)$", RegexOptions.CultureInvariant);

    /// <summary>Taille personnalisée de repli (centièmes de pouce), null pour un format inconnu.</summary>
    public static (int Width, int Height)? FallbackSize(string format)
        => Targets.TryGetValue(format, out var t) ? (t.Width, t.Height) : null;

    /// <summary>Format du pilote pour « 4x6 » ou « 2x6 » ; null si rien ne convient (ou format inconnu).</summary>
    public static PaperChoice? Choose(string format, IReadOnlyList<PaperOption> options)
    {
        if (!Targets.TryGetValue(format, out var target)) return null;

        var normalized = options.Select(o => Normalize(o.Name)).ToList();

        // 1. Nom exact : l'ordre des noms de la cible décide, puis l'ordre du pilote.
        foreach (var name in target.Names)
        {
            for (var i = 0; i < options.Count; i++)
            {
                if (normalized[i] == name && IsClose(options[i], target, NameTolerance))
                    return new PaperChoice(i, options[i], PaperMatch.Name);
            }
        }

        // 2. Dimensions, format simple : le plus proche, puis l'ordre du pilote.
        var bySize = Enumerable.Range(0, options.Count)
            .Where(i => !IsMultiUp(normalized[i]) && Distance(options[i], target) is { } d && d.Max <= DimensionTolerance)
            .OrderBy(i => Distance(options[i], target)!.Value.Sum)
            .ThenBy(i => i)
            .Cast<int?>()
            .FirstOrDefault();
        if (bySize is { } s) return new PaperChoice(s, options[s], PaperMatch.Dimensions);

        // 3. Bande : planche de bandes dont la page a la taille d'une bande (le pilote la répète).
        if (!target.AllowMultiUp) return null;
        for (var i = 0; i < options.Count; i++)
        {
            var m = MultiUpPattern.Match(normalized[i]);
            if (m.Success && target.Names.Contains($"{m.Groups[1].Value}x{m.Groups[2].Value}")
                && IsClose(options[i], target, NameTolerance))
                return new PaperChoice(i, options[i], PaperMatch.MultiUp);
        }

        return null;
    }

    /// <summary>Minuscules, sans espaces, guillemets, parenthèses ni soulignés ; « × » → « x », « inch » → « in ».</summary>
    internal static string Normalize(string name)
    {
        var sb = new StringBuilder(name.Length);
        foreach (var c in name.ToLowerInvariant())
        {
            if (char.IsWhiteSpace(c) || c is '"' or '\'' or '″' or '(' or ')' or '[' or ']' or '_' or '-') continue;
            sb.Append(c switch { '×' or '*' => 'x', ',' => '.', _ => c });
        }
        return sb.ToString().Replace("inches", "in").Replace("inch", "in");
    }

    /// <summary>Planche de plusieurs tirages (« x2 », « cut », « 2up ») : jamais prise sur ses seules dimensions.</summary>
    internal static bool IsMultiUp(string normalizedName)
        => MultiUpPattern.IsMatch(normalizedName)
           || normalizedName.Contains("cut")
           || normalizedName.Contains("2up")
           || normalizedName.Contains("split");

    /// <summary>Lignes de journal décrivant les formats du pilote, chacune sous <paramref name="maxLength"/> caractères.</summary>
    public static List<string> Describe(string printerName, IReadOnlyList<PaperOption> options, int maxLength = 1900)
    {
        var header = $"Formats de papier du pilote « {printerName} » ({options.Count}, centièmes de pouce)";
        if (options.Count == 0) return [$"{header} : aucun."];

        var items = options.Select(o => string.Create(CultureInfo.InvariantCulture, $"« {o.Name} » {o.Width}×{o.Height}")).ToList();
        var chunks = new List<List<string>> { new() };
        var length = 0;
        foreach (var item in items)
        {
            if (chunks[^1].Count > 0 && length + item.Length + 3 > maxLength - header.Length - 16)
            {
                chunks.Add([]);
                length = 0;
            }
            chunks[^1].Add(item);
            length += item.Length + 3;
        }

        return chunks.Count == 1
            ? [$"{header} : {string.Join(" ; ", chunks[0])}"]
            : chunks.Select((c, i) => $"{header} [{i + 1}/{chunks.Count}] : {string.Join(" ; ", c)}").ToList();
    }

    /// <summary>
    /// Le composite et la page n'ont pas la même orientation : la page doit passer en paysage. Le choix
    /// par dimensions ignore l'orientation (« 6x4 » vaut « 4x6 »), l'impression la rétablit.
    /// </summary>
    public static bool NeedsLandscape(int imageWidth, int imageHeight, int paperWidth, int paperHeight)
        => imageWidth != imageHeight && paperWidth != paperHeight
           && (imageWidth > imageHeight) != (paperWidth > paperHeight);

    private static (int Max, int Sum)? Distance(PaperOption o, Target t)
    {
        if (o.Width <= 0 || o.Height <= 0) return null;
        var (shortSide, longSide) = o.Width <= o.Height ? (o.Width, o.Height) : (o.Height, o.Width);
        var dw = Math.Abs(shortSide - t.Width);
        var dh = Math.Abs(longSide - t.Height);
        return (Math.Max(dw, dh), dw + dh);
    }

    private static bool IsClose(PaperOption o, Target t, double relative)
    {
        if (o.Width <= 0 || o.Height <= 0) return false;
        var (shortSide, longSide) = o.Width <= o.Height ? (o.Width, o.Height) : (o.Height, o.Width);
        return Math.Abs(shortSide - t.Width) <= t.Width * relative
            && Math.Abs(longSide - t.Height) <= t.Height * relative;
    }
}
