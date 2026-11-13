using System.Runtime.ExceptionServices;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using CommunityToolkit.Mvvm.Input;
using FluentAssertions;
using PolaKiosk.Controls;

namespace PolaKiosk.Tests.Controls;

// LAB-218 : le clavier écrit dans le champ lié (jamais de vraie touche système)
// et le champ ne se présente pas comme un champ d'édition au clavier tactile Windows.
public class TouchKeyboardControlTests
{
    private sealed class EmailForm
    {
        public string Email { get; set; } = "";
    }

    private static void RunSta(Action action)
    {
        ExceptionDispatchInfo? error = null;
        var thread = new Thread(() =>
        {
            try { action(); }
            catch (Exception ex) { error = ExceptionDispatchInfo.Capture(ex); }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        error?.Throw();
    }

    private static List<ButtonBase> Buttons(TouchKeyboard keyboard) =>
        keyboard.RowsPanel.Children.OfType<StackPanel>()
            .SelectMany(row => row.Children.OfType<ButtonBase>())
            .ToList();

    private static ButtonBase Key(TouchKeyboard keyboard, string caption) =>
        Buttons(keyboard).First(b => (string)b.Content == caption);

    private static void Tap(ButtonBase button) => button.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent, button));

    [Fact]
    public void The_kiosk_field_exposes_no_text_pattern_unlike_a_standard_text_box() => RunSta(() =>
    {
        var kioskPeer = UIElementAutomationPeer.CreatePeerForElement(new KioskTextBox());
        kioskPeer.GetPattern(PatternInterface.Text).Should().BeNull();
        kioskPeer.GetPattern(PatternInterface.Value).Should().BeNull();
        kioskPeer.GetAutomationControlType().Should().NotBe(AutomationControlType.Edit);

        var standardPeer = UIElementAutomationPeer.CreatePeerForElement(new TextBox());
        standardPeer.GetAutomationControlType().Should().Be(AutomationControlType.Edit);
    });

    [Fact]
    public void Keys_write_into_the_bound_field_and_its_source() => RunSta(() =>
    {
        var form = new EmailForm();
        var box = new KioskTextBox();
        box.SetBinding(TextBox.TextProperty, new Binding(nameof(EmailForm.Email))
        {
            Source = form, Mode = BindingMode.TwoWay, UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged,
        });
        var keyboard = new TouchKeyboard { Layout = TouchKeyboardLayout.Email, Target = box };

        Tap(Key(keyboard, "j"));
        Tap(Key(keyboard, "o"));
        Tap(Key(keyboard, "@gmail.com"));

        box.Text.Should().Be("jo@gmail.com");
        form.Email.Should().Be("jo@gmail.com");

        Tap(Key(keyboard, "⌫"));
        form.Email.Should().Be("jo@gmail.co");
    });

    [Fact]
    public void Domain_suggestions_follow_the_field() => RunSta(() =>
    {
        var box = new KioskTextBox();
        var keyboard = new TouchKeyboard { Layout = TouchKeyboardLayout.Email, Target = box };
        var suggestions = (StackPanel)keyboard.RowsPanel.Children[0];

        suggestions.Children.Count.Should().Be(TouchKeyboardLayouts.DomainSuggestionCount);

        box.Text = "jean@hot";
        suggestions.Children.OfType<ButtonBase>().Select(b => (string)b.Content)
            .Should().Equal("@hotmail.fr", "@hotmail.com");
    });

    [Fact]
    public void Enter_runs_the_command_and_is_disabled_when_it_cannot_run() => RunSta(() =>
    {
        var canSend = false;
        var sent = 0;
        var command = new RelayCommand(() => sent++, () => canSend);
        var keyboard = new TouchKeyboard
        {
            Layout = TouchKeyboardLayout.Phone, Target = new KioskTextBox(), EnterCommand = command, EnterLabel = "Envoyer",
        };
        var enter = Key(keyboard, "Envoyer");

        enter.IsEnabled.Should().BeFalse();

        canSend = true;
        command.NotifyCanExecuteChanged();
        enter.IsEnabled.Should().BeTrue();
        Tap(enter);
        sent.Should().Be(1);
    });

    [Fact]
    public void Shift_changes_the_captions_of_the_text_layout() => RunSta(() =>
    {
        var box = new KioskTextBox();
        var keyboard = new TouchKeyboard { Layout = TouchKeyboardLayout.Text, Target = box };

        Tap(Key(keyboard, "⇧"));
        Tap(Key(keyboard, "É"));
        Key(keyboard, "a").Should().NotBeNull();

        box.Text.Should().Be("É");
    });
}
