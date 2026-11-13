using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Threading;

namespace PolaKiosk.Controls;

/// <summary>
/// Clavier tactile intégré : écrit directement dans le champ <see cref="Target"/> (au curseur), sans
/// envoyer de vraies touches au système. Il fonctionne donc avec la fenêtre au premier plan et le hook
/// clavier du mode kiosk. Utiliser un <see cref="KioskTextBox"/> comme cible pour que le clavier
/// Windows ne s'ouvre pas. La logique d'édition est dans <see cref="TouchKeyboardEditor"/>.
/// </summary>
public partial class TouchKeyboard : UserControl
{
    public static readonly DependencyProperty TargetProperty = DependencyProperty.Register(
        nameof(Target), typeof(TextBox), typeof(TouchKeyboard),
        new PropertyMetadata(null, (d, e) => ((TouchKeyboard)d).OnTargetChanged((TextBox?)e.OldValue, (TextBox?)e.NewValue)));

    public static readonly DependencyProperty LayoutProperty = DependencyProperty.Register(
        nameof(Layout), typeof(TouchKeyboardLayout), typeof(TouchKeyboard),
        new PropertyMetadata(TouchKeyboardLayout.Text, (d, _) => ((TouchKeyboard)d).BuildKeys()));

    public static readonly DependencyProperty EnterCommandProperty = DependencyProperty.Register(
        nameof(EnterCommand), typeof(ICommand), typeof(TouchKeyboard),
        new PropertyMetadata(null, (d, e) => ((TouchKeyboard)d).OnEnterCommandChanged((ICommand?)e.OldValue, (ICommand?)e.NewValue)));

    public static readonly DependencyProperty EnterLabelProperty = DependencyProperty.Register(
        nameof(EnterLabel), typeof(string), typeof(TouchKeyboard),
        new PropertyMetadata("Valider", (d, _) => ((TouchKeyboard)d).RefreshKeys()));

    /// <summary>Champ dans lequel le clavier écrit.</summary>
    public TextBox? Target
    {
        get => (TextBox?)GetValue(TargetProperty);
        set => SetValue(TargetProperty, value);
    }

    public TouchKeyboardLayout Layout
    {
        get => (TouchKeyboardLayout)GetValue(LayoutProperty);
        set => SetValue(LayoutProperty, value);
    }

    /// <summary>Commande de la touche de validation (désactivée tant que la commande ne peut pas s'exécuter).</summary>
    public ICommand? EnterCommand
    {
        get => (ICommand?)GetValue(EnterCommandProperty);
        set => SetValue(EnterCommandProperty, value);
    }

    public string EnterLabel
    {
        get => (string)GetValue(EnterLabelProperty);
        set => SetValue(EnterLabelProperty, value);
    }

    private readonly TouchKeyboardEditor _editor = new();
    private readonly List<(ButtonBase Button, TouchKey Key)> _keys = [];
    private StackPanel? _suggestionsRow;
    private IReadOnlyList<string> _suggestions = [];

    public TouchKeyboard()
    {
        InitializeComponent();
        BuildKeys();
        IsVisibleChanged += (_, e) =>
        {
            if (e.NewValue is true) Dispatcher.InvokeAsync(OnShown, DispatcherPriority.Input);
        };
    }

    private void BuildKeys()
    {
        RowsPanel.Children.Clear();
        _keys.Clear();
        _suggestionsRow = null;
        _suggestions = [];

        if (TouchKeyboardLayouts.HasDomainSuggestions(Layout))
        {
            _suggestionsRow = NewRow();
            _suggestionsRow.MinHeight = TouchKeyboardLayouts.KeyUnit;
            RowsPanel.Children.Add(_suggestionsRow);
        }

        foreach (var row in TouchKeyboardLayouts.Rows(Layout))
        {
            var panel = NewRow();
            foreach (var key in row)
            {
                var button = CreateKey(key);
                _keys.Add((button, key));
                panel.Children.Add(button);
            }
            RowsPanel.Children.Add(panel);
        }

        RefreshKeys();
        RefreshSuggestions();
    }

    private static StackPanel NewRow() => new() { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center };

    private ButtonBase CreateKey(TouchKey key)
    {
        // Effacer se répète tant qu'on garde le doigt dessus.
        ButtonBase button = key.Action == TouchKeyAction.Backspace
            ? new RepeatButton { Delay = 450, Interval = 70 }
            : new Button();

        button.Width = key.Width * TouchKeyboardLayouts.KeyUnit - 2 * TouchKeyboardLayouts.KeyMargin;
        button.Height = TouchKeyboardLayouts.KeyUnit - 2 * TouchKeyboardLayouts.KeyMargin;
        button.Margin = new Thickness(TouchKeyboardLayouts.KeyMargin);
        button.Click += (_, _) => Press(key);
        return button;
    }

    private void Press(TouchKey key)
    {
        switch (key.Action)
        {
            case TouchKeyAction.Enter:
                if (EnterCommand?.CanExecute(null) == true) EnterCommand.Execute(null);
                return;
            case TouchKeyAction.Shift:
                _editor.ToggleShift();
                RefreshKeys();
                FocusTarget();
                return;
        }

        var target = Target;
        if (target == null) return;

        _editor.MaxLength = target.MaxLength;
        _editor.Sync(target.Text, target.SelectionStart, target.SelectionLength);
        var changed = key.Action switch
        {
            TouchKeyAction.Insert => _editor.Insert(key.Value),
            TouchKeyAction.Domain => _editor.ApplyEmailDomain(key.Value),
            TouchKeyAction.Backspace => _editor.Backspace(),
            _ => false,
        };

        FocusTarget();
        if (changed)
        {
            // SetCurrentValue garde la liaison du champ et met à jour le ViewModel.
            target.SetCurrentValue(TextBox.TextProperty, _editor.Text);
            target.Select(_editor.CaretIndex, 0);
        }
        RefreshKeys();
    }

    private void RefreshKeys()
    {
        foreach (var (button, key) in _keys)
        {
            button.Content = key.Action == TouchKeyAction.Enter ? EnterLabel : _editor.Caption(key);
            button.Style = (Style)FindResource(StyleFor(key));
        }
        RefreshEnterState();
    }

    private string StyleFor(TouchKey key) => key.Action switch
    {
        TouchKeyAction.Enter => "TouchKeyEnter",
        TouchKeyAction.Shift when _editor.IsShiftActive => "TouchKeyActive",
        TouchKeyAction.Insert when key.Value.Length > 1 => "TouchKeySmall",
        TouchKeyAction.Insert when key.Value == " " => "TouchKeySmall",
        _ => "TouchKey",
    };

    private void RefreshSuggestions()
    {
        if (_suggestionsRow == null) return;

        var suggestions = EmailDomainSuggestions.Suggest(Target?.Text ?? "", TouchKeyboardLayouts.DomainSuggestionCount);
        if (suggestions.SequenceEqual(_suggestions)) return;
        _suggestions = suggestions;

        _suggestionsRow.Children.Clear();
        foreach (var domain in suggestions)
        {
            var key = TouchKeyboardLayouts.Domain(domain);
            var button = CreateKey(key);
            button.Content = key.Caption;
            button.Style = (Style)FindResource("TouchKeySmall");
            _suggestionsRow.Children.Add(button);
        }
    }

    private void RefreshEnterState()
    {
        var enabled = EnterCommand?.CanExecute(null) == true;
        foreach (var (button, key) in _keys)
            if (key.Action == TouchKeyAction.Enter) button.IsEnabled = enabled;
    }

    // Le focus reste dans le champ pour y afficher le curseur (les touches ne sont pas focusables).
    private void FocusTarget()
    {
        var target = Target;
        if (target != null && target.IsVisible && !target.IsKeyboardFocused) target.Focus();
    }

    private void OnShown()
    {
        _editor.ResetShift();
        RefreshKeys();
        FocusTarget();
        Target?.Select(Target.Text.Length, 0);
    }

    private void OnTargetChanged(TextBox? oldTarget, TextBox? newTarget)
    {
        if (oldTarget != null) oldTarget.TextChanged -= OnTargetTextChanged;
        if (newTarget != null) newTarget.TextChanged += OnTargetTextChanged;
        RefreshSuggestions();
    }

    private void OnTargetTextChanged(object sender, TextChangedEventArgs e) => RefreshSuggestions();

    private void OnEnterCommandChanged(ICommand? oldCommand, ICommand? newCommand)
    {
        if (oldCommand != null) oldCommand.CanExecuteChanged -= OnEnterCanExecuteChanged;
        if (newCommand != null) newCommand.CanExecuteChanged += OnEnterCanExecuteChanged;
        RefreshEnterState();
    }

    private void OnEnterCanExecuteChanged(object? sender, EventArgs e) => RefreshEnterState();
}
