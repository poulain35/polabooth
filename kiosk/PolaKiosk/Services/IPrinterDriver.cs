using System.Drawing.Printing;

namespace PolaKiosk.Services;

/// <summary>
/// Réglages du pilote Windows de l'imprimante (DEVMODE complet, partie privée comprise), LAB-334.
/// Seul endroit qui appelle winspool : <see cref="WinSpoolPrinterDriver"/>.
/// </summary>
public interface IPrinterDriver
{
    /// <summary>Taille du DEVMODE du pilote installé (dmSize + dmDriverExtra), 0 si l'imprimante est introuvable.</summary>
    int GetDevModeSize(string printerName);

    /// <summary>
    /// Ouvre la fenêtre des préférences du pilote (modale, fil d'affichage), partie de <paramref name="initial"/>
    /// s'il convient au pilote, sinon de son réglage par défaut. Rend le DEVMODE validé, ou null si l'opérateur
    /// annule. Lève une exception si la fenêtre ne peut pas s'ouvrir.
    /// </summary>
    byte[]? Prompt(string printerName, byte[]? initial);

    /// <summary>Applique un DEVMODE complet à l'impression (<c>SetHdevmode</c>) ; papier et orientation sont à réimposer ensuite.</summary>
    void Apply(PrinterSettings printer, PageSettings page, byte[] devMode);
}
