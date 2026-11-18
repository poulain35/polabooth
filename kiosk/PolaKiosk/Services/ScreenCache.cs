using System.IO;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SkiaSharp;

namespace PolaKiosk.Services;

/// <summary>
/// Cache des écrans composés (LAB-297) : <c>DataDirectory\screens\{kind}\</c>, avec le plan
/// (<c>layout.json</c>, adresses des images et des polices remplacées par des noms de fichiers locaux),
/// ses images, ses polices (LAB-331) et l'empreinte du plan publié (<c>source.sha</c>).
/// Une nouvelle version est préparée dans un dossier temporaire puis échangée d'un coup : l'écran ne
/// lit jamais un cache à moitié écrit, et un échec laisse la version précédente en place.
/// </summary>
internal sealed class ScreenCache
{
    public const string LayoutFile = "layout.json";
    public const string SourceFile = "source.sha";

    private readonly string _root;

    public ScreenCache(string dataDirectory) => _root = new KioskPaths(dataDirectory).ScreensDirectory;

    public string DirectoryFor(string kind) => Path.Combine(_root, kind);

    /// <summary>Empreinte du plan publié : même plan (même version, mêmes images) → même empreinte.</summary>
    public static string SourceHash(JObject published)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(published.ToString(Formatting.None))))[..16];

    /// <summary>
    /// Écran en cache, lisible, avec toutes ses images. Null sinon. Une police absente n'empêche pas
    /// l'affichage (DM Sans à la place, voir <see cref="ScreenContent"/>).
    /// </summary>
    public CachedScreen? Get(string kind)
    {
        try
        {
            var dir = DirectoryFor(kind);
            var layoutPath = Path.Combine(dir, LayoutFile);
            if (!File.Exists(layoutPath)) return null;

            var layout = ScreenLayout.Parse(File.ReadAllText(layoutPath));
            if (layout == null || layout.Kind != kind) return null;
            if (layout.ImageNames().Any(n => !ScreenContent.IsPlainFileName(n) || !File.Exists(Path.Combine(dir, n)))) return null;

            var source = File.Exists(Path.Combine(dir, SourceFile)) ? File.ReadAllText(Path.Combine(dir, SourceFile)).Trim() : "";
            return new CachedScreen(layout, dir, source);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Le cache contient déjà ce plan publié, polices comprises : rien à retélécharger.</summary>
    public bool IsCurrent(string kind, string sourceHash)
        => Get(kind) is { } cached && cached.SourceHash == sourceHash
           && cached.Layout.FontFileNames().All(n => ScreenContent.IsPlainFileName(n) && File.Exists(Path.Combine(cached.Directory, n)));

    /// <summary>Copies des polices chargées par l'affichage (<see cref="ScreenContent"/>), à côté du dossier de l'écran.</summary>
    public static string FontCopiesDirectory(string screenDirectory, string kind)
        => Path.Combine(Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(screenDirectory))!, $"fonts-{kind}");

    /// <summary>Efface l'écran en cache (dépublié, ou absent du .pola).</summary>
    public void Clear(string kind)
    {
        CleanLeftovers(kind);
        TryDeleteDirectory(DirectoryFor(kind));
        TryDeleteDirectory(FontCopiesDirectory(DirectoryFor(kind), kind));
    }

    /// <summary>
    /// Met en cache un plan publié. <paramref name="fetch"/> écrit l'image ou la police d'une adresse
    /// dans un fichier (téléchargement, ou asset du .pola). <c>Error</c> null : l'écran est en place
    /// (<c>Layout</c> renseigné si une nouvelle version vient d'être écrite, null si elle l'était déjà).
    /// Sinon la raison de l'échec : la version précédente est gardée. Une police non récupérée ne fait
    /// pas échouer l'écran : elle est listée dans <c>Warnings</c>, la borne écrit ces textes en DM Sans
    /// et la synchro suivante la redemande (<see cref="IsCurrent"/>).
    /// </summary>
    public async Task<(ScreenLayout? Layout, string? Error, IReadOnlyList<string> Warnings)> StoreAsync(string kind,
        JObject published, Func<string, string, CancellationToken, Task> fetch, CancellationToken ct = default)
    {
        var warnings = new List<string>();
        var layout = ScreenLayout.Parse(published);
        if (layout == null) return (null, "plan refusé (version, format ou taille)", warnings);
        if (layout.Kind != kind) return (null, $"plan d'un autre écran ({layout.Kind})", warnings);

        var hash = SourceHash(published);
        if (IsCurrent(kind, hash)) return (null, null, warnings);

        CleanLeftovers(kind);
        var tmp = Path.Combine(_root, $"{kind}.tmp-{Guid.NewGuid():N}");
        try
        {
            Directory.CreateDirectory(tmp);

            // Une adresse → un nom de fichier local (dernier segment de l'adresse, rendu unique).
            var names = new Dictionary<string, string>(StringComparer.Ordinal);
            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { LayoutFile, SourceFile };
            foreach (var url in layout.ImageNames())
            {
                var name = LocalName(url, names.Count, used);
                var path = Path.Combine(tmp, name);
                try { await fetch(url, path, ct); }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    return (null, $"image non récupérée ({LastSegment(url)}) : {ex.Message}", warnings);
                }
                if (!IsReadableImage(path)) return (null, $"image illisible ({LastSegment(url)})", warnings);
                names[url] = name;
            }

            // Police manquante : son nom local reste dans le plan, sans fichier (DM Sans à l'affichage).
            foreach (var url in layout.FontFileNames())
            {
                var name = LocalName(url, names.Count, used, "font-{0}.ttf");
                var path = Path.Combine(tmp, name);
                names[url] = name;
                try { await fetch(url, path, ct); }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    TryDeleteFile(path);
                    warnings.Add($"police non récupérée ({LastSegment(url)}) : {ex.Message}");
                    continue;
                }
                if (!IsFontFile(path))
                {
                    TryDeleteFile(path);
                    warnings.Add($"police illisible ({LastSegment(url)})");
                }
            }

            AtomicFile.WriteAllText(Path.Combine(tmp, LayoutFile), WithLocalNames(published, names).ToString(Formatting.Indented));
            AtomicFile.WriteAllText(Path.Combine(tmp, SourceFile), hash);

            // Contrôle de ce qui a été écrit, avec la même lecture que l'affichage.
            if (ScreenLayout.Parse(File.ReadAllText(Path.Combine(tmp, LayoutFile))) == null) return (null, "plan local illisible", warnings);

            Swap(kind, tmp);
            tmp = null;
            return (layout, null, warnings);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            return (null, $"cache non écrit : {ex.Message}", warnings);
        }
        finally
        {
            if (tmp != null) TryDeleteDirectory(tmp);
        }
    }

    // Ancienne version mise de côté, nouvelle mise en place, ancienne supprimée. En cas d'échec du
    // second déplacement, l'ancienne version est remise.
    private void Swap(string kind, string tmp)
    {
        var dir = DirectoryFor(kind);
        string? old = null;
        if (Directory.Exists(dir))
        {
            old = Path.Combine(_root, $"{kind}.old-{Guid.NewGuid():N}");
            Directory.Move(dir, old);
        }
        try
        {
            Directory.Move(tmp, dir);
        }
        catch
        {
            if (old != null && !Directory.Exists(dir)) Directory.Move(old, dir);
            throw;
        }
        if (old != null) TryDeleteDirectory(old);
    }

    /// <summary>Dernier segment de l'adresse, sans paramètres : nom de l'asset dans le .pola (<c>screens/{nom}</c>).</summary>
    public static string LastSegment(string url)
    {
        var path = url.Split('?', '#')[0];
        var segment = path[(path.LastIndexOf('/') + 1)..];
        try { return Uri.UnescapeDataString(segment); }
        catch { return segment; }
    }

    internal static string LocalName(string url, int index, ISet<string> used, string fallback = "image-{0}.png")
    {
        var name = LastSegment(url);
        if (!ScreenContent.IsPlainFileName(name)) name = string.Format(System.Globalization.CultureInfo.InvariantCulture, fallback, index);
        var candidate = name;
        for (var i = 1; !used.Add(candidate); i++) candidate = $"{i}-{name}";
        return candidate;
    }

    private static JObject WithLocalNames(JObject published, IReadOnlyDictionary<string, string> names)
    {
        var copy = (JObject)published.DeepClone();
        Replace(copy, "background");
        Replace(copy, "background_neutral");
        if (copy["buttons"] is JArray buttons)
            foreach (var button in buttons.OfType<JObject>()) Replace(button, "image");
        if (copy["texts"] is JArray texts)
            foreach (var text in texts.OfType<JObject>()) Replace(text, "font_file");
        return copy;

        void Replace(JObject obj, string key)
        {
            if (obj[key]?.Type == JTokenType.String && names.TryGetValue((string)obj[key]!, out var local)) obj[key] = local;
        }
    }

    private static bool IsReadableImage(string path)
    {
        try
        {
            if (!File.Exists(path)) return false;
            using var codec = SKCodec.Create(path);
            return codec != null && codec.Info.Width > 0 && codec.Info.Height > 0;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>TrueType ou OpenType (les seuls que WPF lit) : reconnu à ses 4 premiers octets.</summary>
    internal static bool IsFontFile(string path)
    {
        try
        {
            if (!File.Exists(path)) return false;
            Span<byte> head = stackalloc byte[4];
            using var stream = File.OpenRead(path);
            if (stream.ReadAtLeast(head, 4, throwOnEndOfStream: false) < 4) return false;
            return head.SequenceEqual(new byte[] { 0, 1, 0, 0 }) || head.SequenceEqual("true"u8) || head.SequenceEqual("OTTO"u8);
        }
        catch
        {
            return false;
        }
    }

    private static void TryDeleteFile(string path)
    {
        try { File.Delete(path); }
        catch { /* fichier du dossier temporaire : sans nom dans le plan local, il est simplement ignoré */ }
    }

    // Restes d'un échec ou d'un arrêt brutal (dossiers temporaires et anciennes versions).
    private void CleanLeftovers(string kind)
    {
        if (!Directory.Exists(_root)) return;
        // Filtre explicite : sous Windows, le motif « home.* » désigne aussi le dossier « home ».
        foreach (var dir in Directory.EnumerateDirectories(_root))
            if (Path.GetFileName(dir) is { } name && (name.StartsWith($"{kind}.tmp-", StringComparison.OrdinalIgnoreCase)
                                                      || name.StartsWith($"{kind}.old-", StringComparison.OrdinalIgnoreCase)))
                TryDeleteDirectory(dir);
    }

    private static void TryDeleteDirectory(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true); }
        catch { /* fichier encore ouvert : supprimé à la prochaine synchro */ }
    }
}
