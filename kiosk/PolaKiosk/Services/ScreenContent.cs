using System.IO;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Media;

namespace PolaKiosk.Services;

/// <summary>État d'un bouton d'écran composé : actif, grisé (indisponible, sans réaction) ou masqué (fonction coupée).</summary>
public enum ScreenActionState
{
    Active,
    Disabled,
    Hidden,
}

/// <summary>
/// Écran composé en cache : le plan (noms de fichiers locaux), le dossier de ses images et l'empreinte
/// du plan publié (vide si inconnue).
/// </summary>
public sealed record CachedScreen(ScreenLayout Layout, string Directory, string SourceHash = "");

/// <summary>Police d'un texte vivant telle que la borne l'écrit : famille WPF et graisse.</summary>
public readonly record struct ScreenFont(FontFamily Family, int Weight);

/// <summary>
/// Écran composé prêt à afficher : le plan et ses images décodées (figées, utilisables depuis
/// n'importe quel thread) et ses polices. <see cref="Load"/> renvoie null si une image manque ou est
/// illisible : la borne affiche alors l'écran standard. Une police absente ou illisible ne bloque pas
/// l'écran : ses textes sont écrits en DM Sans et la raison est dans <see cref="FontWarnings"/>.
/// </summary>
public sealed class ScreenContent
{
    private readonly IReadOnlyDictionary<string, FontFamily> _fonts;

    private ScreenContent(ScreenLayout layout, ImageSource? background, ImageSource? backgroundNeutral,
        IReadOnlyDictionary<string, ImageSource> buttonImages, IReadOnlyDictionary<string, FontFamily> fonts,
        IReadOnlyList<string> fontWarnings)
    {
        Layout = layout;
        Background = background;
        BackgroundNeutral = backgroundNeutral;
        ButtonImages = buttonImages;
        _fonts = fonts;
        FontWarnings = fontWarnings;
    }

    /// <summary>Écran construit à partir d'images déjà décodées (tests).</summary>
    internal static ScreenContent Create(ScreenLayout layout, ImageSource? background, ImageSource? backgroundNeutral,
        IReadOnlyDictionary<string, ImageSource> buttonImages, IReadOnlyDictionary<string, FontFamily>? fonts = null)
        => new(layout, background, backgroundNeutral, buttonImages, fonts ?? new Dictionary<string, FontFamily>(), []);

    public ScreenLayout Layout { get; }

    public ImageSource? Background { get; }

    public ImageSource? BackgroundNeutral { get; }

    /// <summary>Image de chaque bouton, par action.</summary>
    public IReadOnlyDictionary<string, ImageSource> ButtonImages { get; }

    /// <summary>Polices du plan absentes ou illisibles (textes écrits en DM Sans), pour le journal.</summary>
    public IReadOnlyList<string> FontWarnings { get; }

    /// <summary>Fond complet si l'accueil est personnalisé, sinon le fond neutre (spec D7).</summary>
    public ImageSource? BackgroundFor(bool personalized)
        => personalized ? Background : BackgroundNeutral ?? Background;

    /// <summary>
    /// Police d'un texte : Fraunces ou DM Sans embarquées, la police de son fichier, ou DM Sans à la
    /// graisse la plus proche si ce fichier n'a pas pu être chargé.
    /// </summary>
    public ScreenFont FontFor(ScreenText text)
    {
        if (text.FontFile is { } file)
            return _fonts.TryGetValue(file, out var family)
                ? new ScreenFont(family, text.Weight)
                : new ScreenFont(KioskFonts.Text, ScreenLayout.NearestDmSansWeight(text.Weight));
        return new ScreenFont(text.Font == ScreenLayout.FontFraunces ? KioskFonts.Title : KioskFonts.Text, text.Weight);
    }

    // Dernier écran chargé par dossier : l'accueil revient souvent, ses images ne sont décodées qu'une fois par version.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (string Hash, ScreenContent Content)> Loaded =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Comme <see cref="Load"/>, sans redécoder une version déjà chargée (même dossier, même empreinte,
    /// mêmes polices présentes : une police arrivée à la synchro suivante est bien prise).
    /// </summary>
    public static ScreenContent? LoadCached(CachedScreen screen, out string? error)
    {
        error = null;
        var key = screen.SourceHash.Length > 0 ? screen.SourceHash + "|" + PresentFonts(screen) : "";
        if (key.Length > 0 && Loaded.TryGetValue(screen.Directory, out var known) && known.Hash == key)
            return known.Content;

        var content = Load(screen, out error);
        if (content != null && key.Length > 0) Loaded[screen.Directory] = (key, content);
        else Loaded.TryRemove(screen.Directory, out _);
        return content;
    }

    /// <summary>Charge les images d'un écran en cache. Null (avec la raison) si l'une manque ou est illisible.</summary>
    public static ScreenContent? Load(CachedScreen screen, out string? error)
    {
        error = null;
        try
        {
            var layout = screen.Layout;
            ImageSource? background = null, neutral = null;
            if (layout.Background is { } bg && (background = LoadImage(screen.Directory, bg, fill: true)) is null)
            {
                error = $"fond illisible ({bg})";
                return null;
            }
            if (layout.BackgroundNeutral is { } bn && (neutral = LoadImage(screen.Directory, bn, fill: true)) is null)
            {
                error = $"fond neutre illisible ({bn})";
                return null;
            }

            var buttons = new Dictionary<string, ImageSource>(StringComparer.Ordinal);
            foreach (var button in layout.Buttons)
            {
                var image = LoadImage(screen.Directory, button.Image, fill: false);
                if (image is null)
                {
                    error = $"image du bouton {button.Action} illisible ({button.Image})";
                    return null;
                }
                buttons[button.Action] = image;
            }

            var fonts = new Dictionary<string, FontFamily>(StringComparer.Ordinal);
            var warnings = new List<string>();
            var copies = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var file in layout.FontFileNames())
            {
                if (LoadFont(screen.Directory, layout.Kind, file, out var copy, out var reason) is { } family)
                {
                    fonts[file] = family;
                    copies.Add(copy!);
                }
                else warnings.Add($"police « {layout.Texts.First(t => t.FontFile == file).Font} » {reason} ({file})");
            }
            DeleteOtherCopies(ScreenCache.FontCopiesDirectory(screen.Directory, layout.Kind), copies);
            return new ScreenContent(layout, background, neutral, buttons, fonts, warnings);
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return null;
        }
    }

    private static readonly object FontCopyLock = new();

    private static string PresentFonts(CachedScreen screen)
        => string.Join("|", screen.Layout.FontFileNames()
            .Where(n => IsPlainFileName(n) && File.Exists(Path.Combine(screen.Directory, n))));

    /// <summary>
    /// Charge la police d'un fichier du cache. WPF garde ouvert le fichier d'une police chargée : on
    /// charge une copie rangée par empreinte (<c>screens\fonts-{kind}\{empreinte}\</c>), pour que
    /// l'échange du dossier de l'écran à la synchro suivante ne bute jamais sur un fichier ouvert.
    /// Le nom de famille est lu dans le fichier. Null (avec la raison) si la police est absente ou illisible.
    /// </summary>
    internal static FontFamily? LoadFont(string directory, string kind, string name, out string? copyDir, out string reason)
    {
        copyDir = null;
        reason = "absente";
        try
        {
            var source = Path.Combine(directory, name);
            if (!IsPlainFileName(name) || !File.Exists(source)) return null;

            reason = "illisible";
            var bytes = File.ReadAllBytes(source);
            var copiesRoot = ScreenCache.FontCopiesDirectory(directory, kind);
            copyDir = Path.Combine(copiesRoot, Convert.ToHexString(SHA256.HashData(bytes))[..16]);
            var copy = Path.Combine(copyDir, name);
            lock (FontCopyLock)
            {
                if (!File.Exists(copy))
                {
                    Directory.CreateDirectory(copyDir);
                    AtomicFile.WriteAllBytes(copy, bytes);
                }
                return FamilyFromFile(copyDir, copy);
            }
        }
        catch (Exception ex)
        {
            reason = $"illisible ({ex.Message})";
            return null;
        }
    }

    // WPF retombe en silence sur une police système si le nom ne correspond pas au fichier : chaque
    // nom lu dans le fichier est essayé, et gardé seulement s'il désigne bien la copie.
    private static FontFamily? FamilyFromFile(string folder, string file)
    {
        var glyphs = new GlyphTypeface(new Uri(file));
        var folderUri = new Uri(Path.TrimEndingDirectorySeparator(folder) + Path.DirectorySeparatorChar);
        foreach (var name in glyphs.FamilyNames.Values.Concat(glyphs.Win32FamilyNames.Values).Distinct(StringComparer.Ordinal))
        {
            var family = new FontFamily(folderUri, "./#" + name);
            var typeface = new Typeface(family, FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
            if (typeface.TryGetGlyphTypeface(out var resolved)
                && string.Equals(Path.GetFullPath(resolved.FontUri.LocalPath), Path.GetFullPath(file), StringComparison.OrdinalIgnoreCase))
                return family;
        }
        return null;
    }

    // Copies des versions précédentes : celles encore ouvertes par WPF partent à un prochain chargement.
    private static void DeleteOtherCopies(string root, IReadOnlySet<string> keep)
    {
        if (!Directory.Exists(root)) return;
        lock (FontCopyLock)
            foreach (var dir in Directory.EnumerateDirectories(root))
            {
                if (keep.Contains(dir)) continue;
                try { Directory.Delete(dir, recursive: true); }
                catch { /* police encore affichée */ }
            }
    }

    // Les fonds sont décodés à la taille de l'écran ; les boutons, petits, à leur taille d'origine.
    private static ImageSource? LoadImage(string directory, string name, bool fill)
    {
        if (!IsPlainFileName(name)) return null;
        var path = Path.Combine(directory, name);
        return fill ? ImageLoader.LoadForScreen(path, fill: true) : ImageLoader.Load(path, int.MaxValue, int.MaxValue, fill: false);
    }

    /// <summary>Nom de fichier simple (sans dossier ni « .. ») : un plan ne peut pas viser un fichier hors de son dossier.</summary>
    public static bool IsPlainFileName(string? name)
        => !string.IsNullOrWhiteSpace(name) && name is not ("." or "..")
           && Path.GetFileName(name) == name && name.IndexOfAny(Path.GetInvalidFileNameChars()) < 0;
}
