namespace PolaKiosk.ViewModels;

/// <summary>Liens de partage de l'écran résultat : QR code et galerie à taper (logique pure, testée).</summary>
internal static class ShareLinks
{
    /// <summary>
    /// Lien du QR code : la photo dans la galerie (code d'accès + id de la photo), à défaut la galerie
    /// de l'événement, à défaut l'URL publique du fichier. <c>via=qr</c> fait compter l'ouverture par
    /// QR code côté serveur (get-photos, LAB-209) ; l'URL publique R2 n'est pas une page, rien à compter.
    /// </summary>
    public static string BuildQrUrl(string saasUrl, string? accessCode, Guid photoId, string publicUrl)
    {
        if (string.IsNullOrEmpty(accessCode) || string.IsNullOrWhiteSpace(saasUrl)) return publicUrl;
        var gallery = $"{saasUrl.TrimEnd('/')}/photos/{accessCode}";
        return photoId != Guid.Empty ? $"{gallery}?photo={photoId}&via=qr" : $"{gallery}?via=qr";
    }

    /// <summary>
    /// Lien de la galerie à taper à la main (sans lecteur QR) : sans « https:// » ni paramètres.
    /// Vide sans code d'accès ni adresse du SaaS (le QR mène alors au fichier seul, trop long à recopier).
    /// </summary>
    public static string BuildGalleryLink(string saasUrl, string? accessCode)
    {
        if (string.IsNullOrEmpty(accessCode) || string.IsNullOrWhiteSpace(saasUrl)) return "";
        var host = saasUrl.TrimEnd('/');
        var scheme = host.IndexOf("://", StringComparison.Ordinal);
        if (scheme >= 0) host = host[(scheme + 3)..];
        return $"{host}/photos/{accessCode}";
    }
}
