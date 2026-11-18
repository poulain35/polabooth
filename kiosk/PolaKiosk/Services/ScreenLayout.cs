using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PolaKiosk.Services;

/// <summary>Bouton d'un écran composé : image posée dans sa boîte, en pixels 1920×1080.</summary>
public sealed record ScreenButton(string Action, double X, double Y, double W, double H, string Image);

/// <summary>
/// Texte vivant : valeur réelle écrite par la borne dans sa boîte. <c>Font</c> : nom de famille ;
/// <c>FontFile</c> : fichier TTF/OTF de la police (adresse publiée, puis nom local en cache), null pour
/// les polices embarquées (Fraunces et DM Sans).
/// </summary>
public sealed record ScreenText(
    string Variable, double X, double Y, double W, double H, double Angle,
    string Font, int Weight, double Size, string Color, string Align,
    bool Uppercase, double CharSpacing, int MaxLines, bool PersonalizedOnly, string? FontFile = null);

/// <summary>Emplacement : image vivante posée en « cover », inclinée et arrondie.</summary>
public sealed record ScreenSlot(string Slot, double X, double Y, double W, double H, double Angle, double Radius);

/// <summary>Élément écarté à la lecture (type : button, text ou slot), pour le journal.</summary>
public sealed record ScreenIgnored(string Type, string Value);

/// <summary>
/// Plan d'un écran composé par l'admin (spec docs/specs/ecrans-borne-admin.md, « Contrat du plan »).
/// Lu de façon tolérante par <see cref="Parse(string?)"/> : une valeur inconnue est écartée (et
/// listée dans <see cref="Ignored"/>), un plan inutilisable donne null. La lecture ne lève jamais.
/// </summary>
public sealed record ScreenLayout(
    int Version,
    string Kind,
    string? Background,
    string? BackgroundNeutral,
    bool TransparentBackground,
    IReadOnlyList<ScreenButton> Buttons,
    IReadOnlyList<ScreenText> Texts,
    IReadOnlyList<ScreenSlot> Slots,
    IReadOnlyList<ScreenIgnored> Ignored)
{
    public const string KindHome = "home";
    public const string KindResult = "result";

    /// <summary>Taille de la surface de dessin (pixels d'export du SaaS).</summary>
    public const double Width = 1920, Height = 1080;

    /// <summary>Polices embarquées dans la borne (jamais téléchargées).</summary>
    public const string FontFraunces = "Fraunces";
    public const string FontDmSans = "DM Sans";
    public const string DefaultColor = "#1B241F";
    public const double DefaultSize = 40;

    private sealed record Allowed(string[] Actions, string[] Variables, string[] Slots);

    private static readonly Dictionary<string, Allowed> AllowedByKind = new()
    {
        [KindHome]   = new(["start", "gallery"], ["event_name", "event_date"], ["last_photo"]),
        [KindResult] = new(["print", "copies_minus", "copies_plus", "email", "qr", "retake", "finish"],
                           ["copies", "prints_remaining", "print_status", "countdown", "share_status"],
                           ["photo_preview"]),
    };

    private static readonly int[] FrauncesWeights = [600];
    private static readonly int[] DmSansWeights = [400, 500, 600, 700];
    private static readonly Regex HexColor = new("^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$", RegexOptions.CultureInvariant);

    /// <summary>Fond à afficher : complet si l'accueil est personnalisé, sinon le fond neutre (spec D7).</summary>
    public string? BackgroundFor(bool personalized)
        => personalized ? Background : BackgroundNeutral ?? Background;

    /// <summary>Noms des images du plan (fonds et boutons), sans doublon. Les polices : <see cref="FontFileNames"/>.</summary>
    public IReadOnlyList<string> ImageNames()
        => new[] { Background, BackgroundNeutral }
            .Concat(Buttons.Select(b => b.Image))
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Select(n => n!)
            .Distinct(StringComparer.Ordinal)
            .ToList();

    /// <summary>Fichiers des polices du plan (textes vivants), sans doublon.</summary>
    public IReadOnlyList<string> FontFileNames()
        => Texts.Select(t => t.FontFile)
            .Where(n => n is not null)
            .Select(n => n!)
            .Distinct(StringComparer.Ordinal)
            .ToList();

    /// <summary>Lit un plan publié depuis du JSON. Null : plan refusé ou illisible.</summary>
    public static ScreenLayout? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var reader = new JsonTextReader(new System.IO.StringReader(json))
            {
                DateParseHandling = DateParseHandling.None,
            };
            return Parse(JToken.ReadFrom(reader));
        }
        catch { return null; }
    }

    /// <summary>Lit un plan publié. Null : plan refusé (kind, taille, version, fond) ou illisible.</summary>
    public static ScreenLayout? Parse(JToken? token)
    {
        try { return ParseCore(token); }
        catch { return null; }
    }

    private static ScreenLayout? ParseCore(JToken? token)
    {
        if (token is not JObject root) return null;

        var kind = Str(root["kind"]);
        if (kind is null || !AllowedByKind.TryGetValue(kind, out var allowed)) return null;

        if (root["size"] is not JObject size || Num(size["w"]) != Width || Num(size["h"]) != Height) return null;

        if (Num(root["version"]) is not { } versionValue || versionValue <= 0
            || versionValue != Math.Floor(versionValue) || versionValue > int.MaxValue) return null;

        bool transparent = Bool(root["transparent_background"]);
        var background = NonBlank(root["background"]);
        if (background is null && !transparent) return null;

        var ignored = new List<ScreenIgnored>();
        var buttons = ParseButtons(root["buttons"], allowed, ignored);
        var texts   = ParseTexts(root["texts"], allowed, ignored);
        var slots   = ParseSlots(root["slots"], allowed, ignored);

        return new ScreenLayout((int)versionValue, kind, background, NonBlank(root["background_neutral"]),
            transparent, buttons, texts, slots, ignored);
    }

    private static List<ScreenButton> ParseButtons(JToken? token, Allowed allowed, List<ScreenIgnored> ignored)
    {
        var list = new List<ScreenButton>();
        foreach (var item in Items(token))
        {
            var action = Str(item["action"]);
            var image = NonBlank(item["image"]);
            if (action is null || !allowed.Actions.Contains(action) || image is null
                || Box(item) is not var (x, y, w, h)
                || list.Any(b => b.Action == action))
            {
                ignored.Add(new("button", action ?? ""));
                continue;
            }
            list.Add(new ScreenButton(action, x, y, w, h, image));
        }
        return list;
    }

    private static List<ScreenText> ParseTexts(JToken? token, Allowed allowed, List<ScreenIgnored> ignored)
    {
        var list = new List<ScreenText>();
        foreach (var item in Items(token))
        {
            var variable = Str(item["variable"]);
            if (variable is null || !allowed.Variables.Contains(variable) || Box(item) is not var (x, y, w, h))
            {
                ignored.Add(new("text", variable ?? ""));
                continue;
            }

            var (font, weight, fontFile) = LiveFont(item["font"], item["weight"], item["font_file"]);
            var align = Str(item["align"]) is "center" or "right" ? Str(item["align"])! : "left";
            var color = Str(item["color"]) is { } c && HexColor.IsMatch(c) ? c : DefaultColor;
            double fontSize = Num(item["size"]) is { } s && s > 0 ? s : DefaultSize;
            int maxLines = Num(item["max_lines"]) is { } m ? (int)Math.Clamp(Math.Round(m), 1, 3) : 1;

            list.Add(new ScreenText(variable, x, y, w, h, Num(item["angle"]) ?? 0, font, weight, fontSize, color,
                align, Bool(item["uppercase"]), Num(item["char_spacing"]) ?? 0, maxLines,
                Bool(item["personalized_only"]), fontFile));
        }
        return list;
    }

    private static List<ScreenSlot> ParseSlots(JToken? token, Allowed allowed, List<ScreenIgnored> ignored)
    {
        var list = new List<ScreenSlot>();
        foreach (var item in Items(token))
        {
            var slot = Str(item["slot"]);
            if (slot is null || !allowed.Slots.Contains(slot) || Box(item) is not var (x, y, w, h)
                || list.Any(s => s.Slot == slot))
            {
                ignored.Add(new("slot", slot ?? ""));
                continue;
            }
            list.Add(new ScreenSlot(slot, x, y, w, h, Num(item["angle"]) ?? 0, Math.Max(0, Num(item["radius"]) ?? 0)));
        }
        return list;
    }

    /// <summary>
    /// Police d'un texte vivant (miroir de <c>liveFont</c> du SaaS, cas communs) : Fraunces (600) et
    /// DM Sans (400 à 700) sont embarquées, sans fichier ; une autre famille avec un fichier est gardée,
    /// graisse arrondie entre 100 et 900 ; sans fichier ou sans famille : DM Sans.
    /// </summary>
    private static (string Font, int Weight, string? FontFile) LiveFont(JToken? font, JToken? weight, JToken? fontFile)
    {
        var family = (Str(font) ?? "").Replace("\"", "").Replace("'", "").Trim();
        var lower = family.ToLowerInvariant();
        var embedded = lower.StartsWith("fraunces", StringComparison.Ordinal) ? FontFraunces
            : lower == "dm sans" ? FontDmSans : null;
        var file = Str(fontFile);
        double? value = Weight(weight);

        if (embedded is not null || family.Length == 0 || string.IsNullOrEmpty(file))
        {
            var name = embedded ?? FontDmSans;
            return (name, NearestWeight(name == FontFraunces ? FrauncesWeights : DmSansWeights, value), null);
        }
        int rounded = value is { } v ? (int)Math.Clamp(Math.Round(v, MidpointRounding.AwayFromZero), 100, 900) : 400;
        return (family, rounded, file);
    }

    /// <summary>Poids DM Sans le plus proche parmi 400, 500, 600 et 700 : repli d'une police absente ou illisible.</summary>
    internal static int NearestDmSansWeight(double? weight) => NearestWeight(DmSansWeights, weight);

    // 400 sans poids ; égalité : le plus léger.
    private static int NearestWeight(int[] weights, double? weight)
        => weights.OrderBy(v => Math.Abs(v - (weight ?? 400))).ThenBy(v => v).First();

    // Graisse comme Fabric l'écrit : nombre, « normal », « bold » ou nombre en texte.
    private static double? Weight(JToken? token)
        => Num(token) ?? Str(token) switch
        {
            "normal" => 400,
            "bold" => 700,
            { } s when s.Trim().Length > 0 && double.TryParse(s.Trim(), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var d) && double.IsFinite(d) => d,
            _ => null,
        };

    /// <summary>Forme normalisée (celle des cas de test communs), sans <c>size</c>.</summary>
    public JObject ToJson() => new()
    {
        ["version"] = Version,
        ["kind"] = Kind,
        ["background"] = Background,
        ["background_neutral"] = BackgroundNeutral,
        ["transparent_background"] = TransparentBackground,
        ["buttons"] = new JArray(Buttons.Select(b => new JObject
        {
            ["action"] = b.Action, ["x"] = b.X, ["y"] = b.Y, ["w"] = b.W, ["h"] = b.H, ["image"] = b.Image,
        })),
        ["texts"] = new JArray(Texts.Select(t => new JObject
        {
            ["variable"] = t.Variable, ["x"] = t.X, ["y"] = t.Y, ["w"] = t.W, ["h"] = t.H, ["angle"] = t.Angle,
            ["font"] = t.Font, ["weight"] = t.Weight, ["font_file"] = t.FontFile, ["size"] = t.Size, ["color"] = t.Color, ["align"] = t.Align,
            ["uppercase"] = t.Uppercase, ["char_spacing"] = t.CharSpacing, ["max_lines"] = t.MaxLines,
            ["personalized_only"] = t.PersonalizedOnly,
        })),
        ["slots"] = new JArray(Slots.Select(s => new JObject
        {
            ["slot"] = s.Slot, ["x"] = s.X, ["y"] = s.Y, ["w"] = s.W, ["h"] = s.H, ["angle"] = s.Angle, ["radius"] = s.Radius,
        })),
        ["ignored"] = new JArray(Ignored.Select(i => new JObject { ["type"] = i.Type, ["value"] = i.Value })),
    };

    /// <summary>Résumé des éléments écartés, pour le journal (vide s'il n'y en a pas).</summary>
    public string IgnoredSummary()
        => string.Join(", ", Ignored.Select(i => $"{i.Type} « {i.Value} »"));

    // ── Lecture prudente des valeurs ──

    private static IEnumerable<JObject> Items(JToken? token)
        => token is JArray array ? array.OfType<JObject>().ToList() : [];

    private static (double X, double Y, double W, double H)? Box(JObject item)
    {
        if (Num(item["x"]) is not { } x || Num(item["y"]) is not { } y
            || Num(item["w"]) is not { } w || Num(item["h"]) is not { } h) return null;
        return w > 0 && h > 0 ? (x, y, w, h) : null;
    }

    private static double? Num(JToken? token)
        => token?.Type is JTokenType.Integer or JTokenType.Float
           && token.Value<double>() is var d && double.IsFinite(d) ? d : null;

    private static string? Str(JToken? token) => token?.Type == JTokenType.String ? token.Value<string>() : null;

    private static string? NonBlank(JToken? token) => Str(token) is { } s && !string.IsNullOrWhiteSpace(s) ? s : null;

    private static bool Bool(JToken? token) => token?.Type == JTokenType.Boolean && token.Value<bool>();
}
