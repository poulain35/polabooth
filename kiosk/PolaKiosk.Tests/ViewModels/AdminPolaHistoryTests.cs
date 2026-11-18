using FluentAssertions;
using Moq;
using PolaKiosk.Services;
using PolaKiosk.Tests.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>
/// Écran admin : liste « .pola déjà importés » et rechargement (LAB-321), avec le vrai import
/// (SyncService, base SQLite, dossier de données) et sans réseau.
/// </summary>
public sealed class AdminPolaHistoryTests : IDisposable
{
    private static readonly Guid EventA  = PolaFixture.EventId;
    private static readonly Guid DesignA = PolaFixture.DesignId;
    private static readonly Guid EventB  = Guid.Parse("7a2e3d4c-2222-4333-8444-a55566667777");
    private static readonly Guid DesignB = Guid.Parse("8b3f4e5d-3333-4444-8555-b66677778888");

    private readonly TestKiosk _kiosk = new();
    private readonly TempDir _usb = new();

    public AdminPolaHistoryTests()
    {
        // Strict : le moindre appel réseau ferait échouer le test.
        _kiosk.Supabase.Reset();
        PolaFixture.Write(_usb.File("A.pola"), PolaFixture.BundleOf(EventA, DesignA, "Mariage Léa & Tom", "LEA2026",
            "2026-06-14T14:00:00+00:00", "2026-06-15T02:00:00+00:00"));
        PolaFixture.Write(_usb.File("B.pola"), PolaFixture.BundleOf(EventB, DesignB, "Anniversaire Hugo", "HUGO40"));
    }

    public void Dispose()
    {
        _usb.Dispose();
        _kiosk.Dispose();
    }

    private AdminViewModel NewViewModel()
        => AdminViewModelTests.NewViewModel(_kiosk.State.Object, _kiosk.NewService(), _kiosk.History);

    private PolaHistoryItem ItemOf(AdminViewModel vm, string name)
        => vm.PolaHistory.Should().ContainSingle(i => i.EventName == name).Subject;

    [Fact]
    public async Task Import_A_then_B_then_reload_A_makes_A_active_again_without_network_or_usb_stick()
    {
        var vm = NewViewModel();
        await vm.ImportPolaFromPathAsync(_usb.File("A.pola"));
        await vm.ImportPolaFromPathAsync(_usb.File("B.pola"));
        vm.ActiveEventName.Should().Be("Anniversaire Hugo");
        _usb.Dispose();   // clé USB retirée

        await vm.ReloadPolaCommand.ExecuteAsync(ItemOf(vm, "Mariage Léa & Tom"));

        vm.ActiveEventName.Should().Be("Mariage Léa & Tom");
        vm.ActiveEventId.Should().Be(EventA.ToString());
        vm.PolaStatusMsg.Should().Be("✓ « Mariage Léa & Tom » rechargé : c'est l'événement actif.");
        _kiosk.State.Verify(s => s.SetActiveEventAsync(EventA, "Mariage Léa & Tom", "LEA2026"), Times.Exactly(2));
        using (var ctx = _kiosk.Db.NewContext())
            ctx.Templates.Should().Contain(t => t.EventId == EventA && t.Id == DesignA);
        _kiosk.Supabase.VerifyNoOtherCalls();

        // Rechargé = dernier import : A repasse en tête, toujours une seule entrée par événement.
        vm.PolaHistory.Select(i => i.EventName).Should().Equal("Mariage Léa & Tom", "Anniversaire Hugo");
    }

    [Fact]
    public async Task The_list_shows_the_name_the_event_dates_and_the_import_date()
    {
        var vm = NewViewModel();
        vm.HasPolaHistory.Should().BeFalse();

        await vm.ImportPolaFromPathAsync(_usb.File("A.pola"));
        await vm.ImportPolaFromPathAsync(_usb.File("B.pola"));

        vm.HasPolaHistory.Should().BeTrue();
        var a = ItemOf(vm, "Mariage Léa & Tom");
        a.EventDates.Should().Be("Du 14 au 15 juin 2026");
        a.ImportedText.Should().StartWith("Importé le ");
        ItemOf(vm, "Anniversaire Hugo").EventDates.Should().Be("Dates non renseignées");
        NewViewModel().PolaHistory.Should().HaveCount(2, "la liste est relue à chaque ouverture de l'Admin");
    }

    [Fact]
    public void Import_date_is_shown_at_Paris_time()
        => PolaHistoryItem.ImportedLabel(DateTimeOffset.Parse("2026-11-15T17:30:00+00:00"))
            .Should().Be("Importé le 15 novembre 2026 à 18:30");

    [Fact]
    public async Task A_deleted_archive_shows_a_message_and_leaves_the_list()
    {
        var vm = NewViewModel();
        await vm.ImportPolaFromPathAsync(_usb.File("A.pola"));
        await vm.ImportPolaFromPathAsync(_usb.File("B.pola"));
        var a = ItemOf(vm, "Mariage Léa & Tom");
        File.Delete(_kiosk.History.PathOf(a.Entry));

        await vm.ReloadPolaCommand.ExecuteAsync(a);

        vm.PolaStatusMsg.Should().Be("Erreur : ce fichier .pola n'est plus sur la borne. Il a été retiré de la liste.");
        vm.ActiveEventName.Should().Be("Anniversaire Hugo");
        vm.PolaHistory.Select(i => i.EventName).Should().Equal("Anniversaire Hugo");
    }

    [Fact]
    public async Task An_unreadable_archive_shows_a_message_and_leaves_the_list()
    {
        var vm = NewViewModel();
        await vm.ImportPolaFromPathAsync(_usb.File("A.pola"));
        await vm.ImportPolaFromPathAsync(_usb.File("B.pola"));
        var a = ItemOf(vm, "Mariage Léa & Tom");
        File.WriteAllBytes(_kiosk.History.PathOf(a.Entry), [1, 2, 3, 4]);

        await vm.ReloadPolaCommand.ExecuteAsync(a);

        vm.PolaStatusMsg.Should().Be($"Erreur : {PolaBundle.UnreadableMessage} Il a été retiré de la liste.");
        vm.ActiveEventName.Should().Be("Anniversaire Hugo");
        vm.PolaHistory.Select(i => i.EventName).Should().Equal("Anniversaire Hugo");
        File.Exists(_kiosk.History.PathOf(a.Entry)).Should().BeFalse();
    }
}
