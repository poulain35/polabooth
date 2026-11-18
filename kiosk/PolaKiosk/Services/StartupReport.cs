using System.IO;
using Microsoft.Win32;

namespace PolaKiosk.Services;

/// <summary>Faits relevés au lancement de la borne (LAB-326). Null = non lu.</summary>
public sealed record StartupFacts(
    string AppVersion,
    string Windows,
    string MachineName,
    string? Screen,
    long? FreeDiskBytes,
    string? PrinterName,
    string PrinterStatus,
    string? EventName,
    string? AccessCode);

/// <summary>
/// Ligne de démarrage (journal <c>startup</c>, info, une par lancement) : de quoi situer la borne sans
/// la voir (version, poste, écran, disque, imprimante, événement). Aucune donnée d'invité.
/// </summary>
public static class StartupReport
{
    public const string LogContext = "startup";

    public static string Format(StartupFacts f)
    {
        var printer = string.IsNullOrWhiteSpace(f.PrinterName) ? "imprimante par défaut de Windows" : $"imprimante « {f.PrinterName} »";
        var ev = string.IsNullOrWhiteSpace(f.EventName)
            ? "aucun événement actif"
            : string.IsNullOrWhiteSpace(f.AccessCode) ? $"événement « {f.EventName} »" : $"événement « {f.EventName} » ({f.AccessCode})";

        return $"Démarrage de la borne : version {f.AppVersion} ; {f.Windows} ; PC {f.MachineName} ; " +
               $"écran {f.Screen ?? "inconnu"} ; " +
               $"espace disque libre {(f.FreeDiskBytes is { } bytes ? EventCleanupService.FormatSize(bytes) : "inconnu")} ; " +
               $"{printer} ({PrinterStatusLabel(f.PrinterStatus)}) ; {ev}.";
    }

    /// <summary>État lu par <see cref="PrintService.ReadPrinterStatus"/>, en clair.</summary>
    internal static string PrinterStatusLabel(string status) => status switch
    {
        "ready"     => "prête",
        "offline"   => "hors ligne",
        "paper_out" => "plus de papier",
        "paper_jam" => "bourrage papier",
        "error"     => "en erreur",
        "not_found" => "introuvable",
        _           => "état inconnu",
    };

    /// <summary>Taille réelle de l'écran principal, en pixels, et mise à l'échelle de Windows.</summary>
    public static string DescribeScreen(double widthDip, double heightDip, double dpiScaleX, double dpiScaleY)
    {
        var width  = (int)Math.Round(widthDip * dpiScaleX);
        var height = (int)Math.Round(heightDip * dpiScaleY);
        var scale  = (int)Math.Round(dpiScaleX * 100);
        return scale == 100 ? $"{width} × {height}" : $"{width} × {height} (échelle {scale} %)";
    }

    /// <summary>Windows 11 à partir de la version 22000 (le numéro principal reste 10).</summary>
    internal static string WindowsName(Version version, string? displayVersion)
    {
        var name = version.Major == 10 && version.Build >= 22000 ? "Windows 11"
                 : version.Major == 10 ? "Windows 10"
                 : "Windows";
        var release = string.IsNullOrWhiteSpace(displayVersion) ? "" : $" {displayVersion.Trim()}";
        return $"{name}{release} ({version.Major}.{version.Minor}.{version.Build})";
    }

    /// <summary>Relève les faits (disque, imprimante, registre : à appeler hors du fil d'affichage). Ne lève jamais.</summary>
    public static StartupFacts Collect(AppSettings settings, IKioskStateService state, string? screen)
    {
        string? displayVersion = null;
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            displayVersion = key?.GetValue("DisplayVersion") as string;
        }
        catch { /* version sans nom de mise à jour */ }

        long? freeDisk = null;
        try
        {
            var dataDir = KioskPaths.From(settings).Root;
            freeDisk = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(dataDir))!).AvailableFreeSpace;
        }
        catch { /* inconnu */ }

        var printerName = settings.Kiosk.PrinterName;
        return new StartupFacts(
            AppVersion:    AppVersion.Current,
            Windows:       WindowsName(Environment.OSVersion.Version, displayVersion),
            MachineName:   Environment.MachineName,
            Screen:        screen,
            FreeDiskBytes: freeDisk,
            PrinterName:   printerName,
            PrinterStatus: PrintService.ReadPrinterStatus(printerName),
            EventName:     state.ActiveEventName,
            AccessCode:    state.LastAccessCode);
    }
}
