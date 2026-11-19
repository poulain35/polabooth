using System.IO;
using System.Text.Json;
using PolaKiosk.Models;

namespace PolaKiosk.Services;

public class MachineSettingsService : IMachineSettingsService
{
    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    // Lecture insensible à la casse : « webcamWidth » saisi à la main est lu comme « WebcamWidth ».
    private static readonly JsonSerializerOptions ReadOpts = new() { PropertyNameCaseInsensitive = true };

    private readonly string _path;
    private readonly object _saveLock = new();
    private MachineSettings _current;

    public MachineSettingsService(string dataDir)
    {
        Directory.CreateDirectory(dataDir);
        _path = new KioskPaths(dataDir).MachineSettingsFile;
        _current = Load();
    }

    public MachineSettings Current => _current;

    public void SetPrinterName(string? printerName)
    {
        _current = _current with
        {
            PrinterName = string.IsNullOrWhiteSpace(printerName) ? null : printerName.Trim(),
        };
        Save();
    }

    public void SetCamera(string? mode, int? webcamIndex)
    {
        var clean = string.IsNullOrWhiteSpace(mode) || mode == "auto" ? null : mode;
        _current = _current with
        {
            CameraMode  = clean,
            WebcamIndex = clean == "webcam" ? webcamIndex : null,
        };
        Save();
    }

    public void SetCanonPhotoSize(string size)
    {
        _current = _current with { CanonPhotoSize = CanonPhotoSize.Normalize(size) };
        Save();
    }

    public void SetEventRetentionDays(int days)
    {
        _current = _current with { EventRetentionDays = EventCleanupService.ClampRetentionDays(days) };
        Save();
    }

    public void SetSaasAddress(string saasUrl, string supabaseUrl, string supabaseAnonKey)
    {
        if (string.IsNullOrWhiteSpace(saasUrl) || string.IsNullOrWhiteSpace(supabaseUrl)
            || string.IsNullOrWhiteSpace(supabaseAnonKey))
            throw new ArgumentException("Adresse du SaaS incomplète.");

        _current = _current with
        {
            SaasUrl         = saasUrl.Trim(),
            SupabaseUrl     = supabaseUrl.Trim(),
            SupabaseAnonKey = supabaseAnonKey.Trim(),
        };
        Save();
    }

    public void ClearSaasAddress()
    {
        _current = _current with { SaasUrl = null, SupabaseUrl = null, SupabaseAnonKey = null };
        Save();
    }

    public void SetPrinterDriverSetting(PrinterDriverSetting setting)
    {
        var kept = (_current.PrinterDriverSettings ?? [])
            .Where(s => s != null && !(s.Kind == setting.Kind && DriverSettingCheck.SamePrinter(s.PrinterName, setting.PrinterName)));
        _current = _current with { PrinterDriverSettings = [.. kept, setting] };
        Save();
    }

    public void SetCameraExposure(CameraExposureValues values, DateTimeOffset changedAt)
    {
        _current = _current with { CameraExposure = new SavedCameraExposure { Values = values, ChangedAt = changedAt } };
        Save();
    }

    public void SetPrintAdjustment(PrintAdjustment adjustment)
    {
        var clean = PrintAdjust.Normalize(adjustment);
        _current = _current with { PrintAdjustment = PrintAdjust.IsZero(clean) ? null : clean };
        Save();
    }

    private MachineSettings Load()
    {
        try
        {
            if (File.Exists(_path))
                return JsonSerializer.Deserialize<MachineSettings>(File.ReadAllText(_path), ReadOpts) ?? new MachineSettings();
        }
        catch
        {
            // Fichier absent ou corrompu → réglages par défaut (imprimante système)
        }
        return new MachineSettings();
    }

    private void Save()
    {
        try
        {
            lock (_saveLock)
                AtomicFile.WriteAllText(_path, JsonSerializer.Serialize(_current, JsonOpts));
        }
        catch
        {
            // Best effort : l'échec d'écriture ne doit pas planter l'admin
        }
    }
}
