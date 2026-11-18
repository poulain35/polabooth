using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

/// <summary>
/// Contenu d'un fichier .pola (JSON GZip exporté par le SaaS, saas/src/lib/polaBundle.js) :
/// tout ce que la synchro en ligne récupère pour un événement. Lu et vérifié en entier avant
/// d'écrire quoi que ce soit : un fichier refusé ne laisse rien sur la borne.
/// <see cref="Contact"/> : bloc « contact » (null s'il manque ou n'a pas de nom de société).
/// <see cref="Logo"/> : logo de la société (assets.logo, LAB-257), null s'il n'a pas pu être embarqué.
/// <see cref="HomeDesignPng"/> : écran d'accueil validé du client (assets.home_design, LAB-291), décrit
/// par <c>Design.HomeDesign</c> (champ <c>home_design</c> à la racine). Les deux sont facultatifs : un
/// fichier sans écran d'accueil efface celui gardé en cache.
/// <see cref="Screens"/> : écrans composés par l'admin (bloc « screens », LAB-297), null si le fichier
/// n'en a pas (la borne revient alors aux écrans standard).
/// <see cref="FramePngs"/> : PNG des autres cadres validés (bloc « frames » à la racine, décrits par
/// <c>Design.Frames</c>, et <c>assets["frame/{id}"]</c>, LAB-315). Un cadre sans PNG lisible est retiré ;
/// un fichier sans « frames » ne garde que le design principal.
/// </summary>
internal sealed record PolaBundle(
    EventDto Event,
    TemplateDto Design,
    byte[] DesignPng,
    byte[]? HomeBackground,
    OrgContact? Contact,
    byte[]? Logo,
    byte[]? HomeDesignPng,
    PolaScreens? Screens = null,
    IReadOnlyDictionary<Guid, byte[]>? FramePngs = null)
{
    public const int FormatVersion = 2;
    public const string FrameAssetPrefix = "frame/";

    public const string UnreadableMessage =
        "Fichier .pola illisible (abîmé ou d'un autre type). Téléchargez-le à nouveau depuis le SaaS.";
    public const string OldFormatMessage =
        "Ce fichier .pola est d'un ancien format, sans le design de l'événement. Téléchargez-le à nouveau "
        + "depuis le SaaS (fiche de l'événement, « Télécharger .pola »).";
    public const string NewerFormatMessage =
        "Ce fichier .pola vient d'une version plus récente du SaaS. Mettez la borne à jour avant de l'importer.";
    public const string NoDesignMessage =
        "Ce fichier .pola ne contient pas le design approuvé de l'événement : les photos sortiraient sans cadre. "
        + "Téléchargez-le à nouveau depuis le SaaS une fois le design approuvé.";
    public const string NoEventMessage = "Fichier .pola incomplet : l'événement est absent.";
    public const string TooLargeMessage =
        "Fichier .pola trop volumineux (plus de 300 Mo une fois décompressé) : import refusé. "
        + "Téléchargez-le à nouveau depuis le SaaS.";
    public const string OtherAccountMessage =
        "Ce fichier vient d'un autre compte. Téléchargez le .pola depuis le compte auquel la borne est associée.";

    /// <summary>
    /// LAB-244 : un .pola d'un autre compte que celui de la borne est refusé (<see cref="InvalidDataException"/>).
    /// Compte de la borne inconnu (aucun événement chargé en ligne depuis l'association, par exemple un
    /// premier démarrage sans réseau) : le fichier est accepté, pour ne pas bloquer un événement hors ligne.
    /// </summary>
    public void EnsureSameAccount(Guid? kioskOrgId)
    {
        if (kioskOrgId is { } org && org != Guid.Empty && Event.OrgId != org)
            throw new InvalidDataException(OtherAccountMessage);
    }

    /// <summary>Lève <see cref="InvalidDataException"/> (message affichable) si le fichier est refusé.</summary>
    public static PolaBundle Parse(string json)
    {
        try
        {
            var root = JObject.Parse(json);

            var version = root["version"]?.Type == JTokenType.Integer ? root.Value<int>("version") : 0;
            if (version > FormatVersion) throw new InvalidDataException(NewerFormatMessage);
            if (version < FormatVersion) throw new InvalidDataException(OldFormatMessage);

            // Mêmes lectures que la synchro en ligne (réponses de kiosk_get_event et de client_designs).
            var ev = root["event"] is JObject evObj ? SupabaseRpcResponses.ParseEventRpcResponse(evObj.ToString()) : null;
            if (ev == null || ev.Id == Guid.Empty || string.IsNullOrWhiteSpace(ev.AccessCode))
                throw new InvalidDataException(NoEventMessage);

            var assets = root["assets"] as JObject;
            var designPng = Base64(assets?["design_png"]);
            if (root["design"] is not JObject designObj || designObj["id"] == null || designPng == null)
                throw new InvalidDataException(NoDesignMessage);
            var design = ApprovedDesignReader.ParseApprovedDesign(designObj);
            if (string.IsNullOrEmpty(design.ThumbnailUrl)) throw new InvalidDataException(NoDesignMessage);

            // Écran d'accueil validé (LAB-291) : à la racine du fichier, comme home_design de la RPC.
            design.HomeDesign = ApprovedDesignReader.ParseHomeDesign(root["home_design"]);
            var homeDesignPng = design.HomeDesign == null ? null : Base64(assets?["home_design"]);

            // Autres cadres (LAB-315) : à la racine, comme frames dans la réponse de la RPC.
            var framePngs = FrameAssets(assets);
            design.Frames = ApprovedDesignReader.ParseFrames(root["frames"], design.Id)
                .Where(f => framePngs.ContainsKey(f.Id))
                .ToList();

            // Même contenu que la RPC get_org_contact_by_event, sous des noms courts.
            var contact = root["contact"] as JObject;
            var company = (string?)contact?["company"];
            OrgContact? orgContact = string.IsNullOrWhiteSpace(company) ? null
                : new OrgContact(company, NullIfBlank((string?)contact!["phone"]), NullIfBlank((string?)contact["logo_url"]),
                    NullIfBlank((string?)contact["email"]));

            return new PolaBundle(ev, design, designPng,
                Base64(assets?["home_background"]),
                orgContact,
                orgContact?.LogoUrl == null ? null : Base64(assets?["logo"]),
                homeDesignPng,
                PolaScreens.Parse(root["screens"], assets),
                design.Frames.ToDictionary(f => f.Id, f => framePngs[f.Id]));
        }
        catch (Exception ex) when (ex is JsonException or FormatException or ArgumentException)
        {
            throw new InvalidDataException(UnreadableMessage, ex);
        }
    }

    private static Dictionary<Guid, byte[]> FrameAssets(JObject? assets)
    {
        var pngs = new Dictionary<Guid, byte[]>();
        foreach (var property in assets?.Properties() ?? [])
        {
            if (!property.Name.StartsWith(FrameAssetPrefix, StringComparison.Ordinal)
                || !Guid.TryParse(property.Name[FrameAssetPrefix.Length..], out var id)
                || property.Value.Type != JTokenType.String) continue;
            try
            {
                if (Convert.FromBase64String((string)property.Value!) is { Length: > 0 } bytes) pngs[id] = bytes;
            }
            catch (FormatException) { /* PNG abîmé : ce cadre est retiré, les autres restent */ }
        }
        return pngs;
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private static byte[]? Base64(JToken? token)
        => token?.Type == JTokenType.String && token.ToString() is { Length: > 0 } b64
            ? Convert.FromBase64String(b64)
            : null;
}

/// <summary>
/// Bloc « screens » d'un .pola (LAB-297) : les plans publiés de l'accueil et du partage, tels que la
/// RPC kiosk_get_screens les renvoie (adresses complètes), et leurs images et polices (LAB-331), en
/// assets <c>screens/{nom}</c> (nom = dernier segment de l'adresse). Lecture tolérante : un écran ou une
/// image abîmé ne refuse pas le fichier, l'écran concerné garde simplement sa version précédente.
/// </summary>
internal sealed record PolaScreens(JObject? Home, JObject? Result, IReadOnlyDictionary<string, byte[]> Assets)
{
    public const string AssetPrefix = "screens/";

    public JObject? For(string kind) => kind == ScreenLayout.KindHome ? Home : Result;

    /// <summary>Image ou police d'une adresse du plan, ou null si le fichier ne l'a pas embarquée.</summary>
    public byte[]? AssetFor(string url)
        => Assets.TryGetValue(ScreenCache.LastSegment(url), out var bytes) ? bytes : null;

    public static PolaScreens? Parse(JToken? screens, JObject? assets)
    {
        if (screens is not JObject block) return null;

        var images = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var property in assets?.Properties() ?? [])
        {
            if (!property.Name.StartsWith(AssetPrefix, StringComparison.Ordinal)) continue;
            var name = property.Name[AssetPrefix.Length..];
            if (name.Length == 0 || property.Value.Type != JTokenType.String) continue;
            try { images[name] = Convert.FromBase64String((string)property.Value!); }
            catch (FormatException) { /* image abîmée : l'écran qui la demande garde sa version précédente */ }
        }

        return new PolaScreens(block["home"] as JObject, block["result"] as JObject, images);
    }
}
