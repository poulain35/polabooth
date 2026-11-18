using System.ComponentModel;
using System.Windows.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

// Écran résultat : partage composé par l'admin (LAB-297), à la place de l'écran de partage standard.
public partial class ResultViewModel
{
    /// <summary>Écran de partage de l'organisation en cache, images décodées ; null : écran standard.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowDesignedShare), nameof(ShowStandardShare), nameof(SharePrintBanner), nameof(HasSharePrintBanner))]
    private ScreenContent? _designedShare;

    public bool ShowDesignedShare => IsShareScreen && DesignedShare != null;
    public bool ShowStandardShare => IsShareScreen && DesignedShare == null;

    private ShareScreenInputs ShareInputs => new(
        ShowPrintBlock, CanPrint, IsPrinting, PrintCopies, MaxCopies,
        ShowEmailTile, ShowQrTile, IsShareReady, ShowRetake, ShowFinish,
        _showRemainingPrints, RemainingPrints,
        ShareScreenState.PrintStatus(IsPrinting, PrintError, PrintNotice, CanPrint),
        ShowCountdown, AutoHomeSecondsLeft, ShareStatus);

    public IReadOnlyDictionary<string, ScreenActionState> ShareActionStates => ShareScreenState.Actions(ShareInputs);
    public IReadOnlyDictionary<string, string> ShareTexts => ShareScreenState.Texts(ShareInputs);

    /// <summary>Bandeau d'impression en haut de l'écran composé, quand l'admin n'a pas posé <c>print_status</c> (D9).</summary>
    public string SharePrintBanner => DesignedShare is not { } screen ? ""
        : ShareScreenState.PrintBanner(screen.Layout.Texts.Any(t => t.Variable == "print_status"), ShareInputs);

    public bool HasSharePrintBanner => ShowDesignedShare && SharePrintBanner.Length > 0;

    /// <summary><c>photo_preview</c> : le montage de la séance.</summary>
    public IReadOnlyDictionary<string, ImageSource?> ShareSlots => new Dictionary<string, ImageSource?>
    {
        ["photo_preview"] = CompositeImage,
    };

    // Ce qui change l'état d'un bouton, un texte vivant ou l'emplacement de l'écran composé.
    private static readonly HashSet<string> ShareStateInputs = new(StringComparer.Ordinal)
    {
        nameof(ShowPrintBlock), nameof(CanPrint), nameof(IsPrinting), nameof(PrintCopies), nameof(MaxCopies),
        nameof(RemainingPrints), nameof(PrintError), nameof(PrintNotice),
        nameof(ShowEmailTile), nameof(ShowQrTile), nameof(IsShareReady), nameof(ShareStatus),
        nameof(ShowRetake), nameof(ShowFinish), nameof(AutoHomeSecondsLeft), nameof(ShowCountdown),
        nameof(CompositeImage),
    };

    protected override void OnPropertyChanged(PropertyChangedEventArgs e)
    {
        base.OnPropertyChanged(e);
        if (e.PropertyName is not { } name || !ShareStateInputs.Contains(name)) return;
        base.OnPropertyChanged(new PropertyChangedEventArgs(nameof(ShareActionStates)));
        base.OnPropertyChanged(new PropertyChangedEventArgs(nameof(ShareTexts)));
        base.OnPropertyChanged(new PropertyChangedEventArgs(nameof(SharePrintBanner)));
        base.OnPropertyChanged(new PropertyChangedEventArgs(nameof(HasSharePrintBanner)));
        if (name == nameof(CompositeImage)) base.OnPropertyChanged(new PropertyChangedEventArgs(nameof(ShareSlots)));
        ShareActionCommand.NotifyCanExecuteChanged();
    }

    /// <summary>
    /// Bouton de l'écran de partage composé : mêmes commandes que l'écran standard. Un bouton grisé
    /// (photo pas encore envoyée, plus de tirage, impression en cours) ne fait rien.
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanRunShareAction))]
    private void ShareAction(string? action)
    {
        if (!CanRunShareAction(action)) return;
        switch (action)
        {
            case "print":        PrintCommand.Execute(null); break;
            case "copies_minus": DecrementCopies(); break;
            case "copies_plus":  IncrementCopies(); break;
            case "email":        OpenEmail(); break;
            case "qr":           OpenQr(); break;
            case "retake":       Retake(); break;
            case "finish":       GoHome(); break;
        }
    }

    private bool CanRunShareAction(string? action)
        => action != null && ShareActionStates.TryGetValue(action, out var state) && state == ScreenActionState.Active;
}
