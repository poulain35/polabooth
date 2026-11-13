using FluentAssertions;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class GuestAnswerValidatorTests
{
    private static QuestionConfig Q(string type, bool required = true, params string[] options)
        => new() { Id = "q", Label = "Question", Type = type, Required = required, Options = options.ToList() };

    private static GuestAnswerCheck Text(string type, string? text, bool required = true)
        => GuestAnswerValidator.Check(Q(type, required), new GuestAnswerInput(Text: text));

    [Theory]
    [InlineData("jean@gmail.com", "jean@gmail.com")]
    [InlineData("  Jean.Dupont@Orange.FR ", "jean.dupont@orange.fr")]
    public void Valid_email_is_trimmed_and_lowercased(string input, string expected)
    {
        var check = Text(QuestionTypes.Email, input);

        check.CanContinue.Should().BeTrue();
        check.Error.Should().BeNull();
        check.Value.Should().Be(expected);
    }

    [Theory]
    [InlineData("jean@gmail")]
    [InlineData("jean")]
    [InlineData("jean@@gmail.com")]
    [InlineData("je an@gmail.com")]
    public void Incomplete_email_blocks_next(string input)
    {
        var check = Text(QuestionTypes.Email, input);

        check.CanContinue.Should().BeFalse();
        check.Error.Should().Be(GuestAnswerValidator.EmailError);
        check.Value.Should().BeNull();
    }

    [Fact]
    public void Email_domain_typo_is_suggested_without_blocking()
    {
        var check = Text(QuestionTypes.Email, "jean@gmial.com");

        check.CanContinue.Should().BeTrue();
        check.Suggestion.Should().Be("gmail.com");
        check.Value.Should().Be("jean@gmial.com"); // jamais corrigé d'office
        GuestAnswerValidator.ApplyDomain("jean@gmial.com", "gmail.com").Should().Be("jean@gmail.com");
    }

    [Theory]
    [InlineData("06 12 34 56 78", "+33612345678")]
    [InlineData("06.12.34.56.78", "+33612345678")]
    [InlineData("06-12-34-56-78", "+33612345678")]
    [InlineData("+33 6 12 34 56 78", "+33612345678")]
    [InlineData("+44 20 7946 0958", "+442079460958")]
    public void Phone_is_normalized_to_e164(string input, string expected)
    {
        var check = Text(QuestionTypes.Tel, input);

        check.CanContinue.Should().BeTrue();
        check.Value.Should().Be(expected);
    }

    [Theory]
    [InlineData("+33 06 12 34 56 78")] // 0 après l'indicatif
    [InlineData("06 12 34 56")]
    [InlineData("12345")]
    [InlineData("06 12 34 56 7a")]
    public void Invalid_phone_blocks_next(string input)
    {
        var check = Text(QuestionTypes.Tel, input);

        check.CanContinue.Should().BeFalse();
        check.Error.Should().Be(GuestAnswerValidator.PhoneError);
    }

    [Theory]
    [InlineData(QuestionTypes.Text)]
    [InlineData(QuestionTypes.Email)]
    [InlineData(QuestionTypes.Tel)]
    public void Empty_answer_blocks_only_a_required_question(string type)
    {
        Text(type, "   ", required: true).CanContinue.Should().BeFalse();
        Text(type, null, required: true).Error.Should().BeNull(); // pas d'erreur tant que rien n'est saisi

        var optional = Text(type, "", required: false);
        optional.CanContinue.Should().BeTrue();
        optional.Value.Should().BeNull();
    }

    [Fact]
    public void Invalid_answer_blocks_even_an_optional_question()
        => Text(QuestionTypes.Email, "jean@gmail", required: false).CanContinue.Should().BeFalse();

    [Fact]
    public void Text_longer_than_500_characters_is_refused()
    {
        Text(QuestionTypes.Text, new string('a', 500)).CanContinue.Should().BeTrue();

        var check = Text(QuestionTypes.Text, new string('a', 501));
        check.CanContinue.Should().BeFalse();
        check.Error.Should().Be(GuestAnswerValidator.TextTooLongError);
    }

    [Fact]
    public void Select_keeps_a_single_known_option()
    {
        var q = Q(QuestionTypes.Select, true, "Oui", "Non");

        GuestAnswerValidator.Check(q, new GuestAnswerInput(Selected: ["Non"])).Value.Should().Be("Non");
        GuestAnswerValidator.Check(q, new GuestAnswerInput(Selected: ["Peut-être"])).CanContinue.Should().BeFalse();
        GuestAnswerValidator.Check(q, new GuestAnswerInput(Selected: [])).CanContinue.Should().BeFalse();
    }

    [Fact]
    public void Multi_keeps_the_config_order()
    {
        var q = Q(QuestionTypes.Multi, true, "A", "B", "C");

        var check = GuestAnswerValidator.Check(q, new GuestAnswerInput(Selected: ["C", "A"]));

        check.CanContinue.Should().BeTrue();
        check.Value.Should().BeEquivalentTo(new[] { "A", "C" }, o => o.WithStrictOrdering());
    }

    [Fact]
    public void Checkbox_is_never_required()
    {
        var q = Q(QuestionTypes.Checkbox, required: true);

        var check = GuestAnswerValidator.Check(q, new GuestAnswerInput(Checked: false));

        check.CanContinue.Should().BeTrue();
        check.Value.Should().Be(false);
    }
}
