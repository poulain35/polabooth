using Newtonsoft.Json;

namespace PolaKiosk.Models.Supabase;

public class KioskConfigDto
{
    [JsonProperty("kiosk")]
    public KioskConfig? Kiosk { get; set; }
}

public class KioskConfig
{
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

    [JsonProperty("locale")]
    public string Locale { get; set; } = "fr";
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
