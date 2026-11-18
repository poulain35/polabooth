using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-332 : lecture de fatal.log (format de FatalLog.Write) et choix des entrées recopiées.</summary>
public sealed class FatalLogParserTests
{
    private const string Nl = "\r\n"; // Environment.NewLine de la borne

    private static readonly string Crash =
        "[2026-11-15 21:04:07] [app] System.InvalidOperationException: La collection a été modifiée." + Nl +
        "   at PolaKiosk.Views.HomeView.OnLoaded(Object sender, RoutedEventArgs e) in HomeView.xaml.cs:line 42" + Nl +
        "   at System.Windows.EventRoute.InvokeHandlersImpl(Object source, RoutedEventArgs args, Boolean reRaised)" + Nl;

    [Fact]
    public void An_entry_is_read_with_its_time_context_and_message()
    {
        var entry = FatalLogParser.Parse("[2026-11-15 09:30:00] [exit] Fermeture de la caméra non terminée après 5 s." + Nl)
            .Should().ContainSingle().Subject;

        entry.LocalTime.Should().Be(new DateTime(2026, 11, 15, 9, 30, 0));
        entry.Context.Should().Be("exit");
        entry.Message.Should().Be("Fermeture de la caméra non terminée après 5 s.");
    }

    [Fact]
    public void Continuation_lines_belong_to_the_entry_above()
    {
        var entries = FatalLogParser.Parse(Crash + "[2026-11-15 21:04:09] [startup] PolaKiosk est déjà lancé : cette nouvelle instance se ferme." + Nl);

        entries.Should().HaveCount(2);
        entries[0].Context.Should().Be("app");
        entries[0].Message.Split('\n').Should().HaveCount(3);
        entries[0].Message.Should().NotContain("\r").And.EndWith("Boolean reRaised)");
        entries[1].Context.Should().Be("startup");
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("n'importe quoi\r\nsans entrée\r\n")]
    [InlineData("\0\0\0\0\0\0")]
    [InlineData("[2026-13-45 99:99:99] [app] date impossible")]
    public void Empty_or_corrupted_text_gives_no_entry_and_never_throws(string? text)
        => FatalLogParser.Parse(text).Should().BeEmpty();

    [Fact]
    public void Garbage_before_the_first_entry_and_nul_characters_are_ignored()
    {
        // Coupure de courant : bloc de NUL à la fin d'une écriture, puis entrée suivante.
        var text = "\0\0\0déchet" + Nl + "[2026-11-15 10:00:00] [app] System.Exception: boum\0\0" + Nl + "\0\0\0";

        var entry = FatalLogParser.Parse(text).Should().ContainSingle().Subject;
        entry.Message.Should().Be("System.Exception: boum").And.NotContain("\0");
    }

    [Fact]
    public void A_crash_is_an_error_with_the_exception_as_message_and_the_stack_apart()
    {
        var log = FatalLogParser.Classify(FatalLogParser.Parse(Crash)[0])!;

        log.Level.Should().Be("error");
        log.Context.Should().Be("app");
        log.Message.Should().Be("Plantage de l'application : System.InvalidOperationException: La collection a été modifiée.");
        log.StackTrace.Should().StartWith("at PolaKiosk.Views.HomeView.OnLoaded").And.Contain("EventRoute");
    }

    [Theory]
    [InlineData("ui-recovery")]
    [InlineData("ui")]
    [InlineData("startup")]
    public void A_watchdog_exit_is_an_error_in_its_own_context(string context)
    {
        // Format de App.ExitForWatchdog : raison, puis la phrase d'arrêt sur sa ligne.
        var text = $"[2026-11-15 21:05:00] [{context}] System.NullReferenceException: Object reference not set." + Nl +
                   "   at PolaKiosk.App.<AttachGlobalErrorHandlers>b__1(Object _, DispatcherUnhandledExceptionEventArgs ev)" + Nl +
                   FatalLog.WatchdogExitNotice + Nl;

        var log = FatalLogParser.Classify(FatalLogParser.Parse(text)[0])!;

        log.Level.Should().Be("error");
        log.Context.Should().Be(context);
        log.Message.Should().Be("Arrêt de l'application, relancée par le watchdog : System.NullReferenceException: Object reference not set.");
        log.StackTrace.Should().StartWith("at PolaKiosk.App").And.NotContain(FatalLog.WatchdogExitNotice);
    }

    [Fact]
    public void Too_many_recoveries_keeps_its_reason_as_message()
    {
        var text = "[2026-11-15 21:05:00] [ui] Plus de 5 reprises en une minute." + Nl + FatalLog.WatchdogExitNotice + Nl;

        var log = FatalLogParser.Classify(FatalLogParser.Parse(text)[0])!;

        log.Context.Should().Be("ui");
        log.Message.Should().Be("Arrêt de l'application, relancée par le watchdog : Plus de 5 reprises en une minute.");
        log.StackTrace.Should().BeNull();
    }

    [Theory]
    [InlineData("exit", "warning")]
    [InlineData("restart", "warning")]
    [InlineData("network-event", "error")]
    public void Other_fatal_only_entries_are_copied(string context, string level)
        => FatalLogParser.Classify(new FatalLogEntry(DateTime.Now, context, "System.IO.IOException: disque"))!
            .Level.Should().Be(level);

    [Theory]
    [InlineData("startup", "PolaKiosk est déjà lancé : cette nouvelle instance se ferme.")] // pas une erreur
    [InlineData("ui", "System.Exception: déjà dans kiosk_logs (App.LogError)")]
    [InlineData("task", "System.AggregateException: déjà dans kiosk_logs")]
    [InlineData("sync-kiosk-logs", "System.Net.Http.HttpRequestException: réseau")]
    [InlineData("network-restored", "System.Exception: déjà dans kiosk_logs")]
    public void Entries_already_in_kiosk_logs_or_harmless_are_not_copied(string context, string message)
        => FatalLogParser.Classify(new FatalLogEntry(DateTime.Now, context, message)).Should().BeNull();

    [Fact]
    public void The_id_is_stable_for_an_entry_and_differs_between_kiosks()
    {
        var entry = FatalLogParser.Parse(Crash)[0];
        var again = FatalLogParser.Parse(Crash)[0];

        FatalLogParser.IdOf(entry, "PC-1").Should().Be(FatalLogParser.IdOf(again, "PC-1"));
        FatalLogParser.IdOf(entry, "PC-1").Should().NotBe(FatalLogParser.IdOf(entry, "PC-2"));
        FatalLogParser.IdOf(entry, "PC-1").Should().NotBe(FatalLogParser.IdOf(entry with { LocalTime = entry.LocalTime.AddSeconds(1) }, "PC-1"));
        // Format accepté par la RPC (uuid hexadécimal).
        FatalLogParser.IdOf(entry, "PC-1").ToString().Should().MatchRegex("^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
    }

    [Fact]
    public void Local_time_of_the_pc_becomes_utc()
    {
        var paris = EventDateFormatter.Paris;

        FatalLogParser.ToUtc(new DateTime(2026, 11, 15, 21, 4, 7), paris)
            .Should().Be(new DateTime(2026, 11, 15, 20, 4, 7, DateTimeKind.Utc)); // heure d'hiver
        FatalLogParser.ToUtc(new DateTime(2026, 7, 14, 21, 0, 0), paris)
            .Should().Be(new DateTime(2026, 7, 14, 19, 0, 0, DateTimeKind.Utc)); // heure d'été
        // 2:30 n'existe pas le jour du passage à l'heure d'été : pas d'exception.
        FluentActions.Invoking(() => FatalLogParser.ToUtc(new DateTime(2026, 3, 29, 2, 30, 0), paris)).Should().NotThrow();
    }
}
