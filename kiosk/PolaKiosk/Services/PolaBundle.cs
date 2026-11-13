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
/// </summary>
internal sealed record PolaBundle(
    EventDto Event,
    TemplateDto Design,
    byte[] DesignPng,
    byte[]? HomeBackground,
    OrgContact? Contact,
    byte[]? Logo)
{
    public const int FormatVersion = 2;

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
            var ev = root["event"] is JObject evObj ? SupabaseService.ParseEventRpcResponse(evObj.ToString()) : null;
            if (ev == null || ev.Id == Guid.Empty || string.IsNullOrWhiteSpace(ev.AccessCode))
                throw new InvalidDataException(NoEventMessage);

            var assets = root["assets"] as JObject;
            var designPng = Base64(assets?["design_png"]);
            if (root["design"] is not JObject designObj || designObj["id"] == null || designPng == null)
                throw new InvalidDataException(NoDesignMessage);
            var design = SupabaseService.ParseApprovedDesign(designObj);
            if (string.IsNullOrEmpty(design.ThumbnailUrl)) throw new InvalidDataException(NoDesignMessage);

            // Même contenu que la RPC get_org_contact_by_event, sous des noms courts.
            var contact = root["contact"] as JObject;
            var company = (string?)contact?["company"];
            OrgContact? orgContact = string.IsNullOrWhiteSpace(company) ? null
                : new OrgContact(company, NullIfBlank((string?)contact!["phone"]), NullIfBlank((string?)contact["logo_url"]),
                    NullIfBlank((string?)contact["email"]));

            return new PolaBundle(ev, design, designPng,
                Base64(assets?["home_background"]),
                orgContact,
                orgContact?.LogoUrl == null ? null : Base64(assets?["logo"]));
        }
        catch (Exception ex) when (ex is JsonException or FormatException or ArgumentException)
        {
            throw new InvalidDataException(UnreadableMessage, ex);
        }
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private static byte[]? Base64(JToken? token)
        => token?.Type == JTokenType.String && token.ToString() is { Length: > 0 } b64
            ? Convert.FromBase64String(b64)
            : null;
}
