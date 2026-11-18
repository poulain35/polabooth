using FluentAssertions;
using Newtonsoft.Json.Linq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// Lecture du plan des écrans composés (LAB-297) sur les cas de test communs au SaaS et à la borne
/// (docs/specs/fixtures/kiosk-screen-layout-cases.json, lu à sa place par un lien du csproj).
/// </summary>
public class ScreenLayoutTests
{
    private static readonly Lazy<JObject> Fixture = new(() =>
        JObject.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "kiosk-screen-layout-cases.json"))));

    private static IEnumerable<JObject> Cases => Fixture.Value["cases"]!.Children<JObject>();

    public static TheoryData<string> CaseNames()
    {
        var data = new TheoryData<string>();
        foreach (var c in Cases) data.Add((string)c["name"]!);
        return data;
    }

    [Fact]
    public void The_shared_cases_file_is_found_and_not_empty()
        => Cases.Should().HaveCountGreaterThanOrEqualTo(9);

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Every_shared_case_gives_the_expected_layout(string name)
    {
        var c = Cases.Single(x => (string)x["name"]! == name);

        var layout = ScreenLayout.Parse(c["layout"]);
        var raw = ScreenLayout.Parse(c["layout"]!.ToString());

        if (c["expected"]!.Type == JTokenType.Null)
        {
            layout.Should().BeNull();
            raw.Should().BeNull();
            return;
        }

        layout.Should().NotBeNull();
        Normalize(layout!.ToJson()).ToString().Should().Be(Normalize(c["expected"]!).ToString());
        Normalize(raw!.ToJson()).ToString().Should().Be(Normalize(c["expected"]!).ToString());
    }

    [Fact]
    public void The_allowed_values_match_the_shared_file()
    {
        // Un plan qui contient toutes les valeurs permises d'un écran ne doit rien écarter.
        foreach (var (kind, allowed) in Fixture.Value["allowed"]!.Children<JProperty>().Select(p => (p.Name, (JObject)p.Value)))
        {
            var plan = new JObject
            {
                ["version"] = 1, ["kind"] = kind, ["size"] = new JObject { ["w"] = 1920, ["h"] = 1080 }, ["background"] = "bg.png",
                ["buttons"] = new JArray(allowed["actions"]!.Select(a => new JObject
                    { ["action"] = a, ["x"] = 0, ["y"] = 0, ["w"] = 10, ["h"] = 10, ["image"] = $"{a}.png" })),
                ["texts"] = new JArray(allowed["variables"]!.Select(v => new JObject
                    { ["variable"] = v, ["x"] = 0, ["y"] = 0, ["w"] = 10, ["h"] = 10 })),
                ["slots"] = new JArray(allowed["slots"]!.Select(s => new JObject
                    { ["slot"] = s, ["x"] = 0, ["y"] = 0, ["w"] = 10, ["h"] = 10 })),
            };

            var layout = ScreenLayout.Parse(plan);

            layout.Should().NotBeNull();
            layout!.Ignored.Should().BeEmpty();
            layout.Buttons.Should().HaveCount(allowed["actions"]!.Count());
            layout.Texts.Should().HaveCount(allowed["variables"]!.Count());
            layout.Slots.Should().HaveCount(allowed["slots"]!.Count());
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("pas du json")]
    [InlineData("{\"version\":")]
    [InlineData("[]")]
    [InlineData("42")]
    [InlineData("null")]
    [InlineData("{\"version\":\"7\",\"kind\":\"home\",\"size\":{\"w\":1920,\"h\":1080},\"background\":\"bg.png\"}")]
    [InlineData("{\"version\":1.5,\"kind\":\"home\",\"size\":{\"w\":1920,\"h\":1080},\"background\":\"bg.png\"}")]
    [InlineData("{\"version\":1,\"kind\":\"home\",\"size\":[1920,1080],\"background\":\"bg.png\"}")]
    [InlineData("{\"version\":1,\"kind\":\"home\",\"size\":{\"w\":1920,\"h\":1080},\"background\":\"  \"}")]
    public void Unreadable_or_refused_plans_give_null_without_throwing(string? json)
    {
        var act = () => ScreenLayout.Parse(json);

        act.Should().NotThrow().Which.Should().BeNull();
    }

    [Fact]
    public void Odd_values_inside_a_valid_plan_never_throw()
    {
        var json = """
        {"version":1,"kind":"result","size":{"w":1920,"h":1080},"background":"bg.png",
         "buttons":[42,"print",null,{"action":"print","x":"10","y":0,"w":10,"h":10,"image":"p.png"},
                    {"action":["qr"],"x":0,"y":0,"w":10,"h":10,"image":"q.png"}],
         "texts":{"variable":"copies"},
         "slots":[{"slot":"photo_preview","x":0,"y":0,"w":10,"h":10,"angle":"x","radius":-4}]}
        """;

        var layout = ScreenLayout.Parse(json);

        layout.Should().NotBeNull();
        layout!.Buttons.Should().BeEmpty();
        layout.Texts.Should().BeEmpty();
        layout.Slots.Should().ContainSingle().Which.Should().Be(new ScreenSlot("photo_preview", 0, 0, 10, 10, 0, 0));
        layout.Ignored.Should().Equal(new ScreenIgnored("button", "print"), new ScreenIgnored("button", ""));
    }

    [Theory]
    [InlineData(null, 400)]
    [InlineData(100.0, 400)]
    [InlineData(449.0, 400)]
    [InlineData(450.0, 400)]   // égalité : le plus léger
    [InlineData(520.0, 500)]
    [InlineData(560.0, 600)]
    [InlineData(700.0, 700)]
    [InlineData(900.0, 700)]
    public void Dm_sans_weights_snap_to_the_nearest_available(double? weight, int expected)
        => ScreenLayout.NearestDmSansWeight(weight).Should().Be(expected);

    // LAB-331 : police d'un texte vivant, comme liveFont (kioskScreenLayout.js).
    [Theory]
    [InlineData("\"Pacifico\"", "400", "\"f.ttf\"", "Pacifico", 400, "f.ttf")]
    [InlineData("\"'Playfair Display'\"", "\"bold\"", "\"f.ttf\"", "Playfair Display", 700, "f.ttf")]
    [InlineData("\"Lobster\"", "\"normal\"", "\"f.otf\"", "Lobster", 400, "f.otf")]
    [InlineData("\"Lobster\"", "\" 300 \"", "\"f.ttf\"", "Lobster", 300, "f.ttf")]
    [InlineData("\"Lobster\"", "349.5", "\"f.ttf\"", "Lobster", 350, "f.ttf")]
    [InlineData("\"Lobster\"", "1200", "\"f.ttf\"", "Lobster", 900, "f.ttf")]
    [InlineData("\"Lobster\"", "\"gras\"", "\"f.ttf\"", "Lobster", 400, "f.ttf")]
    [InlineData("\"Lobster\"", "800", "null", "DM Sans", 700, null)]
    [InlineData("\"Lobster\"", "300", "\"\"", "DM Sans", 400, null)]
    [InlineData("\"FRAUNCES 72pt\"", "400", "\"f.ttf\"", "Fraunces", 600, null)]
    [InlineData("\"dm sans\"", "\"bold\"", "\"f.ttf\"", "DM Sans", 700, null)]
    [InlineData("null", "500", "\"f.ttf\"", "DM Sans", 500, null)]
    public void A_live_text_keeps_its_font_only_with_a_file(string font, string weight, string file,
        string expectedFont, int expectedWeight, string? expectedFile)
    {
        var plan = $$"""
        {"version":1,"kind":"home","size":{"w":1920,"h":1080},"background":"bg.png",
         "texts":[{"variable":"event_name","x":0,"y":0,"w":10,"h":10,"font":{{font}},"weight":{{weight}},"font_file":{{file}}}]}
        """;

        var text = ScreenLayout.Parse(plan)!.Texts.Single();

        (text.Font, text.Weight, text.FontFile).Should().Be((expectedFont, expectedWeight, expectedFile));
    }

    [Fact]
    public void Font_files_are_listed_once()
    {
        var plan = """
        {"version":1,"kind":"result","size":{"w":1920,"h":1080},"background":"bg.png",
         "texts":[{"variable":"copies","x":0,"y":0,"w":10,"h":10,"font":"Pacifico","font_file":"a.ttf"},
                  {"variable":"countdown","x":0,"y":0,"w":10,"h":10,"font":"Pacifico","font_file":"a.ttf"},
                  {"variable":"print_status","x":0,"y":0,"w":10,"h":10,"font":"Lobster","font_file":"b.otf"},
                  {"variable":"share_status","x":0,"y":0,"w":10,"h":10,"font":"fraunces"}]}
        """;

        var layout = ScreenLayout.Parse(plan)!;

        layout.Texts.Should().HaveCount(4);
        layout.FontFileNames().Should().Equal("a.ttf", "b.otf");
        layout.ImageNames().Should().Equal("bg.png");
    }

    [Theory]
    [InlineData("#6E5140", "#6E5140")]
    [InlineData("#806E5140", "#806E5140")]
    [InlineData("red", ScreenLayout.DefaultColor)]
    [InlineData("#12", ScreenLayout.DefaultColor)]
    public void Colors_must_be_hexadecimal(string color, string expected)
    {
        var plan = $$"""
        {"version":1,"kind":"home","size":{"w":1920,"h":1080},"background":"bg.png",
         "texts":[{"variable":"event_name","x":0,"y":0,"w":10,"h":10,"color":"{{color}}"}]}
        """;

        ScreenLayout.Parse(plan)!.Texts.Single().Color.Should().Be(expected);
    }

    [Fact]
    public void The_neutral_background_is_used_only_when_the_home_is_not_personalized()
    {
        var layout = ScreenLayout.Parse(Cases.ElementAt(1)["layout"])!;

        layout.BackgroundFor(personalized: true).Should().Be("screen-home-v3-bg.png");
        layout.BackgroundFor(personalized: false).Should().Be("screen-home-v3-bg-neutral.png");

        var withoutNeutral = ScreenLayout.Parse(Cases.First()["layout"])!;
        withoutNeutral.BackgroundFor(personalized: false).Should().Be("screen-result-v7-bg.png");
    }

    [Fact]
    public void Image_names_list_backgrounds_and_buttons_once()
    {
        var layout = ScreenLayout.Parse(Cases.ElementAt(1)["layout"])!;

        layout.ImageNames().Should().Equal(
            "screen-home-v3-bg.png", "screen-home-v3-bg-neutral.png",
            "screen-home-v3-btn-start.png", "screen-home-v3-btn-gallery.png");
    }

    /// <summary>Nombres ramenés en double : 7 et 7.0 sont égaux (JToken distingue Integer et Float).</summary>
    private static JToken Normalize(JToken token) => token switch
    {
        JObject o => new JObject(o.Properties().OrderBy(p => p.Name, StringComparer.Ordinal)
                         .Select(p => new JProperty(p.Name, Normalize(p.Value)))),
        JArray a => new JArray(a.Select(Normalize)),
        JValue { Type: JTokenType.Integer or JTokenType.Float } v => new JValue(v.Value<double>()),
        _ => token.DeepClone(),
    };
}
