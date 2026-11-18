using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

// Écran résultat : impression (nombre d'exemplaires dans la limite des quotas).
public partial class ResultViewModel
{
    // Lot d'impression quand aucun plafond n'est fixé, et plafond d'un lot sinon.
    internal const int UnlimitedMaxCopies = 10;
    internal const int LimitedMaxCopies = 20;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowPrintBlock), nameof(PrintButtonText), nameof(PrintSubtitle), nameof(Subtitle))]
    [NotifyCanExecuteChangedFor(nameof(PrintCommand), nameof(IncrementCopiesCommand), nameof(DecrementCopiesCommand))]
    private bool _canPrint;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintButtonText))]
    [NotifyCanExecuteChangedFor(nameof(PrintCommand), nameof(IncrementCopiesCommand), nameof(DecrementCopiesCommand))]
    private bool _isPrinting;

    /// <summary>Tirages encore autorisés pour cette photo ; null = aucun plafond.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintSubtitle))]
    private int? _remainingPrints;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintButtonText))]
    [NotifyCanExecuteChangedFor(nameof(IncrementCopiesCommand), nameof(DecrementCopiesCommand))]
    private int _printCopies = 1;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(IncrementCopiesCommand))]
    private int _maxCopies = UnlimitedMaxCopies;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintSubtitle), nameof(HasPrintError))]
    private string _printError = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PrintSubtitle))]
    private string _printNotice = "";

    public bool HasPrintError => PrintError.Length > 0;

    /// <summary>
    /// Bloc d'impression : activé dans le SaaS et tirage autorisé à l'arrivée. Une fois la limite
    /// atteinte ici, il reste affiché (bouton grisé) pour ne pas déplacer les autres boutons.
    /// </summary>
    public bool ShowPrintBlock => _printEnabled && (CanPrint || _hasPrinted);

    /// <summary>« 10×15 » ou « 5×15 » (bandelette).</summary>
    public string PaperLabel => PaperFormat == "2x6" ? "bandelette 5×15" : "10×15";

    public string PrintButtonText =>
        IsPrinting ? "Impression…"
        : !CanPrint ? "Plus de tirage disponible"
        : PrintCopies > 1 ? $"Imprimer {PrintCopies} exemplaires" : "Imprimer 1 exemplaire";

    public string PrintSubtitle
    {
        get
        {
            if (PrintError.Length > 0) return PrintError;
            if (PrintNotice.Length > 0) return PrintNotice;
            var tirage = $"Tirage {PaperLabel}";
            if (!CanPrint) return $"{tirage} : limite atteinte pour cette photo";
            if (_showRemainingPrints && RemainingPrints is { } left)
                return left > 1 ? $"{tirage}, encore {left} tirages possibles" : $"{tirage}, encore 1 tirage possible";
            return $"{tirage}, prêt en quelques secondes";
        }
    }

    partial void OnPaperFormatChanged(string value)
    {
        OnPropertyChanged(nameof(PaperLabel));
        OnPropertyChanged(nameof(PrintSubtitle));
    }

    /// <summary>Sous-titre selon ce que la borne propose (impression, partage numérique, les deux).</summary>
    public string Subtitle => (ShowPrintBlock, ShowShareTiles) switch
    {
        (true, true)  => "Imprimez, envoyez ou récupérez vos photos.",
        (true, false) => "Imprimez votre photo en quelques secondes.",
        (false, true) => "Envoyez ou récupérez vos photos.",
        _             => "Votre photo est bien enregistrée.",
    };

    private async Task RefreshPrintStatusAsync()
    {
        if (_params == null) return;

        var remaining = await _print.GetRemainingPrintsAsync(
            _params.EventId, _params.MaxPrintsPerEvent,
            _params.SessionId, _params.MaxPrintsPerPhoto);

        RemainingPrints = remaining;
        CanPrint        = remaining is null or > 0;
        MaxCopies       = remaining is { } left ? Math.Clamp(left, 1, LimitedMaxCopies) : UnlimitedMaxCopies;
        PrintCopies     = Math.Clamp(PrintCopies, 1, MaxCopies);
        NotifyPrintBlockChanged();
    }

    private bool CanChangeCopies() => CanPrint && !IsPrinting;

    [RelayCommand(CanExecute = nameof(CanIncrementCopies))]
    private void IncrementCopies()
    {
        RegisterActivity();
        if (PrintCopies < MaxCopies) PrintCopies++;
    }

    private bool CanIncrementCopies() => CanChangeCopies() && PrintCopies < MaxCopies;

    [RelayCommand(CanExecute = nameof(CanDecrementCopies))]
    private void DecrementCopies()
    {
        RegisterActivity();
        if (PrintCopies > 1) PrintCopies--;
    }

    private bool CanDecrementCopies() => CanChangeCopies() && PrintCopies > 1;

    [RelayCommand(CanExecute = nameof(CanChangeCopies))]
    private async Task PrintAsync()
    {
        if (_params == null || IsPrinting || !CanPrint) return;
        RegisterActivity();

        var copies = Math.Clamp(PrintCopies, 1, MaxCopies);
        IsPrinting  = true;
        PrintError  = "";
        PrintNotice = "";
        try
        {
            await _print.PrintAsync(
                _params.CompositePath,
                _params.PrinterName,
                _params.PaperFormat,
                _params.SessionId,
                _params.EventId,
                copies,
                _photoPublicUrl);
            PrintNotice = copies > 1 ? "C'est parti ! Vos tirages arrivent." : "C'est parti ! Votre tirage arrive.";
            _ = ClearPrintMessagesAsync();
        }
        catch (Exception ex)
        {
            await _kioskLog.LogErrorAsync("print", ex.Message, ex.StackTrace);
            // Message dans le bloc d'impression : l'invité peut réessayer ou choisir le QR code.
            PrintError = ex switch
            {
                PrintBusyException => "Une impression est encore en cours. Patientez quelques instants.",
                TimeoutException   => "L'imprimante ne répond pas. Vérifiez le papier avant de réessayer.",
                _                  => "Impression indisponible. Réessayez ou utilisez le QR code.",
            };
            _ = ClearPrintMessagesAsync();
        }
        finally
        {
            _hasPrinted = true;
            // Aussi après un délai dépassé : l'impression envoyée est déjà comptée.
            try { await RefreshPrintStatusAsync(); }
            catch (Exception ex) { await _kioskLog.LogErrorAsync("print", ex.Message, ex.StackTrace); }
            IsPrinting = false;
            RegisterActivity();
        }
    }

    private async Task ClearPrintMessagesAsync()
    {
        await Task.Delay(6000);
        PrintError  = "";
        PrintNotice = "";
    }
}
