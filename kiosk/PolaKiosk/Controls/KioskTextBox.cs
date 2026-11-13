using System.Windows.Automation.Peers;
using System.Windows.Controls;

namespace PolaKiosk.Controls;

/// <summary>
/// Champ de saisie qui n'ouvre jamais le clavier tactile Windows (TabTip). Windows ouvre ce clavier
/// quand un contrôle d'édition UI Automation reçoit le focus après un appui tactile : ce champ se
/// présente comme un élément simple, sans motif Texte ni Valeur. Le clavier physique reste utilisable.
/// La saisie tactile passe par <see cref="TouchKeyboard"/>.
/// </summary>
public class KioskTextBox : TextBox
{
    protected override AutomationPeer OnCreateAutomationPeer() => new FrameworkElementAutomationPeer(this);
}
