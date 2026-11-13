namespace PolaKiosk.Services;

public interface IKioskService
{
    bool IsKioskModeEnabled { get; }
    void EnableKioskMode();
    void DisableKioskMode();
}
