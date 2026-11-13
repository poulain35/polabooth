using System.Runtime.InteropServices;

namespace PolaKiosk.EDSDK;

public static class EdsApi
{
    private const string DllPath = "EDSDK.dll";

    [DllImport(DllPath)] public static extern uint EdsInitializeSDK();
    [DllImport(DllPath)] public static extern uint EdsTerminateSDK();

    [DllImport(DllPath)] public static extern uint EdsGetCameraList(out IntPtr outCameraList);
    [DllImport(DllPath)] public static extern uint EdsGetChildCount(IntPtr inRef, out int outCount);
    [DllImport(DllPath)] public static extern uint EdsGetChildAtIndex(IntPtr inRef, int inIndex, out IntPtr outRef);
    [DllImport(DllPath)] public static extern uint EdsOpenSession(IntPtr inCameraRef);
    [DllImport(DllPath)] public static extern uint EdsCloseSession(IntPtr inCameraRef);
    [DllImport(DllPath)] public static extern uint EdsRelease(IntPtr inRef);

    [DllImport(DllPath)] public static extern uint EdsSendCommand(IntPtr inCameraRef, uint inCommand, int inParam);

    // Pompe d'événements : indispensable pour que les callbacks (transfert d'image, etc.)
    // soient distribués sur le thread qui a initialisé le SDK.
    [DllImport(DllPath)] public static extern uint EdsGetEvent();

    // Capacité host : autorise l'appareil à transférer la photo vers le PC (SaveTo=Host).
    [DllImport(DllPath)] public static extern uint EdsSetCapacity(IntPtr inCameraRef, EdsCapacity inCapacity);

    [DllImport(DllPath)] public static extern uint EdsSetObjectEventHandler(
        IntPtr inCameraRef, uint inEvent,
        EdsObjectEventHandler inObjectEventHandler, IntPtr inContext);

    [DllImport(DllPath)] public static extern uint EdsSetPropertyEventHandler(
        IntPtr inCameraRef, uint inEvent,
        EdsPropertyEventHandler inPropertyEventHandler, IntPtr inContext);

    [DllImport(DllPath)] public static extern uint EdsSetCameraStateEventHandler(
        IntPtr inCameraRef, uint inEvent,
        EdsStateEventHandler inStateEventHandler, IntPtr inContext);

    [DllImport(DllPath)] public static extern uint EdsSetPropertyData(
        IntPtr inRef, uint inPropertyID, int inParam, uint inPropertySize, IntPtr inPropertyData);

    [DllImport(DllPath)] public static extern uint EdsGetPropertyData(
        IntPtr inRef, uint inPropertyID, int inParam, uint inPropertySize, IntPtr outPropertyData);

    // Live view
    [DllImport(DllPath)] public static extern uint EdsCreateEvfImageRef(IntPtr inStreamRef, out IntPtr outEvfImageRef);
    [DllImport(DllPath)] public static extern uint EdsDownloadEvfImage(IntPtr inCameraRef, IntPtr inEvfImageRef);
    [DllImport(DllPath)] public static extern uint EdsCreateMemoryStream(ulong inBufferSize, out IntPtr outStreamRef);
    [DllImport(DllPath)] public static extern uint EdsGetPointer(IntPtr inStreamRef, out IntPtr outPointer);
    [DllImport(DllPath)] public static extern uint EdsGetLength(IntPtr inStreamRef, out ulong outLength);

    // Download image after capture
    [DllImport(DllPath)] public static extern uint EdsGetDirectoryItemInfo(IntPtr inDirItemRef, out EdsDirectoryItemInfo outDirItemInfo);
    // EDSDK attend un nom de fichier ANSI (const char*), pas de l'UTF-16 : un LPWStr
    // corrompt le chemin → le fichier est écrit ailleurs / pas écrit du tout.
    [DllImport(DllPath, CharSet = CharSet.Ansi)] public static extern uint EdsCreateFileStream(
        [MarshalAs(UnmanagedType.LPStr)] string inFileName,
        uint inCreateDisposition, uint inDesiredAccess, out IntPtr outStreamRef);
    [DllImport(DllPath)] public static extern uint EdsDownload(IntPtr inDirItemRef, ulong inReadSize, IntPtr inStreamRef);
    [DllImport(DllPath)] public static extern uint EdsDownloadComplete(IntPtr inDirItemRef);
    // Refuse un transfert (photo non attendue) : sans ça, le boîtier garde la photo en attente.
    [DllImport(DllPath)] public static extern uint EdsDownloadCancel(IntPtr inDirItemRef);

    // Delegates pour les callbacks
    public delegate uint EdsObjectEventHandler(uint inEvent, IntPtr inRef, IntPtr inContext);
    public delegate uint EdsPropertyEventHandler(uint inEvent, uint inPropertyID, uint inParam, IntPtr inContext);
    public delegate uint EdsStateEventHandler(uint inEvent, uint inEventData, IntPtr inContext);
}

[StructLayout(LayoutKind.Sequential)]
public struct EdsDirectoryItemInfo
{
    public ulong Size;
    [MarshalAs(UnmanagedType.Bool)] public bool IsFolder;
    public uint GroupID;
    public uint Option;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string FileName;
    public uint Format;
    public uint DateTime;
}
