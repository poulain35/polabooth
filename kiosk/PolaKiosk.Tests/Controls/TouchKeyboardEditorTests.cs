using FluentAssertions;
using PolaKiosk.Controls;

namespace PolaKiosk.Tests.Controls;

// LAB-218 : logique du clavier tactile intégré (insertion au curseur, effacement, majuscule, domaines).
public class TouchKeyboardEditorTests
{
    private static TouchKeyboardEditor Editor(string text, int caret, int selection = 0, int maxLength = 0)
    {
        var editor = new TouchKeyboardEditor { MaxLength = maxLength };
        editor.Sync(text, caret, selection);
        return editor;
    }

    [Fact]
    public void Inserts_at_the_caret_and_moves_it_after_the_text()
    {
        var editor = Editor("jen", 2);

        editor.Insert("a").Should().BeTrue();

        editor.Text.Should().Be("jean");
        editor.CaretIndex.Should().Be(3);
    }

    [Fact]
    public void A_shortcut_is_inserted_whole_at_the_caret()
    {
        var editor = Editor("jean@gmail", 10);

        editor.Insert(".com");

        editor.Text.Should().Be("jean@gmail.com");
        editor.CaretIndex.Should().Be(14);
    }

    [Fact]
    public void Typing_replaces_the_selection()
    {
        var editor = Editor("jean@yahoo.fr", 5, selection: 5);

        editor.Insert("x");

        editor.Text.Should().Be("jean@x.fr");
        editor.CaretIndex.Should().Be(6);
        editor.SelectionLength.Should().Be(0);
    }

    [Fact]
    public void Backspace_deletes_the_character_before_the_caret()
    {
        var editor = Editor("jeban", 3);

        editor.Backspace().Should().BeTrue();

        editor.Text.Should().Be("jean");
        editor.CaretIndex.Should().Be(2);
    }

    [Fact]
    public void Backspace_at_the_start_does_nothing()
    {
        var editor = Editor("jean", 0);

        editor.Backspace().Should().BeFalse();

        editor.Text.Should().Be("jean");
        editor.CaretIndex.Should().Be(0);
    }

    [Fact]
    public void Backspace_deletes_the_selection_only()
    {
        var editor = Editor("jean@gmail.com", 4, selection: 10);

        editor.Backspace();

        editor.Text.Should().Be("jean");
        editor.CaretIndex.Should().Be(4);
    }

    [Fact]
    public void Shift_once_uppercases_the_next_letter_only()
    {
        var editor = Editor("", 0);
        editor.ToggleShift();

        editor.Insert("é");
        editor.Insert("l");

        editor.Text.Should().Be("Él");
        editor.Shift.Should().Be(ShiftState.Off);
    }

    [Fact]
    public void Shift_tapped_twice_stays_locked_then_a_third_tap_turns_it_off()
    {
        var editor = Editor("", 0);
        editor.ToggleShift();
        editor.ToggleShift();

        editor.Insert("ç");
        editor.Insert("a");
        editor.Shift.Should().Be(ShiftState.Locked);

        editor.ToggleShift();
        editor.Insert("v");

        editor.Text.Should().Be("ÇAv");
        editor.Shift.Should().Be(ShiftState.Off);
    }

    [Fact]
    public void Shift_leaves_digits_and_shortcuts_unchanged()
    {
        var editor = Editor("", 0);
        editor.ToggleShift();
        editor.ToggleShift();

        editor.Insert("7");
        editor.Insert(".com");

        editor.Text.Should().Be("7.com");
    }

    [Fact]
    public void Captions_follow_the_shift_state()
    {
        var editor = Editor("", 0);
        var letter = new TouchKey(TouchKeyAction.Insert, "à");
        var space = new TouchKey(TouchKeyAction.Insert, " ", "espace", 5);

        editor.Caption(letter).Should().Be("à");
        editor.ToggleShift();
        editor.Caption(letter).Should().Be("À");
        editor.Caption(space).Should().Be("espace");
    }

    [Fact]
    public void Insertion_beyond_the_max_length_is_refused_whole()
    {
        var editor = Editor("abcd", 4, maxLength: 6);

        editor.Insert(".com").Should().BeFalse();
        editor.Insert("e").Should().BeTrue();

        editor.Text.Should().Be("abcde");
    }

    [Fact]
    public void Sync_clamps_a_caret_or_selection_outside_the_text()
    {
        var editor = Editor("abc", 10, selection: 5);

        editor.CaretIndex.Should().Be(3);
        editor.SelectionLength.Should().Be(0);

        editor.Sync(null, -1, 2);
        editor.Text.Should().BeEmpty();
        editor.CaretIndex.Should().Be(0);
    }

    [Fact]
    public void A_domain_completes_the_address_after_the_at_sign()
    {
        var editor = Editor("jean@hot", 2);

        editor.ApplyEmailDomain("hotmail.fr").Should().BeTrue();

        editor.Text.Should().Be("jean@hotmail.fr");
        editor.CaretIndex.Should().Be(15);
    }

    [Fact]
    public void A_domain_is_appended_with_an_at_sign_when_there_is_none()
    {
        var editor = Editor("marie.dupont", 12);

        editor.ApplyEmailDomain("orange.fr");

        editor.Text.Should().Be("marie.dupont@orange.fr");
    }

    [Fact]
    public void A_domain_that_would_overflow_the_field_is_refused()
    {
        var editor = Editor("marie", 5, maxLength: 12);

        editor.ApplyEmailDomain("gmail.com").Should().BeFalse();

        editor.Text.Should().Be("marie");
    }
}
