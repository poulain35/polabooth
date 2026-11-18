using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using PolaKiosk.Services;

namespace PolaKiosk.Views;

/// <summary>
/// Écran composé par l'admin (LAB-297, spec docs/specs/ecrans-borne-admin.md) : fond, une image par
/// bouton, textes vivants et emplacements, posés sur une surface 1920×1080 d'après le plan.
/// Le contrôle n'a aucune logique métier : les états des boutons, les textes et les images des
/// emplacements viennent du ViewModel, et un appui exécute <see cref="ActionCommand"/> avec le nom
/// de l'action (ou de l'emplacement touché).
/// </summary>
public partial class DesignedScreen : UserControl
{
    /// <summary>Voile des boutons grisés : crème #F7F1E7 à 60 % (spec, cas limites).</summary>
    public static readonly Color VeilColor = Color.FromRgb(0xF7, 0xF1, 0xE7);
    public const double VeilOpacity = 0.6;

    /// <summary>Taille de texte minimale, en proportion de la taille du dessin.</summary>
    private const double MinSizeRatio = 0.4;
    private const double LineFactor = 1.16;

    private static readonly CultureInfo French = CultureInfo.GetCultureInfo("fr-FR");

    private readonly Dictionary<string, (FrameworkElement Box, Button Button, Rectangle Veil)> _buttons = new(StringComparer.Ordinal);
    private readonly List<(ScreenText Spec, TextBlock Block, FrameworkElement Box)> _texts = [];
    private readonly Dictionary<string, (Rectangle Shape, ScreenSlot Spec)> _slots = new(StringComparer.Ordinal);

    public DesignedScreen()
    {
        InitializeComponent();
        ClipToBounds = true;
    }

    public static readonly DependencyProperty ContentModelProperty = DependencyProperty.Register(
        nameof(ContentModel), typeof(ScreenContent), typeof(DesignedScreen),
        new PropertyMetadata(null, (d, _) => ((DesignedScreen)d).Rebuild()));

    /// <summary>Écran à afficher (plan et images). Null : rien n'est dessiné.</summary>
    public ScreenContent? ContentModel
    {
        get => (ScreenContent?)GetValue(ContentModelProperty);
        set => SetValue(ContentModelProperty, value);
    }

    public static readonly DependencyProperty PersonalizedProperty = DependencyProperty.Register(
        nameof(Personalized), typeof(bool), typeof(DesignedScreen),
        new PropertyMetadata(true, (d, _) => ((DesignedScreen)d).ApplyBackgroundAndTexts()));

    /// <summary>Accueil personnalisé : fond complet et textes « personnalisé seulement » ; sinon fond neutre, textes masqués (D7).</summary>
    public bool Personalized
    {
        get => (bool)GetValue(PersonalizedProperty);
        set => SetValue(PersonalizedProperty, value);
    }

    public static readonly DependencyProperty UnderlayImageProperty = DependencyProperty.Register(
        nameof(UnderlayImage), typeof(ImageSource), typeof(DesignedScreen),
        new PropertyMetadata(null, (d, _) => ((DesignedScreen)d).ApplyBackgroundAndTexts()));

    /// <summary>Image de fond de l'événement, posée dessous si le fond du plan est transparent (D8).</summary>
    public ImageSource? UnderlayImage
    {
        get => (ImageSource?)GetValue(UnderlayImageProperty);
        set => SetValue(UnderlayImageProperty, value);
    }

    public static readonly DependencyProperty ActionStatesProperty = DependencyProperty.Register(
        nameof(ActionStates), typeof(IReadOnlyDictionary<string, ScreenActionState>), typeof(DesignedScreen),
        new PropertyMetadata(null, (d, _) => ((DesignedScreen)d).ApplyStates()));

    /// <summary>État de chaque action (absente : active).</summary>
    public IReadOnlyDictionary<string, ScreenActionState>? ActionStates
    {
        get => (IReadOnlyDictionary<string, ScreenActionState>?)GetValue(ActionStatesProperty);
        set => SetValue(ActionStatesProperty, value);
    }

    public static readonly DependencyProperty TextValuesProperty = DependencyProperty.Register(
        nameof(TextValues), typeof(IReadOnlyDictionary<string, string>), typeof(DesignedScreen),
        new PropertyMetadata(null, (d, _) => ((DesignedScreen)d).ApplyBackgroundAndTexts()));

    /// <summary>Valeur de chaque texte vivant (absente ou vide : texte masqué).</summary>
    public IReadOnlyDictionary<string, string>? TextValues
    {
        get => (IReadOnlyDictionary<string, string>?)GetValue(TextValuesProperty);
        set => SetValue(TextValuesProperty, value);
    }

    public static readonly DependencyProperty SlotImagesProperty = DependencyProperty.Register(
        nameof(SlotImages), typeof(IReadOnlyDictionary<string, ImageSource?>), typeof(DesignedScreen),
        new PropertyMetadata(null, (d, _) => ((DesignedScreen)d).ApplySlots()));

    /// <summary>Image de chaque emplacement (absente : emplacement vide, le fond reste visible).</summary>
    public IReadOnlyDictionary<string, ImageSource?>? SlotImages
    {
        get => (IReadOnlyDictionary<string, ImageSource?>?)GetValue(SlotImagesProperty);
        set => SetValue(SlotImagesProperty, value);
    }

    public static readonly DependencyProperty ActionCommandProperty = DependencyProperty.Register(
        nameof(ActionCommand), typeof(ICommand), typeof(DesignedScreen));

    /// <summary>Commande lancée par un bouton (paramètre : l'action) ou un emplacement touché (paramètre : l'emplacement).</summary>
    public ICommand? ActionCommand
    {
        get => (ICommand?)GetValue(ActionCommandProperty);
        set => SetValue(ActionCommandProperty, value);
    }

    /// <summary>Boîte d'un bouton dans la surface (tests).</summary>
    internal FrameworkElement? ButtonBox(string action) => _buttons.TryGetValue(action, out var b) ? b.Box : null;

    /// <summary>Bouton d'une action (tests).</summary>
    internal Button? ButtonOf(string action) => _buttons.TryGetValue(action, out var b) ? b.Button : null;

    /// <summary>Voile d'une action (tests).</summary>
    internal Rectangle? VeilOf(string action) => _buttons.TryGetValue(action, out var b) ? b.Veil : null;

    /// <summary>Bloc de texte d'une variable (tests).</summary>
    internal TextBlock? TextOf(string variable) => _texts.FirstOrDefault(t => t.Spec.Variable == variable).Block;

    /// <summary>Forme d'un emplacement (tests).</summary>
    internal Rectangle? SlotOf(string slot) => _slots.TryGetValue(slot, out var s) ? s.Shape : null;

    internal Canvas SurfaceCanvas => Surface;

    // ── Construction ──

    private void Rebuild()
    {
        Items.Children.Clear();
        _buttons.Clear();
        _texts.Clear();
        _slots.Clear();

        var content = ContentModel;
        if (content is null)
        {
            BackgroundImage.Source = null;
            Underlay.Source = null;
            return;
        }

        // Ordre de dessin : emplacements, textes, puis boutons (toujours au-dessus, donc touchables).
        foreach (var slot in content.Layout.Slots) AddSlot(slot);
        foreach (var text in content.Layout.Texts) AddText(text, content.FontFor(text));
        foreach (var button in content.Layout.Buttons)
            if (content.ButtonImages.TryGetValue(button.Action, out var image)) AddButton(button, image);

        ApplyBackgroundAndTexts();
        ApplyStates();
        ApplySlots();
    }

    private void AddButton(ScreenButton spec, ImageSource image)
    {
        var button = new Button
        {
            Style = (Style)Resources["DesignedButton"],
            Content = new Image { Source = image, Stretch = Stretch.Fill },
            Tag = spec.Action,
        };
        button.Click += OnButtonClick;

        // Voile des boutons grisés : épouse la forme du bouton (masque = son image) et absorbe le
        // toucher, pour qu'un bouton indisponible ne lance pas non plus l'action de l'écran dessous.
        var veil = new Rectangle
        {
            Fill = new SolidColorBrush(VeilColor),
            Opacity = VeilOpacity,
            OpacityMask = new ImageBrush(image) { Stretch = Stretch.Fill },
            Visibility = Visibility.Collapsed,
        };
        veil.MouseDown += (_, e) => e.Handled = true;
        veil.TouchDown += (_, e) => e.Handled = true;
        veil.StylusDown += (_, e) => e.Handled = true;

        var box = new Grid { Width = spec.W, Height = spec.H, Background = null, Children = { button, veil } };
        Place(box, spec.X, spec.Y);
        Items.Children.Add(box);
        _buttons[spec.Action] = (box, button, veil);
    }

    // La police du bloc sert aussi à la mesure (Fit) : affichage et réduction suivent la même police.
    private void AddText(ScreenText spec, ScreenFont font)
    {
        var block = new TextBlock
        {
            FontFamily = font.Family,
            FontWeight = FontWeight.FromOpenTypeWeight(font.Weight),
            Foreground = new SolidColorBrush(ParseColor(spec.Color)),
            TextAlignment = spec.Align switch { "center" => TextAlignment.Center, "right" => TextAlignment.Right, _ => TextAlignment.Left },
            TextWrapping = spec.MaxLines > 1 ? TextWrapping.Wrap : TextWrapping.NoWrap,
            TextTrimming = TextTrimming.CharacterEllipsis,
            LineStackingStrategy = LineStackingStrategy.BlockLineHeight,
            VerticalAlignment = VerticalAlignment.Center,
            Width = spec.W,
        };
        var box = new Grid
        {
            Width = spec.W, Height = spec.H, IsHitTestVisible = false, ClipToBounds = false,
            RenderTransformOrigin = new Point(0.5, 0.5),
            RenderTransform = new RotateTransform(spec.Angle),
            Children = { block },
        };
        Place(box, spec.X, spec.Y);
        Items.Children.Add(box);
        _texts.Add((spec, block, box));
    }

    private void AddSlot(ScreenSlot spec)
    {
        var shape = new Rectangle
        {
            Width = spec.W, Height = spec.H, RadiusX = spec.Radius, RadiusY = spec.Radius,
            RenderTransformOrigin = new Point(0.5, 0.5),
            RenderTransform = new RotateTransform(spec.Angle),
            Fill = Brushes.Transparent,
            Tag = spec.Slot,
        };
        shape.MouseLeftButtonDown += OnSlotTapped;
        Place(shape, spec.X, spec.Y);
        Items.Children.Add(shape);
        _slots[spec.Slot] = (shape, spec);
    }

    private static void Place(UIElement element, double x, double y)
    {
        Canvas.SetLeft(element, x);
        Canvas.SetTop(element, y);
    }

    // ── Mise à jour ──

    private void ApplyBackgroundAndTexts()
    {
        var content = ContentModel;
        if (content is null) return;

        bool personalized = Personalized;
        BackgroundImage.Source = content.BackgroundFor(personalized);
        Underlay.Source = content.Layout.TransparentBackground ? UnderlayImage : null;

        var values = TextValues;
        double pixelsPerDip = VisualTreeHelper.GetDpi(this).PixelsPerDip;
        foreach (var (spec, block, box) in _texts)
        {
            var value = values != null && values.TryGetValue(spec.Variable, out var v) ? v : null;
            bool visible = !string.IsNullOrWhiteSpace(value) && (personalized || !spec.PersonalizedOnly);
            box.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
            if (!visible) continue;

            var text = DisplayText(value!, spec);
            if (block.Text == text) continue;
            block.Text = text;
            Fit(block, spec, pixelsPerDip);
        }
    }

    /// <summary>Texte tel qu'affiché : majuscules et espacement des lettres du dessin.</summary>
    internal static string DisplayText(string value, ScreenText spec)
    {
        var text = value.Trim();
        if (spec.Uppercase) text = text.ToUpper(French);
        // char_spacing en millièmes de cadratin (Fabric) ; une espace fine vaut environ 1/5 de cadratin.
        int spaces = (int)Math.Round(spec.CharSpacing / 200, MidpointRounding.AwayFromZero);
        return spaces > 0 ? string.Join(new string(' ', spaces), text.EnumerateRunes()) : text;
    }

    private static void Fit(TextBlock block, ScreenText spec, double pixelsPerDip)
    {
        var typeface = new Typeface(block.FontFamily, FontStyles.Normal, block.FontWeight, FontStretches.Normal);
        double minSize = Math.Max(8, Math.Round(spec.Size * MinSizeRatio));
        double size = TextFit.FitFontSize(block.Text, typeface, spec.Size, minSize, LineFactor, spec.W,
            spec.MaxLines, pixelsPerDip, maxHeight: spec.H);
        double lineHeight = Math.Round(size * LineFactor);
        block.FontSize = size;
        block.LineHeight = lineHeight;
        block.MaxHeight = spec.MaxLines * lineHeight; // au-delà, le texte est coupé avec « … »
    }

    private void ApplyStates()
    {
        var states = ActionStates;
        foreach (var (action, (box, button, veil)) in _buttons)
        {
            var state = states != null && states.TryGetValue(action, out var s) ? s : ScreenActionState.Active;
            box.Visibility = state == ScreenActionState.Hidden ? Visibility.Collapsed : Visibility.Visible;
            button.IsEnabled = state == ScreenActionState.Active;
            veil.Visibility = state == ScreenActionState.Disabled ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    private void ApplySlots()
    {
        var images = SlotImages;
        foreach (var (slot, (shape, _)) in _slots)
        {
            var image = images != null && images.TryGetValue(slot, out var i) ? i : null;
            shape.Fill = image is null
                ? Brushes.Transparent
                : new ImageBrush(image) { Stretch = Stretch.UniformToFill, AlignmentX = AlignmentX.Center, AlignmentY = AlignmentY.Center };
        }
    }

    // ── Toucher ──

    private void OnButtonClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string action }) Run(action);
    }

    private void OnSlotTapped(object sender, MouseButtonEventArgs e)
    {
        if (sender is not Rectangle { Tag: string slot }) return;
        if (Run(slot)) e.Handled = true;
    }

    private bool Run(string parameter)
    {
        var command = ActionCommand;
        if (command is null || !command.CanExecute(parameter)) return false;
        command.Execute(parameter);
        return true;
    }

    private static Color ParseColor(string hex)
    {
        try { return (Color)ColorConverter.ConvertFromString(hex); }
        catch { return Color.FromRgb(0x1B, 0x24, 0x1F); }
    }
}
