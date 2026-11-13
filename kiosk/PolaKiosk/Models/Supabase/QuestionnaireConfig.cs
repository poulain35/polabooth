using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PolaKiosk.Models.Supabase;

/// <summary>
/// Questionnaire posé après la prise de vue (<c>form_config.kiosk.questionnaire</c>, spec LAB-208).
/// Miroir de <c>saas/src/lib/kioskQuestionnaire.js</c>. La lecture est tolérante : une question
/// illisible est ignorée, une config sans question utilisable désactive le questionnaire.
/// </summary>
public class QuestionnaireConfig
{
    public const int MaxQuestions   = 8;
    public const int MaxOptions     = 12;
    public const int MaxLabelLength = 120;

    public const string DefaultHomeNotice = "Pour recevoir votre photo, quelques questions vous seront posées.";
    public const string DefaultNotice =
        "Vos réponses sont collectées pour {controller_name}. Elles sont conservées 1 mois après l'événement, puis supprimées. Pour les consulter ou les supprimer : {controller_contact}.";
    public const string DefaultMarketingLabel = "J'accepte d'être recontacté(e) par {controller_name}.";

    /// <summary>
    /// Nom du loueur de la borne quand il n'est pas connu (open core L7) : ni société synchronisée,
    /// ni <c>Contact.CompanyName</c> dans la config de l'instance.
    /// </summary>
    public const string DefaultProviderName = "le prestataire";

    [JsonProperty("enabled")]
    public bool Enabled { get; set; }

    /// <summary>Mode obligatoire (défaut) : sans réponse, pas de photo. Sinon « Passer » donne la photo.</summary>
    [JsonProperty("required_for_photo")]
    public bool RequiredForPhoto { get; set; } = true;

    [JsonProperty("home_notice")]
    public string HomeNotice { get; set; } = DefaultHomeNotice;

    [JsonProperty("title")]
    public string Title { get; set; } = "Restons en contact";

    [JsonProperty("intro")]
    public string Intro { get; set; } = "Quelques questions rapides pendant que votre photo se prépare.";

    [JsonProperty("cancel_label")]
    public string CancelLabel { get; set; } = "Annuler";

    [JsonProperty("skip_label")]
    public string SkipLabel { get; set; } = "Passer";

    [JsonProperty("questions")]
    public List<QuestionConfig> Questions { get; set; } = new();

    [JsonProperty("controller")]
    public ControllerConfig Controller { get; set; } = new();

    [JsonProperty("notice")]
    public string Notice { get; set; } = DefaultNotice;

    [JsonProperty("marketing_consent")]
    public MarketingConsentConfig MarketingConsent { get; set; } = new();

    [JsonProperty("prefill_share_email")]
    public bool PrefillShareEmail { get; set; } = true;

    /// <summary>
    /// Questions affichables, dans l'ordre : identifiant et libellé non vides, type connu, au moins
    /// une option pour un choix, identifiants uniques, limites de la spec. Une case à cocher n'est
    /// jamais obligatoire (forcer l'invité à cocher « oui »).
    /// </summary>
    public IReadOnlyList<QuestionConfig> UsableQuestions()
    {
        var usable = new List<QuestionConfig>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var q in Questions)
        {
            if (usable.Count == MaxQuestions) break;
            if (q == null) continue;

            var id    = q.Id?.Trim() ?? "";
            var label = q.Label?.Trim() ?? "";
            var type  = q.Type?.Trim().ToLowerInvariant() ?? "";
            if (id.Length == 0 || label.Length == 0 || !QuestionTypes.IsKnown(type) || !ids.Add(id)) continue;

            var options = new List<string>();
            if (QuestionTypes.IsChoice(type))
            {
                foreach (var o in q.Options ?? new List<string>())
                {
                    var option = o?.Trim() ?? "";
                    if (option.Length > 0 && !options.Contains(option)) options.Add(Truncate(option));
                    if (options.Count == MaxOptions) break;
                }
                if (options.Count == 0) continue;
            }

            usable.Add(new QuestionConfig
            {
                Id       = id,
                Label    = Truncate(label),
                Type     = type,
                Required = q.Required && type != QuestionTypes.Checkbox,
                Options  = options,
            });
        }
        return usable;
    }

    /// <summary>Questionnaire à poser : activé et au moins une question utilisable.</summary>
    [JsonIgnore]
    public bool IsActive => Enabled && UsableQuestions().Count > 0;

    /// <summary>Mention d'accueil (mode obligatoire seulement), jamais vide.</summary>
    public string ResolvedHomeNotice()
        => string.IsNullOrWhiteSpace(HomeNotice) ? DefaultHomeNotice : HomeNotice.Trim();

    /// <summary>
    /// Remplace <c>{controller_name}</c>, <c>{controller_contact}</c> et le nom du loueur de la borne
    /// (<c>{provider_name}</c>, ou <c>{Provider_name}</c> en début de phrase). Contact du client absent :
    /// email du loueur, à défaut son nom (open core L7, plus d'adresse écrite en dur).
    /// </summary>
    public string ResolvePlaceholders(string? text, QuestionnaireProvider? provider = null)
    {
        var name = string.IsNullOrWhiteSpace(Controller?.Name) ? "l'organisateur" : Controller!.Name.Trim();
        var providerName = string.IsNullOrWhiteSpace(provider?.Name) ? DefaultProviderName : provider!.Name.Trim();
        var contact = !string.IsNullOrWhiteSpace(Controller?.ContactEmail) ? Controller!.ContactEmail.Trim()
            : !string.IsNullOrWhiteSpace(provider?.ContactEmail) ? provider!.ContactEmail.Trim()
            : providerName;
        return (text ?? "")
            .Replace("{controller_name}", name)
            .Replace("{controller_contact}", contact)
            .Replace("{Provider_name}", char.ToUpperInvariant(providerName[0]) + providerName[1..])
            .Replace("{provider_name}", providerName)
            .Trim();
    }

    private static string Truncate(string text)
        => text.Length <= MaxLabelLength ? text : text[..MaxLabelLength];
}

/// <summary>
/// Loueur de la borne (open core L7) : société de l'organisation synchronisée, à défaut la config de
/// l'instance (<c>Contact</c> d'appsettings). Nommé dans la notice et contact de repli du questionnaire.
/// </summary>
public sealed record QuestionnaireProvider(string? Name, string? ContactEmail);

public class QuestionConfig
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("label")]
    public string Label { get; set; } = "";

    /// <summary>text | email | tel | select | multi | checkbox</summary>
    [JsonProperty("type")]
    public string Type { get; set; } = QuestionTypes.Text;

    [JsonProperty("required")]
    public bool Required { get; set; }

    [JsonProperty("options")]
    public List<string> Options { get; set; } = new();
}

public static class QuestionTypes
{
    public const string Text     = "text";
    public const string Email    = "email";
    public const string Tel      = "tel";
    public const string Select   = "select";
    public const string Multi    = "multi";
    public const string Checkbox = "checkbox";

    public static bool IsKnown(string type)
        => type is Text or Email or Tel or Select or Multi or Checkbox;

    public static bool IsChoice(string type) => type is Select or Multi;

    public static bool IsTextInput(string type) => type is Text or Email or Tel;
}

public class ControllerConfig
{
    [JsonProperty("name")]
    public string Name { get; set; } = "";

    [JsonProperty("contact_email")]
    public string ContactEmail { get; set; } = "";
}

public class MarketingConsentConfig
{
    [JsonProperty("enabled")]
    public bool Enabled { get; set; } = true;

    [JsonProperty("label")]
    public string Label { get; set; } = QuestionnaireConfig.DefaultMarketingLabel;
}

/// <summary>
/// Lecture tolérante du questionnaire : une valeur illisible donne null (questionnaire désactivé)
/// et une question illisible est ignorée, sans jamais faire échouer la lecture de la config kiosk.
/// </summary>
public sealed class QuestionnaireConfigConverter : JsonConverter<QuestionnaireConfig?>
{
    public override bool CanWrite => false;

    public override QuestionnaireConfig? ReadJson(JsonReader reader, Type objectType,
        QuestionnaireConfig? existingValue, bool hasExistingValue, JsonSerializer serializer)
    {
        JToken token;
        try { token = JToken.Load(reader); }
        catch { return null; }
        return Parse(token);
    }

    public override void WriteJson(JsonWriter writer, QuestionnaireConfig? value, JsonSerializer serializer)
        => throw new NotSupportedException();

    public static QuestionnaireConfig? Parse(JToken? token)
    {
        if (token is not JObject obj) return null;
        try
        {
            var questions = obj["questions"];
            var withoutQuestions = (JObject)obj.DeepClone();
            withoutQuestions.Remove("questions");

            var config = withoutQuestions.ToObject<QuestionnaireConfig>() ?? new QuestionnaireConfig();
            // Valeurs null explicites dans le JSON : on retombe sur un texte vide (ou le défaut à l'affichage).
            config.HomeNotice   ??= "";
            config.Title        ??= "";
            config.Intro        ??= "";
            config.CancelLabel  ??= "";
            config.SkipLabel    ??= "";
            config.Notice       ??= "";
            config.Controller       ??= new ControllerConfig();
            config.Controller.Name         ??= "";
            config.Controller.ContactEmail ??= "";
            config.MarketingConsent ??= new MarketingConsentConfig();
            config.MarketingConsent.Label  ??= "";
            config.Questions = new List<QuestionConfig>();
            if (questions is JArray items)
            {
                foreach (var item in items)
                {
                    try
                    {
                        if (item is JObject && item.ToObject<QuestionConfig>() is { } question)
                        {
                            question.Options ??= new List<string>();
                            config.Questions.Add(question);
                        }
                    }
                    catch { /* question illisible : ignorée */ }
                }
            }
            return config;
        }
        catch { return null; }
    }
}
