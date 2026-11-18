using System.IO.Compression;
using Newtonsoft.Json.Linq;

namespace PolaKiosk.Tests.Services;

/// <summary>Fichier .pola tel que l'exporte le SaaS (saas/src/lib/polaBundle.js, format 2).</summary>
internal static class PolaFixture
{
    public static readonly Guid EventId  = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    public static readonly Guid DesignId = Guid.Parse("0a9b8c7d-2222-4333-8444-a55566667777");
    public const string Code          = "TUQNA5";
    public const string BackgroundUrl = "https://cdn.example/kiosk-backgrounds/ev/background.jpg";
    public const string DesignPngUrl  = "https://cdn.example/designs/ev/20261104_101500.png";
    public const string StartDate     = "2026-06-14T14:00:00+00:00";
    public const string EndDate       = "2026-06-15T02:00:00+00:00";
    public const string DisplayName   = "Julie & Thomas";
    public const string Company       = "Studio Exemple";
    public const string Phone         = "06 00 00 00 00";
    public const string Email         = "bonjour@exemple.fr";
    public const string LogoUrl       = "https://cdn.example/kiosk-backgrounds/org/o1/logo.png?v=1";

    // Écran d'accueil créé par le client et validé (LAB-291).
    public static readonly Guid HomeDesignId = Guid.Parse("1b2c3d4e-3333-4444-8555-b66677778888");
    public const string HomeDesignPngUrl     = "https://cdn.example/designs/ev/home/20261115_090000.png";

    public static readonly byte[] DesignPng      = [0x89, 0x50, 0x4E, 0x47, 1, 2, 3];
    public static readonly byte[] HomeBackground = [0xFF, 0xD8, 0xFF, 4, 5];
    public static readonly byte[] Logo           = [0x89, 0x50, 0x4E, 0x47, 8, 9];
    public static readonly byte[] HomeDesignPng  = [0x89, 0x50, 0x4E, 0x47, 5, 6, 7];

    /// <summary>Champ home_design de kiosk_get_approved_design (et de la racine du .pola).</summary>
    public static JObject HomeDesign() => new() { ["id"] = HomeDesignId.ToString(), ["final_png_url"] = HomeDesignPngUrl };

    /// <summary>Réponse de kiosk_get_approved_design avec l'écran d'accueil validé.</summary>
    public static JObject DesignWithHome()
    {
        var design = Design();
        design["home_design"] = HomeDesign();
        return design;
    }

    /// <summary>.pola d'un événement dont le client a un écran d'accueil validé (LAB-291).</summary>
    public static JObject BundleWithHome()
    {
        var bundle = Bundle();
        bundle["home_design"] = HomeDesign();
        ((JObject)bundle["assets"]!)["home_design"] = Convert.ToBase64String(HomeDesignPng);
        return bundle;
    }

    // Autres cadres validés du client (LAB-315) : une bandelette nommée, puis un 10×15 paysage sans nom.
    public static readonly Guid StripFrameId     = Guid.Parse("3c4d5e6f-5555-4666-8777-d88899990000");
    public static readonly Guid LandscapeFrameId = Guid.Parse("4d5e6f70-6666-4777-8888-e9990000aaaa");
    public const string DesignLabel              = "Le cadre des mariés";
    public const string StripFrameLabel          = "Bandelette";
    public const string StripFramePngUrl         = "https://cdn.example/designs/ev/frames/strip.png";
    public const string LandscapeFramePngUrl     = "https://cdn.example/designs/ev/frames/landscape.png";
    public static readonly byte[] StripFramePng     = [0x89, 0x50, 0x4E, 0x47, 2, 2];
    public static readonly byte[] LandscapeFramePng = [0x89, 0x50, 0x4E, 0x47, 3, 3];

    /// <summary>Un cadre de frames (kiosk_get_approved_design et racine du .pola).</summary>
    public static JObject Frame(Guid id, int slot, string? label, string format, string pngUrl) => new()
    {
        ["id"]            = id.ToString(),
        ["slot"]          = slot,
        ["label"]         = label,
        ["format"]        = format,
        ["canvas_json"]   = Canvas(),
        ["final_png_url"] = pngUrl,
    };

    public static JArray Frames() => new(
        Frame(StripFrameId, 2, StripFrameLabel, "stripV", StripFramePngUrl),
        Frame(LandscapeFrameId, 3, null, "landscape", LandscapeFramePngUrl));

    /// <summary>Réponse de kiosk_get_approved_design avec le choix du cadre actif (LAB-315).</summary>
    public static JObject DesignWithFrames()
    {
        var design = Design();
        design["label"]  = DesignLabel;
        design["frames"] = Frames();
        return design;
    }

    /// <summary>.pola d'un événement avec le choix du cadre : frames à la racine, PNG dans assets["frame/{id}"].</summary>
    public static JObject BundleWithFrames()
    {
        var bundle = Bundle();
        bundle["design"]!["label"] = DesignLabel;
        bundle["frames"] = Frames();
        var assets = (JObject)bundle["assets"]!;
        assets[$"frame/{StripFrameId}"]     = Convert.ToBase64String(StripFramePng);
        assets[$"frame/{LandscapeFrameId}"] = Convert.ToBase64String(LandscapeFramePng);
        return bundle;
    }

    /// <summary>Réponse de get_org_contact_by_event pour l'événement du fichier.</summary>
    public static PolaKiosk.Models.Supabase.OrgContact Contact() => new(Company, Phone, LogoUrl, Email);

    // Zone photo rangée dans un groupe (LAB-214) : attendue en (20, 30, 160, 120) sur le canvas.
    public static JObject Canvas() => JObject.Parse(
        """{"version":"5.3.0","objects":[{"type":"group","left":20,"top":30,"width":281,"height":121,"strokeWidth":0,"objects":[{"type":"rect","left":-140.5,"top":-60.5,"width":160,"height":120,"strokeWidth":0,"isPhotoZone":true}]}]}""");

    public static JObject Event() => new()
    {
        ["id"]          = EventId.ToString(),
        ["org_id"]      = Guid.NewGuid().ToString(),
        ["name"]        = "Mariage Julie & Thomas",
        ["access_code"] = Code,
        // Dates de l'événement (LAB-250) : soirée du samedi 14 juin, 16 h à 4 h du matin à Paris.
        ["start_date"]  = StartDate,
        ["end_date"]    = EndDate,
        ["form_config"] = new JObject
        {
            ["kiosk"] = new JObject
            {
                ["home"]    = new JObject
                {
                    ["title"]          = "Bienvenue",
                    ["background_url"] = BackgroundUrl,
                    ["personalized"]   = true,
                    ["display_name"]   = DisplayName,
                },
                ["capture"] = new JObject { ["countdown_seconds"] = 3 },
                ["rgpd"]    = new JObject { ["enabled"] = true, ["message"] = "J'accepte" },
            },
        },
    };

    public static JObject Design() => new()
    {
        ["id"]            = DesignId.ToString(),
        ["format"]        = "stripV",
        ["canvas_json"]   = Canvas(),
        ["final_png_url"] = DesignPngUrl,
    };

    public static JObject Bundle() => new()
    {
        ["version"]     = 2,
        ["exported_at"] = "2026-11-04T10:00:00.000Z",
        ["event"]       = Event(),
        ["design"]      = Design(),
        ["assets"]      = new JObject
        {
            ["design_png"]      = Convert.ToBase64String(DesignPng),
            ["home_background"] = Convert.ToBase64String(HomeBackground),
            ["logo"]            = Convert.ToBase64String(Logo),
        },
        ["contact"] = new JObject { ["company"] = Company, ["phone"] = Phone, ["logo_url"] = LogoUrl, ["email"] = Email },
    };

    /// <summary>.pola d'un autre événement (LAB-321) : id, nom, code, dates et design propres.</summary>
    public static JObject BundleOf(Guid eventId, Guid designId, string name, string code,
        string? startDate = null, string? endDate = null)
    {
        var bundle = Bundle();
        var ev = (JObject)bundle["event"]!;
        ev["id"]          = eventId.ToString();
        ev["name"]        = name;
        ev["access_code"] = code;
        ev["start_date"]  = startDate;
        ev["end_date"]    = endDate;
        bundle["design"]!["id"] = designId.ToString();
        return bundle;
    }

    /// <summary>Ancien format (version 1) : bibliothèque de templates, pas de design.</summary>
    public static JObject OldBundle() => new()
    {
        ["version"]   = 1,
        ["event"]     = Event(),
        ["templates"] = new JArray(new JObject { ["id"] = Guid.NewGuid().ToString(), ["name"] = "Bibliothèque" }),
        ["assets"]    = new JObject(),
    };

    public static void Write(string path, JObject bundle)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var file = File.Create(path);
        using var gzip = new GZipStream(file, CompressionLevel.Fastest);
        using var writer = new StreamWriter(gzip);
        writer.Write(bundle.ToString());
    }
}
