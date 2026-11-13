using System.Windows;

namespace PolaKiosk.Services;

public interface IIdleTimeoutService
{
    /// <summary>Attache la surveillance d'inactivité à la fenêtre et démarre le timer.</summary>
    void Attach(Window window);

    /// <summary>Réinitialise manuellement le compte à rebours (interaction détectée).</summary>
    void Reset();

    /// <summary>Définit le délai d'inactivité (s) depuis la config de l'événement. 0 = désactivé.</summary>
    void SetTimeout(int seconds);
}
