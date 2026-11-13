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
    /// <summary>Fichiers propres à l'association avec un SaaS, dans le DataDirectory.</summary>
    internal static readonly string[] PairingFiles = ["activation.bin", "admin-pin.bin", "license.json", "license.key"];

    private readonly IMachineSettingsService _machine;
    private readonly IKioskStateService _state;
    private readonly string _dataDir;

    public SaasSwitchService(IMachineSettingsService machine, IKioskStateService state, AppSettings settings)
        : this(machine, state, Environment.ExpandEnvironmentVariables(settings.Kiosk.DataDirectory)) { }

    internal SaasSwitchService(IMachineSettingsService machine, IKioskStateService state, string dataDir)
    {
        _machine = machine;
        _state   = state;
        _dataDir = dataDir;
    }

    public async Task ClearAsync()
    {
        _machine.ClearSaasAddress();

        await _state.ClearActiveEventAsync();
        await _state.SetPairedAccountAsync(null, null);

        foreach (var name in PairingFiles)
        {
            var path = Path.Combine(_dataDir, name);
            if (File.Exists(path)) File.Delete(path);
        }
    }
}
