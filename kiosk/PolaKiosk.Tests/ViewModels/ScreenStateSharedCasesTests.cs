using System.Globalization;
using System.Runtime.ExceptionServices;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using FluentAssertions;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>
/// Valeurs et états des écrans de la borne sur les cas de test communs au SaaS et à la borne
/// (docs/specs/fixtures/kiosk-screen-state-cases.json, LAB-306) : l'aperçu du SaaS
/// (saas/src/lib/kioskScreenState.js) et la borne doivent donner les mêmes réponses.
/// </summary>
public class ScreenStateSharedCasesTests
{
    private static readonly Lazy<JObject> Fixture = new(() => SharedCases.Load("kiosk-screen-state-cases.json"));

    private static JArray Section(string name) => (JArray)Fixture.Value[name]!;

    private static TheoryData<int> Indexes(string section)
    {
        var data = new TheoryData<int>();
        for (int i = 0; i < Section(section).Count; i++) data.Add(i);
        return data;
    }

    private static JObject Case(string section, int index) => (JObject)Section(section)[index];

    private static string State(ScreenActionState state) => state switch
    {
        ScreenActionState.Active   => "active",
        ScreenActionState.Disabled => "disabled",
        ScreenActionState.Hidden   => "hidden",
        _ => throw new ArgumentOutOfRangeException(nameof(state)),
    };

    private static Dictionary<string, string> Strings(JToken obj)
        => ((JObject)obj).Properties().ToDictionary(p => p.Name, p => (string)p.Value!, StringComparer.Ordinal);

    [Fact]
    public void The_shared_cases_file_is_found_and_every_section_is_filled()
    {
        foreach (var section in new[] { "share", "print_status", "remaining_text", "event_dates", "display_name",
                     "home_actions", "display_text", "text_visible" })
            Section(section).Should().NotBeEmpty(section);
    }

    // ── Partage (ShareScreenState) ──

    public static TheoryData<string> ShareCases()
    {
        var data = new TheoryData<string>();
        foreach (var c in Section("share")) data.Add((string)c["name"]!);
        return data;
    }

    private static ShareScreenInputs Inputs(JObject i) => new(
        ShowPrintBlock:      (bool)i["ShowPrintBlock"]!,
        CanPrint:            (bool)i["CanPrint"]!,
        IsPrinting:          (bool)i["IsPrinting"]!,
        Copies:              (int)i["Copies"]!,
        MaxCopies:           (int)i["MaxCopies"]!,
        ShowEmailTile:       (bool)i["ShowEmailTile"]!,
        ShowQrTile:          (bool)i["ShowQrTile"]!,
        IsShareReady:        (bool)i["IsShareReady"]!,
        ShowRetake:          (bool)i["ShowRetake"]!,
        ShowFinish:          (bool)i["ShowFinish"]!,
        ShowRemainingPrints: (bool)i["ShowRemainingPrints"]!,
        RemainingPrints:     (int?)i["RemainingPrints"],
        PrintStatus:         (string)i["PrintStatus"]!,
        ShowCountdown:       (bool)i["ShowCountdown"]!,
        SecondsLeft:         (int)i["SecondsLeft"]!,
        ShareStatus:         (string)i["ShareStatus"]!);

    [Theory]
    [MemberData(nameof(ShareCases))]
    public void Every_share_case_gives_the_expected_states_texts_and_banner(string name)
    {
        var c = (JObject)Section("share").Single(x => (string)x["name"]! == name);
        var inputs = Inputs((JObject)c["inputs"]!);

        ShareScreenState.Actions(inputs).ToDictionary(p => p.Key, p => State(p.Value))
            .Should().BeEquivalentTo(Strings(c["actions"]!));
        ShareScreenState.Texts(inputs).ToDictionary(p => p.Key, p => p.Value)
            .Should().BeEquivalentTo(Strings(c["texts"]!));
        ShareScreenState.PrintBanner(layoutShowsPrintStatus: false, inputs).Should().Be((string)c["print_banner"]!);
    }

    public static TheoryData<int> PrintStatusCases() => Indexes("print_status");

    [Theory]
    [MemberData(nameof(PrintStatusCases))]
    public void Every_print_status_case_gives_the_expected_text(int index)
    {
        var c = Case("print_status", index);

        ShareScreenState.PrintStatus((bool)c["isPrinting"]!, (string)c["error"]!, (string)c["notice"]!, (bool)c["canPrint"]!)
            .Should().Be((string)c["expected"]!);
    }

    public static TheoryData<int> RemainingTextCases() => Indexes("remaining_text");

    [Theory]
    [MemberData(nameof(RemainingTextCases))]
    public void Every_remaining_text_case_gives_the_expected_text(int index)
    {
        var c = Case("remaining_text", index);

        ShareScreenState.RemainingText((int?)c["remaining"]).Should().Be((string)c["expected"]!);
    }

    // ── Accueil (EventDateFormatter, HomeScreen, HomeViewModel) ──

    public static TheoryData<int> EventDateCases() => Indexes("event_dates");

    private static DateTimeOffset? Instant(JToken? token)
        => token is null || token.Type == JTokenType.Null
            ? null
            : DateTimeOffset.Parse((string)token!, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

    [Theory]
    [MemberData(nameof(EventDateCases))]
    public void Every_event_date_case_gives_the_expected_long_and_short_dates(int index)
    {
        var c = Case("event_dates", index);
        var start = Instant(c["start"]);
        var end = Instant(c["end"]);

        EventDateFormatter.Format(start, end).Should().Be((string?)c["long"]);
        EventDateFormatter.FormatShort(start).Should().Be((string?)c["short"]);
    }

    public static TheoryData<int> DisplayNameCases() => Indexes("display_name");

    [Theory]
    [MemberData(nameof(DisplayNameCases))]
    public void Every_display_name_case_gives_the_expected_name(int index)
    {
        var c = Case("display_name", index);

        HomeScreen.DisplayName(new HomeConfig { DisplayName = (string?)c["display_name"] }, (string)c["event_name"]!)
            .Should().Be((string)c["expected"]!);
    }

    public static TheoryData<int> HomeActionCases() => Indexes("home_actions");

    [Theory]
    [MemberData(nameof(HomeActionCases))]
    public void Every_home_action_case_gives_the_expected_states(int index)
    {
        var c = Case("home_actions", index);
        var settings = new AppSettings();
        var nav = new Mock<INavigationService>();
        var vm = new HomeViewModel(nav.Object, Mock.Of<IKioskStateService>(), Mock.Of<ISyncService>(),
            Mock.Of<IIdleTimeoutService>(), new SessionPathService(settings), Mock.Of<ICompositeService>(),
            new AdminPinPadViewModel(Mock.Of<IAdminPinService>(), nav.Object, new PinAttemptLimiter()), settings)
        {
            HasPhotos = (bool)c["has_photos"]!,
        };

        vm.HomeActionStates.ToDictionary(p => p.Key, p => State(p.Value))
            .Should().BeEquivalentTo(Strings(c["actions"]!));
    }

    // ── Écrans composés (DesignedScreen) ──

    public static TheoryData<int> DisplayTextCases() => Indexes("display_text");

    private static ScreenText Text(bool uppercase = false, double charSpacing = 0, bool personalizedOnly = false)
        => new("event_name", 0, 0, 1200, 220, 0, "DM Sans", 400, 60, "#000000", "center",
            uppercase, charSpacing, 2, personalizedOnly);

    [Theory]
    [MemberData(nameof(DisplayTextCases))]
    public void Every_display_text_case_gives_the_expected_text(int index)
    {
        var c = Case("display_text", index);

        DesignedScreen.DisplayText((string)c["value"]!, Text((bool)c["uppercase"]!, (double)c["char_spacing"]!))
            .Should().Be((string)c["expected"]!);
    }

    public static TheoryData<int> TextVisibleCases() => Indexes("text_visible");

    [Theory]
    [MemberData(nameof(TextVisibleCases))]
    public void Every_text_visible_case_shows_or_hides_the_live_text(int index) => RunSta(() =>
    {
        var c = Case("text_visible", index);
        bool personalizedOnly = (bool)c["personalized_only"]!;
        var plan = new JObject
        {
            ["version"] = 1, ["kind"] = "home", ["size"] = new JObject { ["w"] = 1920, ["h"] = 1080 },
            ["background"] = "bg.png", ["background_neutral"] = "n.png",
            ["texts"] = new JArray(new JObject
            {
                ["variable"] = "event_name", ["x"] = 360, ["y"] = 420, ["w"] = 1200, ["h"] = 220,
                ["size"] = 60, ["personalized_only"] = personalizedOnly,
            }),
        };
        var layout = ScreenLayout.Parse(plan)!;
        var screen = new DesignedScreen
        {
            ContentModel = ScreenContent.Create(layout, Pixel(), Pixel(), new Dictionary<string, ImageSource>()),
            Personalized = (bool)c["personalized"]!,
        };
        var value = (string?)c["value"];
        // null côté SaaS : la variable n'a pas de valeur, la borne ne la reçoit pas.
        screen.TextValues = value is null
            ? new Dictionary<string, string>()
            : new Dictionary<string, string> { ["event_name"] = value };

        var box = (FrameworkElement)screen.TextOf("event_name")!.Parent;
        (box.Visibility == Visibility.Visible).Should().Be((bool)c["visible"]!);
    });

    private static BitmapSource Pixel()
    {
        var bmp = BitmapSource.Create(4, 4, 96, 96, PixelFormats.Bgra32, null, Enumerable.Repeat((byte)0xFF, 64).ToArray(), 16);
        bmp.Freeze();
        return bmp;
    }

    private static void RunSta(Action action)
    {
        ExceptionDispatchInfo? error = null;
        var thread = new Thread(() =>
        {
            try
            {
                _ = Application.Current; // schéma pack:// (polices embarquées)
                action();
            }
            catch (Exception ex) { error = ExceptionDispatchInfo.Capture(ex); }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        error?.Throw();
    }
}
