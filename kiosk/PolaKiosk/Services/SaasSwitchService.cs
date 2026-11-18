using System.IO;

namespace PolaKiosk.Services;

/// <summary>« Changer de SaaS » dans l'admin de la borne (open core K2).</summary>
public interface ISaasSwitchService
{
    /// <summary>
    /// Efface l'adresse saisie (machine-settings.json) et tout ce qui liait la borne à l'ancien SaaS :
    /// secret d'association, PIN admin, cache de licence, événement actif, contact et compte.
    /// Les autres réglages machine (imprimante, caméra…) restent. Redémarrage nécessaire ensuite.
    /// </summary>
    Task ClearAsync();
}

public sealed class SaasSwitchService : ISaasSwitchService
{
    private readonly IMachineSettingsService _machine;
    private readonly IKioskStateService _state;
    private readonly KioskPaths _paths;

    public SaasSwitchService(IMachineSettingsService machine, IKioskStateService state, AppSettings settings)
        : this(machine, state, KioskPaths.From(settings).Root) { }

    internal SaasSwitchService(IMachineSettingsService machine, IKioskStateService state, string dataDir)
    {
        _machine = machine;
        _state   = state;
        _paths   = new KioskPaths(dataDir);
    }

    public async Task ClearAsync()
    {
        _machine.ClearSaasAddress();

        await _state.ClearActiveEventAsync();
        await _state.SetPairedAccountAsync(null, null);

        foreach (var path in _paths.PairingFiles)
            if (File.Exists(path)) File.Delete(path);
    }
}
