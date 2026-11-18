using System.ComponentModel;
using System.Drawing.Printing;
using System.Runtime.InteropServices;

namespace PolaKiosk.Services;

/// <summary>
/// Réglages du pilote par winspool (LAB-334) : <c>DocumentProperties</c> pour la taille et la fenêtre des
/// préférences, <c>GlobalAlloc</c> / <c>GlobalLock</c> pour passer le DEVMODE à <c>SetHdevmode</c>.
/// Non testé (pilote réel requis) : la logique est dans <see cref="DriverSettingCheck"/> et <see cref="PrintSetupPlanner"/>.
/// </summary>
public sealed class WinSpoolPrinterDriver(Func<IntPtr>? owner = null) : IPrinterDriver
{
    private const int DM_OUT_BUFFER = 2;
    private const int DM_IN_PROMPT  = 4;
    private const int DM_IN_BUFFER  = 8;
    private const int IDOK     = 1;
    private const int IDCANCEL = 2;
    private const uint GMEM_MOVEABLE = 0x0002;

    public int GetDevModeSize(string printerName)
    {
        if (string.IsNullOrWhiteSpace(printerName)) return 0;
        if (!OpenPrinter(printerName, out var printer, IntPtr.Zero)) return 0;
        try
        {
            var size = DocumentProperties(IntPtr.Zero, printer, printerName, IntPtr.Zero, IntPtr.Zero, 0);
            return Math.Max(size, 0);
        }
        finally { ClosePrinter(printer); }
    }

    public byte[]? Prompt(string printerName, byte[]? initial)
    {
        if (!OpenPrinter(printerName, out var printer, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error(), $"Imprimante « {printerName} » introuvable.");
        var output = IntPtr.Zero;
        var input  = IntPtr.Zero;
        try
        {
            var hwnd = owner?.Invoke() ?? IntPtr.Zero;
            var size = DocumentProperties(hwnd, printer, printerName, IntPtr.Zero, IntPtr.Zero, 0);
            if (size <= 0)
                throw new InvalidOperationException($"Le pilote de « {printerName} » ne donne pas ses réglages.");

            output = Marshal.AllocHGlobal(size);
            var mode = DM_OUT_BUFFER | DM_IN_PROMPT;
            // Un réglage d'un autre pilote (autre taille) ne doit pas être donné au pilote : on part de son défaut.
            if (initial != null && initial.Length == size)
            {
                input = Marshal.AllocHGlobal(size);
                Marshal.Copy(initial, 0, input, size);
                mode |= DM_IN_BUFFER;
            }

            var result = DocumentProperties(hwnd, printer, printerName, output, input, mode);
            if (result == IDCANCEL) return null;
            if (result != IDOK)
                throw new InvalidOperationException($"La fenêtre du pilote de « {printerName} » a échoué (code {result}).");

            var header = new byte[DriverSettingCheck.HeaderLength];
            Marshal.Copy(output, header, 0, header.Length);
            var length = Math.Min(DriverSettingCheck.DeclaredSize(header), size);
            var devMode = new byte[length];
            Marshal.Copy(output, devMode, 0, length);
            return devMode;
        }
        finally
        {
            if (input != IntPtr.Zero) Marshal.FreeHGlobal(input);
            if (output != IntPtr.Zero) Marshal.FreeHGlobal(output);
            ClosePrinter(printer);
        }
    }

    public void Apply(PrinterSettings printer, PageSettings page, byte[] devMode)
    {
        var handle = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)devMode.Length);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var pointer = GlobalLock(handle);
            if (pointer == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try { Marshal.Copy(devMode, 0, pointer, devMode.Length); }
            finally { GlobalUnlock(handle); }

            // Les deux copient le DEVMODE : la mémoire peut être libérée aussitôt.
            printer.SetHdevmode(handle);
            page.SetHdevmode(handle);
        }
        finally { GlobalFree(handle); }
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "DocumentPropertiesW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int DocumentProperties(IntPtr hWnd, IntPtr hPrinter, string pDeviceName,
        IntPtr pDevModeOutput, IntPtr pDevModeInput, int fMode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalUnlock(IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalFree(IntPtr hMem);
}
