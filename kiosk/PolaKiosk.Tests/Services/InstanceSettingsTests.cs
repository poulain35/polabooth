using System.IO;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.Services;

/// <summary>Réglages de l'instance (open core L7) : fichier privé, ordre de chargement, replis.</summary>
public sealed class InstanceSettingsTests : IDisposable
{
    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    private void Write(string name, string json) => File.WriteAllText(Path.Combine(_dir.Path, name), json);

    private AppSettings Load(bool withInstance)
    {
        var config = new ConfigurationBuilder().SetBasePath(_dir.Path)
            .AddJsonFile("appsettings.json", optional: false)
            .AddJsonFile("appsettings.Development.json", optional: true);
        if (withInstance) InstanceSettings.Add(config);
        return config.Build().Get<AppSettings>()!;
    }

    [Fact]
    public void The_instance_file_sits_between_the_base_and_the_environment_files()
    {
        Write("appsettings.json", """{"Kiosk":{"SaasUrl":"","PairingUrl":""},"Contact":{"CompanyName":""}}""");
        Write("appsettings.Development.json", """{"Kiosk":{"PairingUrl":"http://localhost:5173/associer"}}""");
        Write(InstanceSettings.FileName,
            """{"Kiosk":{"SaasUrl":"https://app.studio.fr","PairingUrl":"https://app.studio.fr/associer"},"Contact":{"CompanyName":"Studio","Email":"contact@studio.fr"}}""");

        var settings = Load(withInstance: true);

        settings.Kiosk.SaasUrl.Should().Be("https://app.studio.fr");
        settings.Contact.CompanyName.Should().Be("Studio");
        settings.Contact.Email.Should().Be("contact@studio.fr");
        settings.Kiosk.PairingUrl.Should().Be("http://localhost:5173/associer", "le réglage de développement garde la main");
    }

    [Fact]
    public void Without_instance_file_the_open_settings_stay_neutral()
    {
        Write("appsettings.json", """{"Kiosk":{"SaasUrl":"","PairingUrl":""},"Contact":{"CompanyName":""}}""");

        var settings = Load(withInstance: true);

        settings.Kiosk.SaasUrl.Should().BeEmpty();
        settings.Contact.CompanyName.Should().BeEmpty();
    }

    [Fact]
    public void The_shipped_settings_carry_no_brand_outside_the_instance_file()
    {
        var root = Path.Combine(AppContext.BaseDirectory);
        var open = Load(File.ReadAllText(Path.Combine(root, "appsettings.json")));

        open.Kiosk.SaasUrl.Should().BeEmpty();
        open.Kiosk.PairingUrl.Should().BeEmpty();
        open.Contact.CompanyName.Should().BeEmpty();
        // Le fichier de l'instance n'est copié que s'il existe dans les sources : absent du dépôt
        // public (export open core), présent dans celui d'un loueur.
        var source = FindSourceInstanceFile();
        File.Exists(Path.Combine(root, InstanceSettings.FileName)).Should().Be(source is not null,
            "le fichier de l'instance est copié avec l'application quand il existe dans les sources");

        static AppSettings Load(string json) => new ConfigurationBuilder()
            .AddJsonStream(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(json))).Build().Get<AppSettings>()!;
    }

    /// <summary>appsettings.Instance.json du projet PolaKiosk (remonte depuis le dossier de sortie), ou null.</summary>
    private static string? FindSourceInstanceFile()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var project = Path.Combine(dir.FullName, "PolaKiosk", "PolaKiosk.csproj");
            if (File.Exists(project))
            {
                var file = Path.Combine(dir.FullName, "PolaKiosk", InstanceSettings.FileName);
                return File.Exists(file) ? file : null;
            }
        }
        return null;
    }

    [Theory]
    [InlineData("https://a.fr/associer", "https://b.fr", "https://a.fr/associer")]
    [InlineData("", "https://b.fr/", "https://b.fr/associer")]
    [InlineData("  ", " https://b.fr ", "https://b.fr/associer")]
    [InlineData("", "", "")]
    public void The_pairing_page_falls_back_to_the_saas(string pairingUrl, string saasUrl, string expected)
    {
        new KioskSettings { PairingUrl = pairingUrl, SaasUrl = saasUrl }.ResolvePairingUrl().Should().Be(expected);
    }

    [Theory]
    [InlineData("Studio Lumière", "bonjour@studio.fr", "Studio Lumière", "bonjour@studio.fr")]
    [InlineData(null, null, "Instance", "contact@instance.fr")]
    [InlineData("  ", " ", "Instance", "contact@instance.fr")]
    public void The_questionnaire_provider_is_the_company_then_the_instance(
        string? company, string? email, string expectedName, string expectedEmail)
    {
        var state = new Mock<IKioskStateService>();
        state.SetupGet(s => s.ContactCompany).Returns(company);
        state.SetupGet(s => s.ContactEmail).Returns(email);
        var settings = new AppSettings { Contact = { CompanyName = "Instance", Email = "contact@instance.fr" } };

        LiveViewModel.QuestionnaireProviderFor(state.Object, settings)
            .Should().Be(new PolaKiosk.Models.Supabase.QuestionnaireProvider(expectedName, expectedEmail));
    }
}
