using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Controls;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Une question du questionnaire, telle que saisie par l'invité : texte, tuiles ou case, avec la
/// vérification en direct (<see cref="GuestAnswerValidator"/>). Rien ne quitte la mémoire.
/// </summary>
public partial class QuestionItemViewModel : ObservableObject
{
    public QuestionConfig Config { get; }

    /// <summary>Obligatoire pour valider (une case à cocher ne l'est jamais).</summary>
    public bool IsRequired { get; }
    public string Label { get; }
    public bool IsTextInput  => QuestionTypes.IsTextInput(Config.Type);
    public bool IsChoice     => QuestionTypes.IsChoice(Config.Type);
    public bool IsCheckbox   => Config.Type == QuestionTypes.Checkbox;
    public bool IsMulti      => Config.Type == QuestionTypes.Multi;

    /// <summary>Aide affichée sous le libellé des questions à choix.</summary>
    public string ChoiceHint => IsMulti ? "Plusieurs réponses possibles" : "Une seule réponse";

    public TouchKeyboardLayout KeyboardLayout => Config.Type switch
    {
        QuestionTypes.Email => TouchKeyboardLayout.Email,
        QuestionTypes.Tel   => TouchKeyboardLayout.Phone,
        _                   => TouchKeyboardLayout.Text,
    };

    public int MaxLength => Config.Type switch
    {
        QuestionTypes.Email => 254,
        QuestionTypes.Tel   => 20,
        _                   => GuestAnswerValidator.MaxTextLength,
    };

    public ObservableCollection<OptionItemViewModel> Options { get; } = new();

    [ObservableProperty] private string _text = "";
    [ObservableProperty] private bool _isChecked;
    [ObservableProperty] private string? _error;
    [ObservableProperty] private string? _suggestion;
    [ObservableProperty] private bool _canContinue;

    /// <summary>Valeur normalisée à garder (null si la question est laissée vide).</summary>
    public object? Value { get; private set; }

    /// <summary>Déclenché quand <see cref="CanContinue"/> peut avoir changé (« Suivant »).</summary>
    public event EventHandler? AnswerChanged;

    public QuestionItemViewModel(QuestionConfig config)
    {
        Config     = config;
        IsRequired = config.Required && config.Type != QuestionTypes.Checkbox;
        Label      = config.Label;
        foreach (var option in config.Options)
            Options.Add(new OptionItemViewModel(option, Toggle));
        Revalidate();
    }

    public string? SuggestionText => Suggestion == null ? null : $"Vouliez-vous dire {Suggestion} ?";
    public bool HasSuggestion => Suggestion != null;

    partial void OnTextChanged(string value) => Revalidate();
    partial void OnIsCheckedChanged(bool value) => Revalidate();
    partial void OnSuggestionChanged(string? value)
    {
        OnPropertyChanged(nameof(SuggestionText));
        OnPropertyChanged(nameof(HasSuggestion));
    }

    [RelayCommand]
    private void ToggleChecked() => IsChecked = !IsChecked;

    /// <summary>Remplace le domaine de l'e-mail par la suggestion (jamais appliquée d'office).</summary>
    [RelayCommand]
    private void ApplySuggestion()
    {
        if (Suggestion != null) Text = GuestAnswerValidator.ApplyDomain(Text.Trim(), Suggestion);
    }

    private void Toggle(OptionItemViewModel option)
    {
        if (IsMulti)
            option.IsSelected = !option.IsSelected;
        else
            foreach (var o in Options) o.IsSelected = ReferenceEquals(o, option) && !o.IsSelected;
        Revalidate();
    }

    /// <summary>Efface la saisie (« Passer », abandon) : rien n'est gardé.</summary>
    public void Clear()
    {
        Text = "";
        IsChecked = false;
        foreach (var o in Options) o.IsSelected = false;
        Revalidate();
    }

    private void Revalidate()
    {
        var selected = Options.Where(o => o.IsSelected).Select(o => o.Label).ToList();
        var check = GuestAnswerValidator.Check(Config, new GuestAnswerInput(Text, selected, IsChecked));
        Value       = check.Value;
        Error       = check.Error;
        Suggestion  = check.Suggestion;
        CanContinue = check.CanContinue;
        AnswerChanged?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>Tuile d'une question à choix.</summary>
public partial class OptionItemViewModel : ObservableObject
{
    private readonly Action<OptionItemViewModel> _toggle;

    public string Label { get; }

    [ObservableProperty] private bool _isSelected;

    public OptionItemViewModel(string label, Action<OptionItemViewModel> toggle)
    {
        Label   = label;
        _toggle = toggle;
    }

    [RelayCommand]
    private void Toggle() => _toggle(this);
}
