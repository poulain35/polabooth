using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Configuration.Json;
using PolaKiosk.Services;

namespace PolaKiosk;

public class AppSettings
{
    public SupabaseSettings Supabase { get; set; } = new();
    public KioskSettings    Kiosk    { get; set; } = new();
    public CameraSettings   Camera   { get; set; } = new();
    public ContactSettings  Contact  { get; set; } = new();
}

/// <summary>
/// Fichier de réglages propre à l'instance (open core L7) : adresse du SaaS, nom et email du loueur.
/// Privé, absent de la version ouverte. Il passe juste après appsettings.json, avant
/// appsettings.{environnement}.json : un réglage de développement (PairingUrl locale) garde la main.
/// </summary>
public static class InstanceSettings
{
    public const string FileName = "appsettings.Instance.json";
    private const string BaseFileName = "appsettings.json";

    /// <summary>Ajoute le fichier de l'instance (facultatif) et le place juste après appsettings.json.</summary>
    public static void Add(IConfigurationBuilder config)
    {
        config.AddJsonFile(FileName, optional: true, reloadOnChange: false);
        PlaceAfterBase(config.Sources);
    }

    /// <summary>Déplace la source de l'instance juste après celle d'appsettings.json (sinon laissée en place).</summary>
    internal static void PlaceAfterBase(IList<IConfigurationSource> sources)
    {
        var instance = sources.OfType<JsonConfigurationSource>().LastOrDefault(s => s.Path == FileName);
        var baseSource = sources.OfType<JsonConfigurationSource>().FirstOrDefault(s => s.Path == BaseFileName);
        if (instance == null || baseSource == null) return;
        sources.Remove(instance);
        sources.Insert(sources.IndexOf(baseSource) + 1, instance);
    }
}

/// <summary>Fiche contact du loueur, affichée sur l'écran d'accueil client.</summary>
public class ContactSettings
{
    public string CompanyName { get; set; } = "";
    public string PhoneNumber { get; set; } = "";
    public string Email       { get; set; } = "";
}

public class SupabaseSettings
{
    public string Url { get; set; } = "";
    public string AnonKey { get; set; } = "";

    /// <summary>URL et clé anon toutes deux renseignées.</summary>
    public bool HasAddress => !string.IsNullOrWhiteSpace(Url) && !string.IsNullOrWhiteSpace(AnonKey);

    /// <summary>
    /// Origine de l'adresse, fixée au démarrage par <see cref="SaasEndpoint.Apply"/> (jamais lue dans les
    /// appsettings : setter interne). <see cref="SaasEndpointSource.None"/> = écran « Adresse de votre SaaS ».
    /// </summary>
    public SaasEndpointSource Source { get; internal set; }
}

public class KioskSettings
{
    public string DataDirectory { get; set; } = "%AppData%\\PolaKiosk";

    /// <summary>Nom exact de l'imprimante dans Windows. Vide = imprimante par défaut.</summary>
    public string PrinterName { get; set; } = "";

    /// <summary>
    /// Secret de licence de repli, pour le développement seulement : lu en build Debug lancé en
    /// environnement Development, et seulement tant que la borne n'a pas été associée (le secret reçu
    /// à l'association, protégé par DPAPI, prime). Ignoré sur une borne de production.
    /// </summary>
    public string LicenseSecret { get; set; } = "";

    /// <summary>
    /// Page du SaaS où l'on tape le code d'association (LAB-244). Le QR code de l'écran d'association
    /// pointe vers <c>{PairingUrl}?code=XXXXXX</c>.
    /// </summary>
    public string PairingUrl { get; set; } = "";

    /// <summary>PairingUrl, sinon <c>{SaasUrl}/associer</c>, sinon vide.</summary>
    public string ResolvePairingUrl()
    {
        if (!string.IsNullOrWhiteSpace(PairingUrl)) return PairingUrl.Trim();
        var saas = (SaasUrl ?? "").Trim().TrimEnd('/');
        return saas.Length == 0 ? "" : saas + "/associer";
    }

    /// <summary>Intervalle (secondes) entre deux interrogations du serveur pendant l'association.</summary>
    public int PairingPollSeconds { get; set; } = 3;

    /// <summary>
    /// PIN admin de développement, lu uniquement dans appsettings.Development.json en build Debug.
    /// En production, le PIN de chaque borne est défini dans le SaaS (page Licences) puis envoyé.
    /// </summary>
    public string DevAdminPin { get; set; } = "";

    /// <summary>Active le mode kiosk plein écran + blocage clavier. Désactivé dans appsettings.Development.json.</summary>
    public bool KioskMode { get; set; } = true;

    /// <summary>URL de base du SaaS (sans slash final). Utilisé pour construire les liens de galerie dans les QR codes.</summary>
    public string SaasUrl { get; set; } = "";

    /// <summary>Délai d'inactivité (secondes) avant retour automatique à l'accueil. 0 = désactivé.</summary>
    public int IdleTimeoutSeconds { get; set; } = 120;

    /// <summary>Durée (jours) pendant laquelle une licence vérifiée reste valable hors ligne.</summary>
    public int LicenseGraceDays { get; set; } = 14;
}

public class CameraSettings
{
    // null = sélection automatique (Canon > Webcam > Mock)
    public CameraSource? ForcedSource { get; set; } = null;
    public int WebcamIndex { get; set; } = 0;
}
