using FluentAssertions;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.Supabase;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.Services;

public class QuestionnaireConfigTests
{
    private static KioskConfig? ParseKiosk(string json) => JObject.Parse(json).ToObject<KioskConfig>();

    [Fact]
    public void Missing_questionnaire_is_null()
        => ParseKiosk("{}")!.Questionnaire.Should().BeNull();

    [Theory]
    [InlineData("\"oui\"")]
    [InlineData("42")]
    [InlineData("[1, 2]")]
    [InlineData("{\"enabled\": \"peut-être\", \"questions\": []}")]
    public void Unreadable_questionnaire_never_breaks_the_kiosk_config(string questionnaire)
    {
        var cfg = ParseKiosk("{\"capture\":{\"countdown_seconds\":3},\"questionnaire\":" + questionnaire + "}");

        cfg!.Capture.CountdownSeconds.Should().Be(3);
        (cfg.Questionnaire?.IsActive ?? false).Should().BeFalse();
    }

    [Fact]
    public void Enabled_without_usable_question_is_not_active()
    {
        var cfg = ParseKiosk("""
            {"questionnaire":{"enabled":true,"questions":[
              {"id":"","label":"Sans id","type":"text"},
              {"id":"a","label":"Type inconnu","type":"date"},
              {"id":"b","label":"Choix sans option","type":"select","options":[]},
              "pas un objet",
              {"id":"c","label":"Illisible","type":"text","required":"jamais"}
            ]}}
            """)!.Questionnaire!;

        cfg.UsableQuestions().Should().BeEmpty();
        cfg.IsActive.Should().BeFalse();
    }

    [Fact]
    public void Defaults_to_required_mode()
    {
        var cfg = ParseKiosk("""{"questionnaire":{"enabled":true,"questions":[{"id":"e","label":"E-mail","type":"email"}]}}""")!.Questionnaire!;

        cfg.IsActive.Should().BeTrue();
        cfg.RequiredForPhoto.Should().BeTrue();
        cfg.MarketingConsent.Enabled.Should().BeTrue();
    }

    [Fact]
    public void Usable_questions_apply_the_spec_limits()
    {
        var questions = Enumerable.Range(1, 10)
            .Select(i => new QuestionConfig { Id = $"q{i}", Label = $"Q{i}", Type = "TEXT" })
            .ToList();
        questions.Insert(0, new QuestionConfig
        {
            Id = "choice", Label = new string('x', 200), Type = "multi",
            Options = Enumerable.Range(1, 20).Select(i => $"o{i}").Prepend("o1").ToList(),
        });
        questions.Insert(1, new QuestionConfig { Id = "choice", Label = "Doublon", Type = "text" });
        questions.Insert(2, new QuestionConfig { Id = "ok", Label = "Case", Type = "checkbox", Required = true });

        var usable = new QuestionnaireConfig { Enabled = true, Questions = questions }.UsableQuestions();

        usable.Should().HaveCount(QuestionnaireConfig.MaxQuestions);
        usable[0].Label.Should().HaveLength(QuestionnaireConfig.MaxLabelLength);
        usable[0].Options.Should().HaveCount(QuestionnaireConfig.MaxOptions).And.OnlyHaveUniqueItems();
        usable.Select(q => q.Id).Should().OnlyHaveUniqueItems();
        usable[0].Label.Should().NotBe("Doublon");
        usable[1].Id.Should().Be("ok");
        usable[1].Required.Should().BeFalse(); // case à cocher jamais obligatoire
        usable[2].Type.Should().Be("text"); // type normalisé
    }

    [Fact]
    public void Placeholders_fall_back_to_the_provider_contact()
    {
        var cfg = new QuestionnaireConfig { Controller = new ControllerConfig { Name = "Camille & Hugo" } };
        var provider = new QuestionnaireProvider("Studio Lumière", "contact@studio.fr");

        cfg.ResolvePlaceholders("{controller_name} — {controller_contact}", provider)
           .Should().Be("Camille & Hugo — contact@studio.fr");
        cfg.ResolvePlaceholders("{controller_contact}", provider with { ContactEmail = " " })
           .Should().Be("Studio Lumière", "sans email, le nom du loueur");
        cfg.ResolvePlaceholders("{controller_contact}").Should().Be(QuestionnaireConfig.DefaultProviderName);
        new QuestionnaireConfig().ResolvePlaceholders("{controller_name}").Should().Be("l'organisateur");
    }

    [Fact]
    public void The_controller_email_comes_before_the_provider()
    {
        var cfg = new QuestionnaireConfig { Controller = new ControllerConfig { Name = "CE Actemium", ContactEmail = " rh@client.fr " } };

        cfg.ResolvePlaceholders("{controller_contact}", new QuestionnaireProvider("Studio", "contact@studio.fr"))
           .Should().Be("rh@client.fr");
    }

    [Theory]
    [InlineData("Studio Lumière", "Studio Lumière traite. Studio Lumière")]
    [InlineData(null, "Le prestataire traite. le prestataire")]
    [InlineData("  ", "Le prestataire traite. le prestataire")]
    public void The_provider_name_fills_the_notice(string? name, string expected)
    {
        new QuestionnaireConfig()
            .ResolvePlaceholders("{Provider_name} traite. {provider_name}", new QuestionnaireProvider(name, null))
            .Should().Be(expected);
    }
}
