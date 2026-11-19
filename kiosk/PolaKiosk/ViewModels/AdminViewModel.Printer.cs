using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

// Admin : imprimante enregistrée et réglages du pilote (LAB-334).
public partial class AdminViewModel
{
    private void LoadPrinters()
    {
        AvailablePrinters.Clear();
        AvailablePrinters.Add(SystemDefaultPrinter);
        foreach (var p in _print.GetAvailablePrinters())
            AvailablePrinters.Add(p);

        var configured = _settings.Kiosk.PrinterName;
        SelectedPrinter = !string.IsNullOrWhiteSpace(configured) && AvailablePrinters.Contains(configured)
            ? configured
            : SystemDefaultPrinter;

        var def = _print.GetDefaultPrinterName();
        DefaultPrinterHint = string.IsNullOrWhiteSpace(def)
            ? "Aucune imprimante par défaut détectée dans Windows."
            : $"Imprimante par défaut de Windows : {def}";
    }

    partial void OnSelectedPrinterChanged(string value) { if (!_loadingChoices) SavePrinter(); }

    [RelayCommand]
    private void SavePrinter()
    {
        var chosen = SelectedPrinter == SystemDefaultPrinter ? null : SelectedPrinter;
        _machine.SetPrinterName(chosen);
        _settings.Kiosk.PrinterName = chosen ?? "";  // prise en compte immédiate, sans redémarrer
        PrinterStatusMsg = chosen == null
            ? "✓ Imprimante par défaut du système"
            : $"✓ Imprimante enregistrée : {chosen}";
        DriverSettingMsg = "";
        RefreshDriverSettingStatus();
    }

    /// <summary>Imprimante utilisée à l'impression : celle enregistrée, sinon celle par défaut de Windows.</summary>
    private string PrintingPrinter()
        => string.IsNullOrWhiteSpace(_settings.Kiosk.PrinterName) ? _print.GetDefaultPrinterName() : _settings.Kiosk.PrinterName;

    private int DriverSize(string printer)
    {
        try { return _printerDriver.GetDevModeSize(printer); }
        catch { return 0; }
    }

    private void RefreshDriverSettingStatus()
    {
        var printer = PrintingPrinter();
        var size = string.IsNullOrWhiteSpace(printer) ? 0 : DriverSize(printer);
        var saved = _machine.Current.PrinterDriverSettings;
        StripCutSettingStatus = DriverSettingText.Status(
            DriverSettingCheck.Find(saved, PrinterDriverSettingKind.StripCut, printer, size), PrinterDriverSettingKind.StripCut, printer);
        NormalSettingStatus = DriverSettingText.Status(
            DriverSettingCheck.Find(saved, PrinterDriverSettingKind.Normal, printer, size), PrinterDriverSettingKind.Normal, printer);
    }

    [RelayCommand]
    private void RecordStripCutSetting() => RecordDriverSetting(PrinterDriverSettingKind.StripCut);

    [RelayCommand]
    private void RecordNormalSetting() => RecordDriverSetting(PrinterDriverSettingKind.Normal);

    /// <summary>
    /// Ouvre la fenêtre des préférences du pilote de l'imprimante enregistrée, puis garde le réglage validé
    /// tel que le pilote le rend (LAB-334). Annuler ne change rien.
    /// </summary>
    private void RecordDriverSetting(string kind)
    {
        var label = PrinterDriverSettingKind.Label(kind);
        var chosen = SelectedPrinter == SystemDefaultPrinter ? "" : SelectedPrinter;
        if (!DriverSettingCheck.SamePrinter(chosen, _settings.Kiosk.PrinterName))
        {
            DriverSettingMsg = "✗ L'imprimante choisie n'est pas enregistrée : touchez-la de nouveau dans la liste ci-dessus, puis recommencez.";
            return;
        }

        var printer = PrintingPrinter();
        if (string.IsNullOrWhiteSpace(printer))
        {
            DriverSettingMsg = "✗ Aucune imprimante trouvée. Branchez l'imprimante, choisissez-la ci-dessus puis recommencez.";
            return;
        }

        var current = DriverSettingCheck.Find(_machine.Current.PrinterDriverSettings, kind, printer, DriverSize(printer));
        byte[]? devMode;
        try
        {
            devMode = _printerDriver.Prompt(printer, current.DevMode);
        }
        catch (Exception ex)
        {
            DriverSettingMsg = $"✗ La fenêtre du pilote de « {printer} » ne s'est pas ouverte ({ex.Message}). " +
                               "Vérifiez que l'imprimante est allumée et installée dans Windows, puis recommencez.";
            return;
        }

        if (devMode == null)
        {
            DriverSettingMsg = $"Fenêtre fermée sans valider : le réglage « {label} » n'a pas changé.";
            return;
        }
        if (!DriverSettingCheck.IsConsistent(devMode))
        {
            DriverSettingMsg = $"✗ Le pilote de « {printer} » a rendu un réglage illisible : rien n'a été enregistré. Recommencez.";
            return;
        }

        _machine.SetPrinterDriverSetting(PrinterDriverSetting.Create(printer, kind, devMode, _clock.GetUtcNow()));
        DriverSettingMsg = kind == PrinterDriverSettingKind.StripCut
            ? $"✓ Réglage « bandes coupées » enregistré pour « {printer} ». Faites un essai avec un cadre en bande : la feuille doit sortir coupée en deux bandes."
            : $"✓ Réglage « normal » enregistré pour « {printer} ». Faites un essai avec un cadre 10x15 : la feuille ne doit pas être coupée.";
        RefreshDriverSettingStatus();
    }

    // ── Décalage de l'impression (LAB-433) ──────────────────────────────────

    private PrintAdjustment CurrentAdjustment => PrintAdjust.Normalize(_machine.Current.PrintAdjustment);

    private void RefreshPrintAdjustment()
    {
        var a = CurrentAdjustment;
        OffsetXLabel = PrintAdjust.OffsetXLabel(a.OffsetXMm);
        OffsetYLabel = PrintAdjust.OffsetYLabel(a.OffsetYMm);
        EnlargeLabel = PrintAdjust.EnlargeLabel(a.EnlargePercent);
    }

    // Enregistré à chaque appui : pris en compte dès l'impression suivante, sans redémarrer.
    private void SaveAdjustment(PrintAdjustment next)
    {
        var before = CurrentAdjustment;
        _machine.SetPrintAdjustment(next);
        RefreshPrintAdjustment();
        PrintAdjustMsg = CurrentAdjustment == before
            ? "Limite atteinte : 5 mm de décalage et 5 % d'agrandissement au plus."
            : "✓ Enregistré. Imprimez une feuille de test pour vérifier.";
    }

    [RelayCommand] private void MoveLeft()     => SaveAdjustment(PrintAdjust.StepX(CurrentAdjustment, -1));
    [RelayCommand] private void MoveRight()    => SaveAdjustment(PrintAdjust.StepX(CurrentAdjustment, +1));
    [RelayCommand] private void MoveUp()       => SaveAdjustment(PrintAdjust.StepY(CurrentAdjustment, -1));
    [RelayCommand] private void MoveDown()     => SaveAdjustment(PrintAdjust.StepY(CurrentAdjustment, +1));
    [RelayCommand] private void EnlargeLess()  => SaveAdjustment(PrintAdjust.StepEnlarge(CurrentAdjustment, -1));
    [RelayCommand] private void EnlargeMore()  => SaveAdjustment(PrintAdjust.StepEnlarge(CurrentAdjustment, +1));

    [RelayCommand]
    private void ResetPrintAdjustment()
    {
        _machine.SetPrintAdjustment(PrintAdjust.Zero);
        RefreshPrintAdjustment();
        PrintAdjustMsg = "✓ Réglage remis à zéro : l'impression est centrée.";
    }

    private bool CanPrintTestSheet() => !IsPrintingTestSheet;

    /// <summary>Feuille de test sur l'imprimante utilisée par la borne, avec le réglage actuel. Jamais comptée.</summary>
    [RelayCommand(CanExecute = nameof(CanPrintTestSheet))]
    private async Task PrintTestSheetAsync()
    {
        IsPrintingTestSheet = true;
        PrintAdjustMsg = "Impression de la feuille de test…";
        try
        {
            await _print.PrintTestSheetAsync(_settings.Kiosk.PrinterName, CurrentAdjustment);
            PrintAdjustMsg = "✓ Feuille de test envoyée à l'imprimante.";
        }
        catch (Exception ex)
        {
            PrintAdjustMsg = $"✗ La feuille de test n'a pas été imprimée : {ex.Message}";
        }
        finally
        {
            IsPrintingTestSheet = false;
        }
    }
}
