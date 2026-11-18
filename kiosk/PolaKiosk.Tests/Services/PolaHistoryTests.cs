using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Historique des .pola importés depuis l'Admin (LAB-321) : nommage, doublons, limite, fichier manquant.</summary>
public sealed class PolaHistoryTests : IDisposable
{
    private static readonly Guid EventA  = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private static readonly Guid EventB  = Guid.Parse("7a2e3d4c-2222-4333-8444-a55566667777");
    private static readonly Guid DesignA = Guid.Parse("0a9b8c7d-2222-4333-8444-a55566667777");
    private static readonly Guid DesignB = Guid.Parse("1b2c3d4e-3333-4444-8555-b66677778888");
    private static readonly DateTimeOffset Start = DateTimeOffset.Parse("2026-06-14T14:00:00+00:00");
    private static readonly DateTimeOffset End   = DateTimeOffset.Parse("2026-06-15T02:00:00+00:00");

    private readonly TempDir _dir = new();
    private DateTimeOffset _now = DateTimeOffset.Parse("2026-11-15T17:30:45+00:00");

    public void Dispose() => _dir.Dispose();

    private PolaHistory NewHistory() => new(_dir.Path, () => _now);

    private string Folder => Path.Combine(_dir.Path, "pola-history");

    private string[] PolaFiles() => Directory.GetFiles(Folder, "*.pola").Select(Path.GetFileName).Order().ToArray()!;

    private PolaHistoryEntry Add(PolaHistory history, Guid eventId, Guid designId, string name, byte[]? content = null)
    {
        var entry = history.Add(content ?? [1, 2, 3], eventId, designId, name, Start, End);
        _now = _now.AddMinutes(1);
        return entry;
    }

    // ── Nommage ───────────────────────────────────────────────────────────────

    [Fact]
    public void File_name_has_the_import_time_in_Paris_the_event_name_and_its_short_id()
        => PolaHistory.FileNameFor(DateTimeOffset.Parse("2026-11-15T17:30:45+00:00"), "Mariage Léa & Tom", EventA)
            .Should().Be("2026-11-15_18-30-45_Mariage_Léa_Tom_6f1d2c3b.pola");

    [Theory]
    [InlineData("", "evenement")]
    [InlineData("  ** ", "evenement")]
    [InlineData(@"Soirée ..\..\Windows", "Soirée_Windows")]
    public void File_name_never_leaves_the_folder(string name, string expected)
        => PolaHistory.FileNameFor(_now, name, EventA).Should().Be($"2026-11-15_18-30-45_{expected}_6f1d2c3b.pola");

    [Fact]
    public void Long_event_names_are_shortened()
        => PolaHistory.FileNameFor(_now, new string('a', 200), EventA).Length
            .Should().Be("2026-11-15_18-30-45_".Length + 60 + "_6f1d2c3b.pola".Length);

    [Fact]
    public void Added_file_is_kept_with_its_event_and_import_date()
    {
        var history = NewHistory();
        byte[] content = [9, 8, 7];

        var entry = history.Add(content, EventA, DesignA, "Mariage Léa & Tom", Start, End);

        File.ReadAllBytes(history.PathOf(entry)).Should().Equal(content);
        Path.GetDirectoryName(history.PathOf(entry)).Should().Be(Folder);
        var listed = NewHistory().List().Should().ContainSingle().Subject;
        listed.Should().Be(new PolaHistoryEntry("2026-11-15_18-30-45_Mariage_Léa_Tom_6f1d2c3b.pola",
            EventA, DesignA, "Mariage Léa & Tom", Start, End, DateTimeOffset.Parse("2026-11-15T17:30:45+00:00")));
    }

    // ── Doublons ──────────────────────────────────────────────────────────────

    [Fact]
    public void Same_event_and_design_imported_twice_keeps_one_entry_with_the_last_date()
    {
        var history = NewHistory();
        var first  = Add(history, EventA, DesignA, "Mariage", [1]);
        Add(history, EventB, DesignB, "Anniversaire");
        var second = Add(history, EventA, DesignA, "Mariage", [2]);

        var list = history.List();

        list.Select(e => e.EventId).Should().Equal(EventA, EventB);
        list[0].Should().Be(second);
        list[0].ImportedAt.Should().BeAfter(first.ImportedAt);
        File.Exists(history.PathOf(first)).Should().BeFalse();
        File.ReadAllBytes(history.PathOf(second)).Should().Equal(2);
        PolaFiles().Should().HaveCount(2);
    }

    [Fact]
    public void Same_event_with_another_design_is_another_entry()
    {
        var history = NewHistory();
        Add(history, EventA, DesignA, "Mariage");
        Add(history, EventA, DesignB, "Mariage");

        history.List().Select(e => e.DesignId).Should().Equal(DesignB, DesignA);
    }

    [Fact]
    public void Reimport_in_the_same_second_overwrites_the_same_file()
    {
        var history = NewHistory();
        history.Add([1], EventA, DesignA, "Mariage", Start, End);
        var again = history.Add([2], EventA, DesignA, "Mariage", Start, End);

        history.List().Should().ContainSingle().Which.Should().Be(again);
        File.ReadAllBytes(history.PathOf(again)).Should().Equal(2);
    }

    // ── Limite ────────────────────────────────────────────────────────────────

    [Fact]
    public void Only_the_last_20_imports_are_kept_and_older_files_are_deleted()
    {
        var history = NewHistory();
        var entries = Enumerable.Range(1, PolaHistory.MaxEntries + 3)
            .Select(i => Add(history, Guid.NewGuid(), Guid.NewGuid(), $"Événement {i}"))
            .ToList();

        var list = history.List();

        list.Should().HaveCount(PolaHistory.MaxEntries);
        list.Select(e => e.EventName).Should().Equal(entries.AsEnumerable().Reverse().Take(20).Select(e => e.EventName));
        entries.Take(3).Should().OnlyContain(e => !File.Exists(history.PathOf(e)));
        PolaFiles().Should().HaveCount(PolaHistory.MaxEntries);
    }

    // ── Fichier manquant, index abîmé ─────────────────────────────────────────

    [Fact]
    public void Entry_whose_file_was_deleted_leaves_the_list()
    {
        var history = NewHistory();
        var gone = Add(history, EventA, DesignA, "Mariage");
        Add(history, EventB, DesignB, "Anniversaire");
        File.Delete(history.PathOf(gone));

        history.List().Select(e => e.EventId).Should().Equal(EventB);
        File.ReadAllText(Path.Combine(Folder, PolaHistory.IndexFileName)).Should().NotContain(gone.FileName);
    }

    [Fact]
    public void Removed_entry_loses_its_file()
    {
        var history = NewHistory();
        var entry = Add(history, EventA, DesignA, "Mariage");

        history.Remove(entry);

        history.List().Should().BeEmpty();
        File.Exists(history.PathOf(entry)).Should().BeFalse();
    }

    [Fact]
    public void Empty_folder_gives_an_empty_list()
        => NewHistory().List().Should().BeEmpty();

    [Fact]
    public void Damaged_index_gives_an_empty_list_and_orphan_files_go_at_the_next_import()
    {
        var history = NewHistory();
        var old = Add(history, EventA, DesignA, "Mariage");
        File.WriteAllText(Path.Combine(Folder, PolaHistory.IndexFileName), "{ pas du json");

        history.List().Should().BeEmpty();

        var next = Add(history, EventB, DesignB, "Anniversaire");
        history.List().Should().ContainSingle().Which.Should().Be(next);
        File.Exists(history.PathOf(old)).Should().BeFalse();
    }
}
