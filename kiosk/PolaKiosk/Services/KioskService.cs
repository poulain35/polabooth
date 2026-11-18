using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace PolaKiosk.Services;

public class KioskService : IKioskService, IDisposable
{
    private readonly AppSettings _settings;

    // Hook bas niveau
    private IntPtr _hookHandle = IntPtr.Zero;
    private LowLevelKeyboardProc? _proc;

    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN     = 0x0100;
    private const int WM_SYSKEYDOWN  = 0x0104;
    private const int VK_LWIN        = 0x5B;
    private const int VK_RWIN        = 0x5C;
    private const int VK_F4          = 0x73;
    private const int VK_TAB         = 0x09;
    private const int VK_ESCAPE      = 0x1B;

    public bool IsKioskModeEnabled { get; private set; }

    public KioskService(AppSettings settings)
    {
        _settings = settings;
    }

    public void EnableKioskMode()
    {
        if (!_settings.Kiosk.KioskMode) return;

        ApplyWindowSettings(fullscreen: true);
        InstallKeyboardHook();
        IsKioskModeEnabled = true;
    }

    public void DisableKioskMode()
    {
        RemoveKeyboardHook();
        ApplyWindowSettings(fullscreen: false);
        IsKioskModeEnabled = false;
    }

    private static void ApplyWindowSettings(bool fullscreen)
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            var win = Application.Current.MainWindow;
            if (win == null) return;

            if (fullscreen)
            {
                // Au retour de l'Admin, la fenêtre est déjà agrandie avec sa bordure : Windows l'a
                // calée sur la zone de travail, barre des tâches exclue. Il faut la rétablir avant de
                // retirer la bordure puis l'agrandir de nouveau, sinon la barre reste visible (LAB-390).
                if (win.WindowState == WindowState.Maximized)
                    win.WindowState = WindowState.Normal;
                win.WindowStyle = WindowStyle.None;
                win.ResizeMode  = ResizeMode.NoResize;
                win.WindowState = WindowState.Maximized;
                win.Topmost     = true;
                win.Activate();
            }
            else
            {
                win.Topmost    = false;
                win.WindowStyle = WindowStyle.SingleBorderWindow;
                win.ResizeMode  = ResizeMode.CanResize;
            }
        });
    }

    private void InstallKeyboardHook()
    {
        if (_hookHandle != IntPtr.Zero) return;
        _proc       = HookCallback;
        _hookHandle = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
    }

    private void RemoveKeyboardHook()
    {
        if (_hookHandle == IntPtr.Zero) return;
        UnhookWindowsHookEx(_hookHandle);
        _hookHandle = IntPtr.Zero;
        _proc       = null;
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN))
        {
            int key = Marshal.ReadInt32(lParam);

            // Bloquer touche Windows (gauche + droite)
            if (key == VK_LWIN || key == VK_RWIN)
                return (IntPtr)1;

            // Bloquer Alt+F4
            if (key == VK_F4 && IsAltDown())
                return (IntPtr)1;

            // Bloquer Alt+Tab et Alt+Esc
            if ((key == VK_TAB || key == VK_ESCAPE) && IsAltDown())
                return (IntPtr)1;

            // Bloquer Ctrl+Esc (menu Démarrer) et Ctrl+Maj+Esc (gestionnaire des tâches).
            // Ctrl+Alt+Suppr reste géré par Windows : impossible à intercepter depuis une application.
            if (key == VK_ESCAPE && IsCtrlDown())
                return (IntPtr)1;
        }

        return CallNextHookEx(_hookHandle, nCode, wParam, lParam);
    }

    private static bool IsAltDown()
        => (GetKeyState(0x12) & 0x8000) != 0; // VK_MENU

    // État physique (GetAsyncKeyState) : dans un hook bas niveau, GetKeyState peut être en retard
    // sur la touche qui vient d'être enfoncée.
    private static bool IsCtrlDown()
        => (GetAsyncKeyState(0x11) & 0x8000) != 0; // VK_CONTROL

    public void Dispose() => RemoveKeyboardHook();

    // ── P/Invoke ─────────────────────────────────────────────────────────────

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll")] private static extern bool   UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)] private static extern IntPtr GetModuleHandle(string? lpModuleName);
    [DllImport("user32.dll")] private static extern short GetKeyState(int nVirtKey);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vKey);
}
