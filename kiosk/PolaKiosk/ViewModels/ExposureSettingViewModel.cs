using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Models;

namespace PolaKiosk.ViewModels;

/// <summary>Logique pure des boutons − / + et du curseur d'un réglage : position bornée dans la liste.</summary>
public static class ExposureStepper
{
    /// <summary>Position après un appui (<paramref name="delta"/> = −1 ou +1), bornée à la liste.</summary>
    public static int Step(int index, int count, int delta)
        => count <= 0 ? 0 : Math.Clamp(index + delta, 0, count - 1);

    /// <summary>
    /// Position de <paramref name="code"/> dans la liste ; absent, la plus proche par code (les codes Canon
    /// suivent l'ordre des valeurs) ; pas de valeur ou liste vide : 0.
    /// </summary>
    public static int IndexFor(IReadOnlyList<CameraOption> options, int? code)
    {
        if (options.Count == 0 || code is not int c) return 0;
        var best = 0;
        for (var i = 0; i < options.Count; i++)
        {
            if (options[i].Code == c) return i;
            if (Math.Abs((long)options[i].Code - c) < Math.Abs((long)options[best].Code - c)) best = i;
        }
        return best;
    }
}

/// <summary>Une ligne de l'écran Appareil photo : libellé, valeur, curseur, boutons − et +.</summary>
public partial class ExposureSettingViewModel : ObservableObject
{
    private readonly Action<string, int> _requestChange;
    private bool _updating;

    public ExposureSettingViewModel(string key, string title, Action<string, int> requestChange)
    {
        Key            = key;
        Title          = title;
        _requestChange = requestChange;
    }

    /// <summary>Clé de <see cref="CameraExposureKeys"/>.</summary>
    public string Key { get; }

    public string Title { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(MaxIndex), nameof(ValueLabel), nameof(CanDecrement), nameof(CanIncrement))]
    private IReadOnlyList<CameraOption> _options = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ValueLabel), nameof(CanDecrement), nameof(CanIncrement))]
    private int _selectedIndex;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanDecrement), nameof(CanIncrement))]
    private bool _isEnabled;

    [ObservableProperty] private bool _isVisible = true;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasWarning))]
    private string _warning = "";

    public bool HasWarning => Warning.Length > 0;

    public int MaxIndex => Math.Max(0, Options.Count - 1);

    public string ValueLabel => SelectedIndex >= 0 && SelectedIndex < Options.Count ? Options[SelectedIndex].Label : "—";

    public bool CanDecrement => IsEnabled && SelectedIndex > 0;

    public bool CanIncrement => IsEnabled && SelectedIndex < Options.Count - 1;

    /// <summary>Code Canon de la valeur affichée ; null si la liste est vide.</summary>
    public int? SelectedCode => SelectedIndex >= 0 && SelectedIndex < Options.Count ? Options[SelectedIndex].Code : null;

    [RelayCommand]
    private void Decrement() => SelectedIndex = ExposureStepper.Step(SelectedIndex, Options.Count, -1);

    [RelayCommand]
    private void Increment() => SelectedIndex = ExposureStepper.Step(SelectedIndex, Options.Count, +1);

    /// <summary>
    /// Valeurs relues sur l'appareil : affichées sans être renvoyées. Valeur actuelle hors de la liste
    /// permise (ou liste vide) : ajoutée pour être visible.
    /// </summary>
    public void Update(IReadOnlyList<CameraOption> options, int? currentCode, bool enabled)
    {
        _updating = true;
        try
        {
            var list = options;
            if (currentCode is int code && options.All(o => o.Code != code))
            {
                var current = new CameraOption(code, Services.CanonExposure.Label(Key, code));
                list = options.Count == 0 ? [current] : options;
            }
            Options       = list;
            SelectedIndex = ExposureStepper.IndexFor(list, currentCode);
            IsEnabled     = enabled && list.Count > 1;
        }
        finally { _updating = false; }
    }

    partial void OnSelectedIndexChanged(int value)
    {
        if (_updating || !IsEnabled || value < 0 || value >= Options.Count) return;
        _requestChange(Key, Options[value].Code);
    }
}
