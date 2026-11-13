using FluentAssertions;
using PolaKiosk.Controls;

namespace PolaKiosk.Tests.Controls;

// LAB-218 : dispositions du clavier tactile et domaines e-mail proposés.
public class TouchKeyboardLayoutsTests
{
    private static List<TouchKey> Keys(TouchKeyboardLayout layout) =>
        TouchKeyboardLayouts.Rows(layout).SelectMany(row => row).ToList();

    private static List<string> Inserted(TouchKeyboardLayout layout) =>
        Keys(layout).Where(k => k.Action == TouchKeyAction.Insert).Select(k => k.Value).ToList();

    [Fact]
    public void Keys_are_at_least_64_px()
    {
        (TouchKeyboardLayouts.KeyUnit - 2 * TouchKeyboardLayouts.KeyMargin).Should().BeGreaterThanOrEqualTo(64);

        foreach (var layout in Enum.GetValues<TouchKeyboardLayout>())
            Keys(layout).Should().OnlyContain(k => k.Width >= 1, $"disposition {layout}");
        TouchKeyboardLayouts.DomainKeyWidth.Should().BeGreaterThanOrEqualTo(1);
    }

    [Theory]
    [InlineData(TouchKeyboardLayout.Text)]
    [InlineData(TouchKeyboardLayout.Email)]
    [InlineData(TouchKeyboardLayout.Phone)]
    [InlineData(TouchKeyboardLayout.Url)]
    public void Every_layout_can_erase_and_validate(TouchKeyboardLayout layout)
    {
        Keys(layout).Should().ContainSingle(k => k.Action == TouchKeyAction.Backspace);
        Keys(layout).Should().ContainSingle(k => k.Action == TouchKeyAction.Enter);
    }

    [Fact]
    public void Text_layout_is_azerty_with_french_accents_space_and_shift()
    {
        var rows = TouchKeyboardLayouts.Rows(TouchKeyboardLayout.Text);
        string.Concat(rows[1].Select(k => k.Value)).Should().Be("azertyuiop");
        string.Concat(rows[2].Select(k => k.Value)).Should().Be("qsdfghjklm");

        var inserted = Inserted(TouchKeyboardLayout.Text);
        inserted.Should().Contain([.. "abcdefghijklmnopqrstuvwxyz".Select(c => c.ToString())]);
        inserted.Should().Contain(["é", "è", "ê", "à", "ç", "ù", "ï", " ", "'", "-"]);
        Keys(TouchKeyboardLayout.Text).Should().ContainSingle(k => k.Action == TouchKeyAction.Shift);
    }

    [Fact]
    public void Email_layout_has_email_symbols_and_shortcuts_without_space_or_shift()
    {
        var inserted = Inserted(TouchKeyboardLayout.Email);

        inserted.Should().Contain(["@", ".", "-", "_", ".com", ".fr"]);
        inserted.Should().Contain([.. "abcdefghijklmnopqrstuvwxyz0123456789".Select(c => c.ToString())]);
        inserted.Should().NotContain(" ");
        Keys(TouchKeyboardLayout.Email).Should().NotContain(k => k.Action == TouchKeyAction.Shift);
        TouchKeyboardLayouts.HasDomainSuggestions(TouchKeyboardLayout.Email).Should().BeTrue();
    }

    // LAB-252 : écran e-mail de la borne, les domaines et « Envoyer » sont portés par l'écran lui-même.
    [Fact]
    public void Email_keys_only_layout_has_four_rows_with_symbols_but_no_enter_nor_suggestions()
    {
        var rows = TouchKeyboardLayouts.Rows(TouchKeyboardLayout.EmailKeysOnly);
        rows.Should().HaveCount(4);
        string.Concat(rows[0].Select(k => k.Value)).Should().Be("1234567890");
        string.Concat(rows[1].Select(k => k.Value)).Should().Be("azertyuiop");

        var inserted = Inserted(TouchKeyboardLayout.EmailKeysOnly);
        inserted.Should().Contain([.. "abcdefghijklmnopqrstuvwxyz0123456789@._-".Select(c => c.ToString())]);
        inserted.Should().NotContain(" ");
        Keys(TouchKeyboardLayout.EmailKeysOnly).Should().ContainSingle(k => k.Action == TouchKeyAction.Backspace);
        Keys(TouchKeyboardLayout.EmailKeysOnly).Should().NotContain(k =>
            k.Action == TouchKeyAction.Enter || k.Action == TouchKeyAction.Shift || k.Action == TouchKeyAction.Domain);
        TouchKeyboardLayouts.HasDomainSuggestions(TouchKeyboardLayout.EmailKeysOnly).Should().BeFalse();
    }

    // Open core K2 : adresse du SaaS (« photobooth.mon-entreprise.fr »).
    [Fact]
    public void Url_layout_has_web_address_symbols_without_space_shift_or_suggestions()
    {
        var inserted = Inserted(TouchKeyboardLayout.Url);

        inserted.Should().Contain([.. "abcdefghijklmnopqrstuvwxyz0123456789-./:".Select(c => c.ToString())]);
        inserted.Should().Contain([".fr", ".com", "https://"]);
        inserted.Should().NotContain([" ", "@"]);
        Keys(TouchKeyboardLayout.Url).Should().NotContain(k => k.Action == TouchKeyAction.Shift);
        TouchKeyboardLayouts.HasDomainSuggestions(TouchKeyboardLayout.Url).Should().BeFalse();
    }

    [Fact]
    public void Phone_layout_is_a_numeric_pad_with_plus()
    {
        Inserted(TouchKeyboardLayout.Phone).Should()
            .BeEquivalentTo(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "+"]);
        TouchKeyboardLayouts.HasDomainSuggestions(TouchKeyboardLayout.Phone).Should().BeFalse();
    }

    [Fact]
    public void Domain_keys_show_the_at_sign()
    {
        TouchKeyboardLayouts.Domain("gmail.com").Caption.Should().Be("@gmail.com");
    }

    [Fact]
    public void Common_domains_are_suggested_before_the_at_sign()
    {
        EmailDomainSuggestions.Suggest("jean", 4).Should()
            .Equal("gmail.com", "hotmail.fr", "orange.fr", "outlook.fr");
        EmailDomainSuggestions.Suggest("", 3).Should().Equal("gmail.com", "hotmail.fr", "orange.fr");
        EmailDomainSuggestions.Suggest("jean@", 2).Should().Equal("gmail.com", "hotmail.fr");
    }

    [Fact]
    public void Suggestions_follow_the_typed_domain_ignoring_case()
    {
        EmailDomainSuggestions.Suggest("jean@hot", 4).Should().Equal("hotmail.fr", "hotmail.com");
        EmailDomainSuggestions.Suggest("jean@OUT", 4).Should().Equal("outlook.fr", "outlook.com");
    }

    [Fact]
    public void No_suggestion_once_the_domain_is_complete_or_unknown()
    {
        EmailDomainSuggestions.Suggest("jean@gmail.com", 4).Should().BeEmpty();
        EmailDomainSuggestions.Suggest("jean@entreprise.bzh", 4).Should().BeEmpty();
        EmailDomainSuggestions.Suggest("jean@a@b", 4).Should().BeEmpty();
    }
}
