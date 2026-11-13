using System.Text.Json;

namespace PolaKiosk.Services;

/// <summary>Contenu de <c>https://&lt;saas&gt;/kiosk-config.json</c> : adresse Supabase et clé anon publique.</summary>
public sealed record SaasConfig(string SupabaseUrl, string SupabaseAnonKey);

/// <summary>
/// Adresse du SaaS saisie sur la borne (open core K2) : mise en forme de la saisie et lecture de
/// <c>kiosk-config.json</c>. Fonctions pures, testées.
/// </summary>
public static class SaasAddress
{
    public const string ConfigFileName = "kiosk-config.json";

    /// <summary>
    /// « photobooth.mon-entreprise.fr », « https://photobooth.mon-entreprise.fr/associer/ »… →
    /// « https://photobooth.mon-entreprise.fr ». Seule l'origine compte (le chemin est ignoré) ;
    /// sans schéma, https est ajouté ; tout autre schéma que https est refusé.
    /// </summary>
    public static bool TryNormalize(string? input, out string origin)
    {
        origin = "";
        var text = (input ?? "").Trim();
        if (text.Length == 0 || text.Any(char.IsWhiteSpace)) return false;

        if (!text.Contains("://", StringComparison.Ordinal)) text = "https://" + text;
        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttps || string.IsNullOrEmpty(uri.Host)) return false;
        if (!string.IsNullOrEmpty(uri.UserInfo)) return false;

        origin = uri.GetLeftPart(UriPartial.Authority).ToLowerInvariant();
        return true;
    }

    /// <summary>Adresse du fichier de configuration : <c>{origin}/kiosk-config.json</c>.</summary>
    public static Uri ConfigUri(string origin) => new($"{origin.TrimEnd('/')}/{ConfigFileName}");

    /// <summary>
    /// Lit <c>{ "supabaseUrl": "...", "supabaseAnonKey": "..." }</c>. Null si le JSON est invalide,
    /// si un champ manque ou est vide, ou si l'adresse Supabase n'est pas une URL https.
    /// </summary>
    public static SaasConfig? ParseConfig(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;

            var url = ReadString(doc.RootElement, "supabaseUrl");
            var key = ReadString(doc.RootElement, "supabaseAnonKey");
            if (url == null || key == null) return null;

            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
                || uri.Scheme != Uri.UriSchemeHttps || string.IsNullOrEmpty(uri.Host))
                return null;

            return new SaasConfig(url.TrimEnd('/'), key);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? ReadString(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String) return null;
        var text = value.GetString()?.Trim();
        return string.IsNullOrEmpty(text) ? null : text;
    }
}

/// <summary>D'où vient l'adresse Supabase de la borne.</summary>
public enum SaasEndpointSource
{
    /// <summary>Aucune adresse : écran « Adresse de votre SaaS ».</summary>
    None,
    /// <summary>appsettings (bornes de l'instance, développement) : « Changer de SaaS » masqué.</summary>
    AppSettings,
    /// <summary>Adresse saisie sur la borne, enregistrée dans machine-settings.json.</summary>
    MachineSettings,
}

/// <summary>Choix de l'adresse Supabase au démarrage (open core K2).</summary>
public static class SaasEndpoint
{
    /// <summary>
    /// appsettings fournit l'URL et la clé : elles sont gardées, machine-settings.json est ignoré.
    /// Sinon l'adresse saisie sur la borne (machine-settings.json) est appliquée, avec l'adresse du
    /// SaaS (QR codes, lien d'association) si appsettings n'en donne pas. Sinon aucune adresse.
    /// </summary>
    public static SaasEndpointSource Apply(AppSettings settings, MachineSettings machine)
    {
        var source = Resolve(settings, machine);
        if (source == SaasEndpointSource.MachineSettings)
        {
            settings.Supabase.Url     = machine.SupabaseUrl!.Trim();
            settings.Supabase.AnonKey = machine.SupabaseAnonKey!.Trim();
            if (string.IsNullOrWhiteSpace(settings.Kiosk.SaasUrl) && !string.IsNullOrWhiteSpace(machine.SaasUrl))
                settings.Kiosk.SaasUrl = machine.SaasUrl.Trim();
        }
        settings.Supabase.Source = source;
        return source;
    }

    private static SaasEndpointSource Resolve(AppSettings settings, MachineSettings machine)
    {
        if (settings.Supabase.HasAddress) return SaasEndpointSource.AppSettings;
        if (!string.IsNullOrWhiteSpace(machine.SupabaseUrl) && !string.IsNullOrWhiteSpace(machine.SupabaseAnonKey))
            return SaasEndpointSource.MachineSettings;
        return SaasEndpointSource.None;
    }
}
