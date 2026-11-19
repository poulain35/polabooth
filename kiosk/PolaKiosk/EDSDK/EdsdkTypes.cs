using System.Runtime.InteropServices;

namespace PolaKiosk.EDSDK;

public static class EdsError
{
    public const uint OK = 0x00000000;
    public const uint DEVICE_BUSY = 0x00000081;
}

public static class EdsPropID
{
    public const uint Evf_OutputDevice = 0x00000500;
    public const uint Evf_Mode = 0x00000501;
    public const uint SaveTo = 0x0000000b;
    public const uint ImageQuality = 0x00000100;

    // Simulation d'exposition du live view (EOS R, EDSDK 13.20 § 5.2.104) : propriété cachée,
    // à débloquer avant l'ouverture de session (§ 6.22.3, voir EdsEvfViewType.UnlockKey).
    public const uint Evf_ViewType = 0x01000513;

    // Exposition (EDSDKTypes.h, « Capture Properties » et « Image Properties »).
    public const uint WhiteBalance     = 0x00000106;
    public const uint ColorTemperature = 0x00000107; // en kelvins, utile si WhiteBalance = ColorTemp
    public const uint AEMode           = 0x00000400; // mode de prise de vue (M, Av, Tv…), lecture seule
    public const uint ISOSpeed         = 0x00000402;
    public const uint Av               = 0x00000405;
    public const uint Tv               = 0x00000406;
    public const uint AEModeSelect     = 0x00000436; // position de la molette, quand AEMode ne répond pas
}

// Valeurs utiles de kEdsPropID_AEMode / AEModeSelect (EdsAEMode, EDSDKTypes.h).
public static class EdsAEMode
{
    public const int Program = 0;
    public const int Tv      = 1;
    public const int Av      = 2;
    public const int Manual  = 3;
    public const int Bulb    = 4;
}

// Valeur utile de kEdsPropID_WhiteBalance (EdsWhiteBalance, EDSDKTypes.h).
public static class EdsWhiteBalance
{
    public const int ColorTemp = 9;
}

// Valeurs permises d'une propriété (EdsPropertyDesc, EDSDKTypes.h : form, access, numElements, propDesc[128]).
[StructLayout(LayoutKind.Sequential)]
public struct EdsPropertyDesc
{
    public int Form;
    public int Access;
    public int NumElements;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 128)] public int[] PropDesc;
}

// Valeurs de Evf_ViewType (« Expo. simulation »). Désactivée : l'appareil éclaire seul le live
// view, quels que soient les réglages de prise de vue (faits pour le flash). La photo ne change pas.
public static class EdsEvfViewType
{
    public const uint DuringDofPreview = 0;
    public const uint Enable = 1;
    public const uint Disable = 3;
    public const uint ExposureAndDof = 4;

    // Déblocage décrit par Canon : EdsSetPropertyData(camera, UnlockTarget, UnlockKey, 4, &Evf_ViewType).
    public const uint UnlockTarget = 0x01000000;
    public const int UnlockKey = 0x7CBD2BB7;
}

// Valeurs EdsImageQuality (EDSDKTypes.h) : taille (octet de poids fort), format JPEG (1),
// compression (2 = Normal, 3 = Fine), puis 0xff0f = pas de seconde image (RAW).
public static class EdsImageQuality
{
    public const uint LJF  = 0x0013ff0f; // JPEG Large Fine
    public const uint LJN  = 0x0012ff0f; // JPEG Large Normal
    public const uint MJF  = 0x0113ff0f; // JPEG Middle Fine
    public const uint MJN  = 0x0112ff0f; // JPEG Middle Normal
    public const uint S1JF = 0x0E13ff0f; // JPEG Small1 Fine
    public const uint S1JN = 0x0E12ff0f; // JPEG Small1 Normal
    public const uint S2JF = 0x0F13ff0f; // JPEG Small2
}

// Destination d'enregistrement des photos (propriété SaveTo)
public static class EdsSaveTo
{
    public const uint Camera = 1;
    public const uint Host   = 2;
    public const uint Both   = 3;
}

// Capacité "virtuelle" du host, requise par EdsSetCapacity pour autoriser le transfert PC
[StructLayout(LayoutKind.Sequential)]
public struct EdsCapacity
{
    public int NumberOfFreeClusters;
    public int BytesPerSector;
    [MarshalAs(UnmanagedType.Bool)] public bool Reset;
}

// EDS_MAX_NAME = 256 ; chaînes ANSI, comme EdsDirectoryItemInfo.
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
public struct EdsDeviceInfo
{
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string PortName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string DeviceDescription;
    public uint DeviceSubType;
    public uint Reserved;
}

public static class EdsEvfOutputDevice
{
    public const uint PC = 0x00000002;
    public const uint None = 0x00000000;
}

public static class EdsCameraCommand
{
    public const uint TakePicture        = 0x00000000;
    public const uint PressShutterButton = 0x00000004;
}

// Paramètre (inParam) de EdsSendCommand(PressShutterButton, …)
public static class EdsShutterButton
{
    public const int OFF              = 0x00000000;
    public const int Halfway          = 0x00000001;
    public const int Completely       = 0x00000003;
    public const int Halfway_NonAF    = 0x00010001;
    public const int Completely_NonAF = 0x00010003;
}

public static class EdsObjectEvent
{
    public const uint All = 0x00000200;
    public const uint DirItemRequestTransfer = 0x00000208;
    public const uint DirItemCreated = 0x00000204;
}

public static class EdsStateEvent
{
    public const uint All = 0x00000300;
    public const uint Shutdown = 0x00000301;
    public const uint WillSoonShutDown = 0x00000303;
    public const uint ShutDownTimerUpdate = 0x00000304;
}

public static class EdsPropertyEvent
{
    public const uint All = 0x00000100;
    public const uint PropertyChanged = 0x00000101;
    public const uint PropertyDescChanged = 0x00000102; // liste permise changée (zoom, objectif, molette)
}

public static class EdsFileAttribute
{
    public const uint Normal = 0x00000000;
}

public static class EdsAccess
{
    public const uint Read = 0;
    public const uint Write = 1;
    public const uint ReadWrite = 2;
    public const uint Error = 0xFFFFFFFF;
}

public static class EdsFileCreateDisposition
{
    public const uint CreateAlways = 0;
    public const uint OpenExisting = 4;
}
