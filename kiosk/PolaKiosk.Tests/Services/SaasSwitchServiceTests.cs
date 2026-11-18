using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// Open core K2 : « Changer de SaaS » efface l'adresse saisie et l'association, garde les réglages machine.
public sealed class SaasSwitchServiceTests : IDisposable
{
    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    private AppSettings Settings() => new() { Kiosk = { DataDirectory = _dir.Path } };

    [Fact]
    public async Task Entered_address_pairing_and_event_are_cleared()
    {
        var machine = new MachineSettingsService(_dir.Path);
        machine.SetPrinterName("DNP DS620");
        machine.SetSaasAddress("https://photobooth.mon-entreprise.fr", "https://abc.supabase.co", "cle-anon");

        var state = new KioskStateService(Settings());
        await state.SetPairedAccountAsync("Mon entreprise", Guid.NewGuid());
        await state.SetActiveEventAsync(Guid.NewGuid(), "Mariage", "ABC123");
        await state.SetContactInfoAsync("Mon entreprise", "0600000000", "contact@exemple.fr");

        var pairingFiles = new KioskPaths(_dir.Path).PairingFiles;
        foreach (var path in pairingFiles)
            await File.WriteAllTextAsync(path, "x", TestContext.Current.CancellationToken);
        await File.WriteAllTextAsync(_dir.File("polakiosk.db"), "base locale", TestContext.Current.CancellationToken);

        await new SaasSwitchService(machine, state, Settings()).ClearAsync();

        machine.Current.SaasUrl.Should().BeNull();
        machine.Current.SupabaseUrl.Should().BeNull();
        machine.Current.SupabaseAnonKey.Should().BeNull();
        machine.Current.PrinterName.Should().Be("DNP DS620");

        state.ActiveEventId.Should().BeNull();
        state.ContactCompany.Should().BeNull();
        state.AccountName.Should().BeNull();
        state.AccountOrgId.Should().BeNull();

        pairingFiles.Should().OnlyContain(path => !File.Exists(path));
        File.Exists(_dir.File("polakiosk.db")).Should().BeTrue();

        // Au redémarrage : plus d'adresse, la borne affiche l'écran « Adresse de votre SaaS ».
        var reloaded = new MachineSettingsService(_dir.Path).Current;
        reloaded.SupabaseUrl.Should().BeNull();
        reloaded.PrinterName.Should().Be("DNP DS620");
        SaasEndpoint.Apply(new AppSettings(), reloaded).Should().Be(SaasEndpointSource.None);

        var reloadedState = new KioskStateService(Settings());
        reloadedState.ActiveEventId.Should().BeNull();
        reloadedState.AccountName.Should().BeNull();
    }

    [Fact]
    public async Task Clearing_twice_or_without_files_does_not_fail()
    {
        var machine = new MachineSettingsService(_dir.Path);
        var state   = new KioskStateService(Settings());
        var service = new SaasSwitchService(machine, state, Settings());

        await service.ClearAsync();
        var again = () => service.ClearAsync();

        await again.Should().NotThrowAsync();
    }

    [Fact]
    public void Pairing_files_are_the_ones_the_services_write()
    {
        var paths = new KioskPaths(_dir.Path);
        paths.PairingFiles.Select(Path.GetFileName).Should().BeEquivalentTo(["activation.bin", "admin-pin.bin", "license.json", "license.key"]);
        paths.PairingFiles.Should().OnlyContain(path => Path.GetDirectoryName(path) == _dir.Path);
    }
}
