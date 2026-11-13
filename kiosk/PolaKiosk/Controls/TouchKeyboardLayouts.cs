namespace PolaKiosk.Controls;

/// <summary>
/// <see cref="EmailKeysOnly"/> : touches e-mail sans validation ni domaines proposés, pour un écran
/// qui affiche lui-même son bouton « Envoyer » et ses raccourcis (écran résultat, LAB-252).
/// <see cref="Url"/> : adresse web (écran « Adresse de votre SaaS », open core K2).
/// </summary>
public enum TouchKeyboardLayout { Text, Email, Phone, EmailKeysOnly, Url }

internal enum TouchKeyAction { Insert, Domain, Shift, Backspace, Enter }

/// <summary>Touche du clavier tactile. <see cref="Width"/> est en unités de touche (1 = touche standard).</summary>
internal sealed record TouchKey(TouchKeyAction Action, string Value, string? Label = null, double Width = 1)
{
    public string Caption => Label ?? Value;
}

/// <summary>Dispositions du clavier tactile intégré (AZERTY).</summary>
internal static class TouchKeyboardLayouts
{
    // Une unité = 72 px dont 3 px de marge de chaque côté : touche visible de 66 px (≥ 64 px).
    internal const double KeyUnit = 72;
    internal const double KeyMargin = 3;

    internal const int DomainSuggestionCount = 4;
    internal const double DomainKeyWidth = 2.5;

    private static readonly IReadOnlyList<IReadOnlyList<TouchKey>> TextRows =
    [
        Chars("1234567890"),
        Chars("azertyuiop"),
        Chars("qsdfghjklm"),
        [Shift(1.5), .. Chars("wxcvbn'"), Backspace(1.5)],
        Chars("éèêëàâçùîïô"),
        [Char(","), Char("-"), new TouchKey(TouchKeyAction.Insert, " ", "espace", 5), Char("."), Enter(2.5)],
    ];

    private static readonly IReadOnlyList<IReadOnlyList<TouchKey>> EmailRows =
    [
        Chars("1234567890"),
        Chars("azertyuiop"),
        Chars("qsdfghjklm"),
        [.. Chars("wxcvbn-_."), Backspace(1.5)],
        [Char("@", 1.5), Char(".com", 2), Char(".fr", 2), Enter(4)],
    ];

    private static readonly IReadOnlyList<IReadOnlyList<TouchKey>> EmailKeysOnlyRows =
    [
        Chars("1234567890"),
        Chars("azertyuiop"),
        Chars("qsdfghjklm"),
        [.. Chars("wxcvbn@._-"), Backspace(1.6)],
    ];

    private static readonly IReadOnlyList<IReadOnlyList<TouchKey>> UrlRows =
    [
        Chars("1234567890"),
        Chars("azertyuiop"),
        Chars("qsdfghjklm"),
        [.. Chars("wxcvbn-./:"), Backspace(1.6)],
        [Char(".fr", 2), Char(".com", 2), Char("https://", 2.5), Enter(4)],
    ];

    private static readonly IReadOnlyList<IReadOnlyList<TouchKey>> PhoneRows =
    [
        Chars("123", 1.5),
        Chars("456", 1.5),
        Chars("789", 1.5),
        [Char("+", 1.5), Char("0", 1.5), Backspace(1.5)],
        [Enter(4.5)],
    ];

    public static IReadOnlyList<IReadOnlyList<TouchKey>> Rows(TouchKeyboardLayout layout) => layout switch
    {
        TouchKeyboardLayout.Email => EmailRows,
        TouchKeyboardLayout.EmailKeysOnly => EmailKeysOnlyRows,
        TouchKeyboardLayout.Phone => PhoneRows,
        TouchKeyboardLayout.Url => UrlRows,
        _ => TextRows,
    };

    /// <summary>Seule la disposition e-mail propose des domaines (ligne au-dessus des touches).</summary>
    public static bool HasDomainSuggestions(TouchKeyboardLayout layout) => layout == TouchKeyboardLayout.Email;

    public static TouchKey Domain(string domain) =>
        new(TouchKeyAction.Domain, domain, "@" + domain, DomainKeyWidth);

    private static TouchKey Char(string value, double width = 1) => new(TouchKeyAction.Insert, value, null, width);

    private static TouchKey[] Chars(string chars, double width = 1) =>
        chars.Select(c => Char(c.ToString(), width)).ToArray();

    private static TouchKey Shift(double width) => new(TouchKeyAction.Shift, "", "⇧", width);

    private static TouchKey Backspace(double width) => new(TouchKeyAction.Backspace, "", "⌫", width);

    private static TouchKey Enter(double width) => new(TouchKeyAction.Enter, "", null, width);
}
