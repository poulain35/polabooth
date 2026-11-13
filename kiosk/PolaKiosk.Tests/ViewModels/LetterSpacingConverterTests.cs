using System.Globalization;
using FluentAssertions;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Surtitres espacés de l'accueil (LAB-251) : une espace fine entre chaque caractère.</summary>
public class LetterSpacingConverterTests
{
    [Fact]
    public void Puts_a_thin_space_between_each_character()
        => LetterSpacingConverter.Spaced("DE à").Should().Be("D E   à");

    [Fact]
    public void Keeps_characters_outside_the_basic_plane_whole()
        => LetterSpacingConverter.Spaced("A😀").Should().Be("A 😀");

    [Fact]
    public void Returns_an_empty_text_for_a_missing_value()
        => new LetterSpacingConverter().Convert(null, typeof(string), null, CultureInfo.InvariantCulture)
            .Should().Be("");
}
