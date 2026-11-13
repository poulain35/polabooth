using System.Net.Mail;
using System.Text.RegularExpressions;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

/// <summary>Saisie brute d'un invité pour une question (texte, options choisies ou case).</summary>
public sealed record GuestAnswerInput(string? Text = null, IReadOnlyCollection<string>? Selected = null, bool Checked = false);

/// <summary>
/// Résultat de la vérification d'une réponse : <see cref="CanContinue"/> autorise « Suivant »,
/// <see cref="Error"/> s'affiche sous le champ, <see cref="Value"/> est la valeur normalisée à
/// garder (null si la question est laissée vide), <see cref="Suggestion"/> propose un domaine
/// d'e-mail corrigé (jamais bloquant).
/// </summary>
public sealed record GuestAnswerCheck(bool CanContinue, string? Error, object? Value, string? Suggestion = null)
{
    public static GuestAnswerCheck Empty(bool required) => new(!required, null, null);
}

/// <summary>
/// Règles de saisie du questionnaire de la borne (spec LAB-208, « Validation (kiosk) »).
/// Fonctions pures, sans état.
/// </summary>
public static class GuestAnswerValidator
{
    public const int MaxTextLength = 500;

    public const string EmailError = "Adresse e-mail incomplète";
    public const string PhoneError = "Numéro de téléphone invalide";
    public const string TextTooLongError = "Réponse trop longue (500 caractères maximum)";

    private static readonly Regex EmailPattern  = new(@"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", RegexOptions.CultureInvariant);
    private static readonly Regex FrenchLocal   = new(@"^0[1-9]\d{8}$", RegexOptions.CultureInvariant);
    private static readonly Regex FrenchE164    = new(@"^\+33[1-9]\d{8}$", RegexOptions.CultureInvariant);
    private static readonly Regex International = new(@"^\+[1-9]\d{6,14}$", RegexOptions.CultureInvariant);
    private static readonly Regex PhoneSeparators = new(@"[\s.\-]", RegexOptions.CultureInvariant);

    // Fautes de frappe fréquentes sur les domaines d'e-mail → domaine probable.
    private static readonly Dictionary<string, string> DomainTypos = new(StringComparer.Ordinal)
    {
        ["gmial.com"] = "gmail.com", ["gmal.com"] = "gmail.com", ["gmai.com"] = "gmail.com",
        ["gamil.com"] = "gmail.com", ["gmail.co"] = "gmail.com", ["gmail.con"] = "gmail.com",
        ["gmail.cm"] = "gmail.com", ["gmaill.com"] = "gmail.com", ["gnail.com"] = "gmail.com",
        ["hotmial.com"] = "hotmail.com", ["hotmal.com"] = "hotmail.com", ["hotmail.con"] = "hotmail.com",
        ["hotmial.fr"] = "hotmail.fr", ["hotmal.fr"] = "hotmail.fr",
        ["outlok.com"] = "outlook.com", ["outlook.con"] = "outlook.com", ["outlok.fr"] = "outlook.fr",
        ["yahou.fr"] = "yahoo.fr", ["yaho.fr"] = "yahoo.fr", ["yahoo.con"] = "yahoo.com", ["yaho.com"] = "yahoo.com",
        ["orange.fe"] = "orange.fr", ["ornage.fr"] = "orange.fr", ["orang.fr"] = "orange.fr",
        ["wanadoo.fe"] = "wanadoo.fr", ["wanado.fr"] = "wanadoo.fr",
        ["free.fe"] = "free.fr", ["fre.fr"] = "free.fr",
        ["sfr.fe"] = "sfr.fr", ["laposte.ne"] = "laposte.net", ["laposte.nt"] = "laposte.net",
        ["icloud.con"] = "icloud.com", ["iclou.com"] = "icloud.com",
    };

    /// <summary>Vérifie une réponse selon le type et le caractère obligatoire de la question.</summary>
    public static GuestAnswerCheck Check(QuestionConfig question, GuestAnswerInput input)
    {
        var required = question.Required && question.Type != QuestionTypes.Checkbox;
        switch (question.Type)
        {
            case QuestionTypes.Email:
            {
                var text = input.Text?.Trim() ?? "";
                if (text.Length == 0) return GuestAnswerCheck.Empty(required);
                var email = NormalizeEmail(text);
                var suggestion = SuggestEmailDomain(email ?? text.ToLowerInvariant());
                return email == null
                    ? new GuestAnswerCheck(false, EmailError, null, suggestion)
                    : new GuestAnswerCheck(true, null, email, suggestion);
            }
            case QuestionTypes.Tel:
            {
                var text = input.Text?.Trim() ?? "";
                if (text.Length == 0) return GuestAnswerCheck.Empty(required);
                var phone = NormalizePhone(text);
                return phone == null
                    ? new GuestAnswerCheck(false, PhoneError, null)
                    : new GuestAnswerCheck(true, null, phone);
            }
            case QuestionTypes.Select:
            {
                var chosen = (input.Selected ?? Array.Empty<string>())
                    .Where(o => question.Options.Contains(o)).ToList();
                if (chosen.Count == 0) return GuestAnswerCheck.Empty(required);
                return new GuestAnswerCheck(chosen.Count == 1, null, chosen.Count == 1 ? chosen[0] : null);
            }
            case QuestionTypes.Multi:
            {
                // Ordre de la config, pas l'ordre des appuis : export stable.
                var selected = input.Selected ?? Array.Empty<string>();
                var chosen = question.Options.Where(selected.Contains).ToList();
                if (chosen.Count == 0) return GuestAnswerCheck.Empty(required);
                return new GuestAnswerCheck(true, null, chosen);
            }
            case QuestionTypes.Checkbox:
                // Jamais obligatoire : décochée, la réponse est simplement « non ».
                return new GuestAnswerCheck(true, null, input.Checked);
            default:
            {
                var text = input.Text?.Trim() ?? "";
                if (text.Length == 0) return GuestAnswerCheck.Empty(required);
                return text.Length > MaxTextLength
                    ? new GuestAnswerCheck(false, TextTooLongError, null)
                    : new GuestAnswerCheck(true, null, text);
            }
        }
    }

    /// <summary>E-mail en minuscules, ou null s'il est incomplet ou invalide.</summary>
    public static string? NormalizeEmail(string? input)
    {
        var email = input?.Trim().ToLowerInvariant() ?? "";
        if (email.Length == 0 || email.Length > 254 || !EmailPattern.IsMatch(email)) return null;
        try
        {
            var parsed = new MailAddress(email);
            return parsed.Address == email ? email : null;
        }
        catch (FormatException) { return null; }
    }

    /// <summary>
    /// Téléphone au format E.164 : espaces, points et tirets retirés ; <c>06…</c> devient
    /// <c>+336…</c>. Null si le numéro n'est pas reconnu.
    /// </summary>
    public static string? NormalizePhone(string? input)
    {
        var phone = PhoneSeparators.Replace(input ?? "", "");
        if (FrenchLocal.IsMatch(phone)) return "+33" + phone[1..];
        // Un numéro +33 doit être un numéro français complet (pas de 0 après l'indicatif).
        if (phone.StartsWith("+33", StringComparison.Ordinal))
            return FrenchE164.IsMatch(phone) ? phone : null;
        return International.IsMatch(phone) ? phone : null;
    }

    /// <summary>Domaine probable si celui de l'e-mail est une faute de frappe connue, sinon null.</summary>
    public static string? SuggestEmailDomain(string? email)
    {
        var at = email?.LastIndexOf('@') ?? -1;
        if (at < 0) return null;
        var domain = email![(at + 1)..].Trim().ToLowerInvariant();
        return DomainTypos.TryGetValue(domain, out var fixedDomain) ? fixedDomain : null;
    }

    /// <summary>E-mail avec le domaine remplacé (application de la suggestion).</summary>
    public static string ApplyDomain(string email, string domain)
    {
        var at = email.LastIndexOf('@');
        return at < 0 ? email : email[..(at + 1)] + domain;
    }
}
