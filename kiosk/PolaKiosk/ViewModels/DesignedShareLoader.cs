using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Écran de partage composé par l'admin (LAB-297), tel que l'écran résultat l'affiche : plan et images
/// gardés par la synchro (ou l'import .pola), décodés hors du fil d'affichage (LAB-405).
/// </summary>
internal static class DesignedShareLoader
{
    // Dernier avertissement journalisé : un même problème n'est écrit qu'une fois de suite.
    private static string? _lastWarning;

    /// <summary>
    /// Écran prêt à afficher, ou null : écran standard. Rien de publié : sans message. Cache illisible,
    /// ou police remplacée par DM Sans : avertissement (catégorie « screens »).
    /// </summary>
    public static async Task<ScreenContent?> LoadAsync(ISyncService? sync, IKioskLogService kioskLog)
    {
        CachedScreen? cached;
        try { cached = sync?.GetScreen(ScreenLayout.KindResult); }
        catch { cached = null; }
        if (cached == null) return null;

        var (content, error) = await Task.Run(() => (ScreenContent.LoadCached(cached, out var e), e));
        var warning = content == null
            ? $"Partage de l'organisation v{cached.Layout.Version} illisible ({error}) : écran standard affiché."
            : content.FontWarnings.Count > 0
                ? $"Partage de l'organisation v{cached.Layout.Version} : {string.Join(", ", content.FontWarnings)} ; textes écrits en DM Sans."
                : null;
        if (warning == null)
        {
            _lastWarning = null;
            return content;
        }

        if (Interlocked.Exchange(ref _lastWarning, warning) != warning)
        {
            try { await kioskLog.LogWarningAsync("screens", warning); }
            catch { /* journal indisponible : l'écran s'affiche quand même */ }
        }
        return content;
    }

    /// <summary>Oublie le dernier avertissement (tests).</summary>
    internal static void ResetWarning() => _lastWarning = null;
}
