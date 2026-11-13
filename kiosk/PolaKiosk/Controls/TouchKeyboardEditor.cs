using System.Globalization;

namespace PolaKiosk.Controls;

internal enum ShiftState { Off, Once, Locked }

/// <summary>
/// Logique d'édition du clavier tactile, sans WPF : le contrôle recopie le texte, le curseur et la
/// sélection du champ (<see cref="Sync"/>) avant chaque touche, puis réécrit le résultat dans le champ.
/// </summary>
internal sealed class TouchKeyboardEditor
{
    private static readonly CultureInfo French = CultureInfo.GetCultureInfo("fr-FR");

    public string Text { get; private set; } = "";
    public int CaretIndex { get; private set; }
    public int SelectionLength { get; private set; }

    /// <summary>Longueur maximale du champ (0 = illimitée, comme <c>TextBox.MaxLength</c>).</summary>
    public int MaxLength { get; set; }

    public ShiftState Shift { get; private set; }

    public bool IsShiftActive => Shift != ShiftState.Off;

    public void Sync(string? text, int selectionStart, int selectionLength)
    {
        Text = text ?? "";
        CaretIndex = Math.Clamp(selectionStart, 0, Text.Length);
        SelectionLength = Math.Clamp(selectionLength, 0, Text.Length - CaretIndex);
    }

    /// <summary>Un appui : majuscule pour la lettre suivante ; deux : verrouillée ; trois : désactivée.</summary>
    public void ToggleShift() => Shift = Shift switch
    {
        ShiftState.Off => ShiftState.Once,
        ShiftState.Once => ShiftState.Locked,
        _ => ShiftState.Off,
    };

    public void ResetShift() => Shift = ShiftState.Off;

    /// <summary>Insère au curseur (en remplaçant la sélection). Refusé en entier si le champ déborderait.</summary>
    public bool Insert(string value)
    {
        if (value.Length == 0) return false;

        var toInsert = ApplyShift(value);
        if (MaxLength > 0 && Text.Length - SelectionLength + toInsert.Length > MaxLength) return false;

        Text = Text.Remove(CaretIndex, SelectionLength).Insert(CaretIndex, toInsert);
        CaretIndex += toInsert.Length;
        SelectionLength = 0;
        if (Shift == ShiftState.Once) Shift = ShiftState.Off;
        return true;
    }

    /// <summary>Efface la sélection, sinon le caractère avant le curseur.</summary>
    public bool Backspace()
    {
        if (SelectionLength > 0)
        {
            Text = Text.Remove(CaretIndex, SelectionLength);
            SelectionLength = 0;
            return true;
        }
        if (CaretIndex == 0) return false;

        Text = Text.Remove(CaretIndex - 1, 1);
        CaretIndex--;
        return true;
    }

    /// <summary>Remplace tout ce qui suit « @ » par le domaine (ou l'ajoute), curseur en fin de champ.</summary>
    public bool ApplyEmailDomain(string domain)
    {
        var at = Text.IndexOf('@');
        var local = at < 0 ? Text : Text[..at];
        var updated = local + "@" + domain;
        if (MaxLength > 0 && updated.Length > MaxLength) return false;

        var changed = updated != Text;
        Text = updated;
        CaretIndex = Text.Length;
        SelectionLength = 0;
        return changed;
    }

    /// <summary>Libellé affiché : les lettres passent en majuscule quand la majuscule est active.</summary>
    public string Caption(TouchKey key) =>
        key.Action == TouchKeyAction.Insert ? ApplyShift(key.Caption) : key.Caption;

    private string ApplyShift(string value) =>
        IsShiftActive && value.Length == 1 && char.IsLetter(value[0]) ? value.ToUpper(French) : value;
}
