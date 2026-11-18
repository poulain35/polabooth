using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PolaKiosk.Models.Supabase;

public class KioskConfigDto
{
    [JsonProperty("kiosk")]
    public KioskConfig? Kiosk { get; set; }
}

public class KioskConfig
{
    /// <summary>
    /// Partie <c>kiosk</c> du <c>form_config</c> de l'événement (seule lecture de la borne, LAB-401).
    /// Absente ou illisible : null, la borne prend ses réglages par défaut (accueil neutre, sans
    /// consentement ni questionnaire).
    /// </summary>
    public static KioskConfig? FromFormConfig(string? formConfigJson)
    {
        if (string.IsNullOrWhiteSpace(formConfigJson)) return null;
        try { return (JToken.Parse(formConfigJson) as JObject)?["kiosk"]?.ToObject<KioskConfig>(); }
        catch (JsonException) { return null; }
    }

    [JsonProperty("home")]
    public HomeConfig Home { get; set; } = new();

    [JsonProperty("capture")]
    public CaptureConfig Capture { get; set; } = new();

    [JsonProperty("rgpd")]
    public RgpdConfig Rgpd { get; set; } = new();

    [JsonProperty("effects")]
    public EffectsConfig Effects { get; set; } = new();

    [JsonProperty("result")]
    public ResultConfig Result { get; set; } = new();

    [JsonProperty("email")]
    public EmailShareConfig Email { get; set; } = new();

    [JsonProperty("printer")]
    public PrinterConfig Printer { get; set; } = new();

    /// <summary>
    /// Questionnaire après la prise de vue (LAB-222). Null si absent ou illisible : une config
    /// cassée désactive le questionnaire sans faire échouer le reste de la config.
    /// </summary>
    [JsonProperty("questionnaire")]
    [JsonConverter(typeof(QuestionnaireConfigConverter))]
    public QuestionnaireConfig? Questionnaire { get; set; }

    /// <summary>
    /// Choix du cadre par l'invité (LAB-315). Null si absent ou illisible : choix coupé, sans faire
    /// échouer le reste de la config.
    /// </summary>
    [JsonProperty("frame_choice")]
    [JsonConverter(typeof(FrameChoiceConfigConverter))]
    public FrameChoiceConfig? FrameChoice { get; set; }

    [JsonProperty("locale")]
    public string Locale { get; set; } = "fr";
}

/// <summary>
/// <c>form_config.kiosk.frame_choice</c> : l'invité choisit son cadre parmi les cadres validés.
/// <c>MaxFrames</c> limite l'éditeur du client ; la borne prend tous les cadres validés reçus.
/// </summary>
public class FrameChoiceConfig
{
    public const int DefaultMaxFrames = 2;

    [JsonProperty("enabled")]
    public bool Enabled { get; set; }

    [JsonProperty("max_frames")]
    public int MaxFrames { get; set; } = DefaultMaxFrames;
}

/// <summary>
/// Lecture tolérante : <c>enabled</c> doit être un vrai booléen (comme la RPC), <c>max_frames</c>
/// un entier de 2 à 4 (sinon 2). Une valeur d'une autre forme donne null, jamais une erreur.
/// </summary>
public sealed class FrameChoiceConfigConverter : JsonConverter<FrameChoiceConfig?>
{
    public override bool CanWrite => false;

    public override FrameChoiceConfig? ReadJson(JsonReader reader, Type objectType,
        FrameChoiceConfig? existingValue, bool hasExistingValue, JsonSerializer serializer)
    {
        JToken token;
        try { token = JToken.Load(reader); }
        catch { return null; }
        return Parse(token);
    }

    public override void WriteJson(JsonWriter writer, FrameChoiceConfig? value, JsonSerializer serializer)
        => throw new NotSupportedException();

    public static FrameChoiceConfig? Parse(JToken? token)
    {
        if (token is not JObject obj) return null;
        var max = obj["max_frames"] is { Type: JTokenType.Integer } m ? m.Value<long>() : FrameChoiceConfig.DefaultMaxFrames;
        return new FrameChoiceConfig
        {
            Enabled   = obj["enabled"] is { Type: JTokenType.Boolean } e && e.Value<bool>(),
            MaxFrames = max is >= 2 and <= 4 ? (int)max : FrameChoiceConfig.DefaultMaxFrames,
        };
    }
}

public class HomeConfig
{
    /// <summary>Fond de l'écran d'accueil (URL publique), mis en cache local à la synchronisation.</summary>
    [JsonProperty("background_url")]
    public string? BackgroundUrl { get; set; }

    /// <summary>Accueil personnalisé (LAB-250) : nom et date en grand (1b), ou choix du format (1c).</summary>
    [JsonProperty("personalized")]
    public bool Personalized { get; set; }

    /// <summary>Nom affiché sur l'accueil personnalisé (40 caractères au plus). Vide = nom de l'événement.</summary>
    [JsonProperty("display_name")]
    public string? DisplayName { get; set; }

    /// <summary>
    /// LAB-291 : le client crée son écran d'accueil (1920×1080). Sans effet si <see cref="Personalized"/>
    /// est faux ; l'écran n'est affiché que s'il est validé et en cache (sinon 1b / 1c).
    /// </summary>
    [JsonProperty("client_design")]
    public bool ClientDesign { get; set; }

    /// <summary>Formats proposés à l'accueil (saas/src/lib/kioskFormats.js) : photo seule par défaut.</summary>
    [JsonProperty("buttons")]
    public HomeButtonsConfig Buttons { get; set; } = new();
}

/// <summary>Boutons de format de l'accueil (home.buttons), mêmes clés que le SaaS.</summary>
public class HomeButtonsConfig
{
    [JsonProperty("photo")]
    public HomeButtonConfig Photo { get; set; } = new() { Enabled = true, Label = "Photo" };

    [JsonProperty("gif")]
    public HomeButtonConfig Gif { get; set; } = new() { Enabled = false, Label = "GIF" };

    [JsonProperty("boomerang")]
    public HomeButtonConfig Boomerang { get; set; } = new() { Enabled = false, Label = "Boomerang" };
}

/// <summary>Un format de l'accueil : activé ou non, et son titre sur la tuile de l'écran 1c.</summary>
public class HomeButtonConfig
{
    [JsonProperty("enabled")]
    public bool Enabled { get; set; } = true;

    [JsonProperty("label")]
    public string Label { get; set; } = "";
}

public class EffectsConfig
{
    [JsonProperty("enabled_effects")]
    public List<string> EnabledEffects { get; set; } = new() { "none" };

    [JsonProperty("default_effect")]
    public string DefaultEffect { get; set; } = "none";

    [JsonProperty("user_can_choose")]
    public bool UserCanChoose { get; set; } = true;
}

public class EmailShareConfig
{
    [JsonProperty("enabled")]
    public bool Enabled { get; set; } = false;

    [JsonProperty("sender_name")]
    public string SenderName { get; set; } = "";

    [JsonProperty("sender_email")]
    public string SenderEmail { get; set; } = "";

    [JsonProperty("subject")]
    public string Subject { get; set; } = "Vos photos de {event_name}";

    [JsonProperty("message")]
    public string Message { get; set; } = "Bonjour,\n\nRetrouvez vos photos en pièce jointe.\n\nBonne fête !";
}

public class RgpdConfig
{
    [JsonProperty("enabled")]
    public bool Enabled { get; set; } = false;

    [JsonProperty("message")]
    public string Message { get; set; } = "En participant, vous acceptez que vos photos soient utilisées dans le cadre de cet événement.";
}

public class CaptureConfig
{
    [JsonProperty("mirror")]
    public bool Mirror { get; set; } = true;

    [JsonProperty("countdown_seconds")]
    public int CountdownSeconds { get; set; } = 5;
}

public class ResultConfig
{
    [JsonProperty("auto_print")]
    public bool AutoPrint { get; set; } = false;

    [JsonProperty("max_prints_per_event")]
    public int? MaxPrintsPerEvent { get; set; }

    [JsonProperty("max_prints_per_photo")]
    public int? MaxPrintsPerPhoto { get; set; } = 2;

    [JsonProperty("show_remaining_prints")]
    public bool ShowRemainingPrints { get; set; } = true;

    /// <summary>Délai d'inactivité (s) sur l'écran de partage avant retour automatique à l'accueil. 0 = désactivé.</summary>
    [JsonProperty("auto_return_seconds")]
    public int AutoReturnSeconds { get; set; } = 30;

    [JsonProperty("buttons")]
    public ResultButtonsConfig Buttons { get; set; } = new();
}

/// <summary>
/// Activation d'un bouton de l'écran résultat, réglée dans le SaaS. Les textes sont fixes sur la
/// borne (LAB-252) : un ancien libellé (« label ») est ignoré.
/// </summary>
public class ResultButtonConfig
{
    [JsonProperty("enabled")]
    public bool Enabled { get; set; } = true;
}

/// <summary>retake = « Refaire les photos », print = bloc d'impression, qr et email = tuiles, home = « Terminer ».</summary>
public class ResultButtonsConfig
{
    [JsonProperty("retake")]
    public ResultButtonConfig Retake { get; set; } = new();

    [JsonProperty("print")]
    public ResultButtonConfig Print { get; set; } = new();

    [JsonProperty("qr")]
    public ResultButtonConfig Qr { get; set; } = new();

    [JsonProperty("email")]
    public ResultButtonConfig Email { get; set; } = new();

    [JsonProperty("home")]
    public ResultButtonConfig Home { get; set; } = new();
}

public class PrinterConfig
{
    [JsonProperty("default_printer")]
    public string DefaultPrinter { get; set; } = "";

    [JsonProperty("paper_format")]
    public string PaperFormat { get; set; } = "4x6";
}
