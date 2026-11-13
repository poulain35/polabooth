namespace PolaKiosk.Controls;

/// <summary>Domaines e-mail proposés par le clavier tactile, du plus courant au moins courant en France.</summary>
internal static class EmailDomainSuggestions
{
    internal static readonly IReadOnlyList<string> Domains =
    [
        "gmail.com", "hotmail.fr", "orange.fr", "outlook.fr", "yahoo.fr", "free.fr", "sfr.fr",
        "icloud.com", "hotmail.com", "outlook.com", "live.fr", "laposte.net", "wanadoo.fr",
        "yahoo.com", "bbox.fr", "neuf.fr",
    ];

    /// <summary>
    /// Sans « @ » ou juste après : les domaines les plus courants. Après « @ » : ceux qui commencent
    /// par la saisie (sans tenir compte de la casse). Un domaine déjà saisi en entier n'est plus proposé.
    /// </summary>
    public static IReadOnlyList<string> Suggest(string text, int max)
    {
        var at = text.IndexOf('@');
        if (at < 0) return Domains.Take(max).ToArray();

        var partial = text[(at + 1)..];
        if (partial.Contains('@')) return [];

        return Domains
            .Where(d => d.StartsWith(partial, StringComparison.OrdinalIgnoreCase)
                        && !d.Equals(partial, StringComparison.OrdinalIgnoreCase))
            .Take(max)
            .ToArray();
    }
}
