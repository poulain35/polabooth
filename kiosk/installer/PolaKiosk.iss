; Installeur PolaKiosk — Inno Setup 6+
; Installation PAR UTILISATEUR (aucun droit admin) → les mises à jour silencieuses
; fonctionnent sans UAC. Lancement au démarrage de Windows : désactivé à l'installation, réglé
; dans l'Admin de la borne (raccourci « PolaKiosk Watchdog » du dossier Démarrage, posé par l'app).
; Une borne installée avant la 1.0.22 garde son raccourci (la mise à jour ne le retire pas).
;
; Construction : installer\build.ps1 (publication .NET, signature facultative, compilation ; voir
; installer\README.md). À la main : d'abord
;   dotnet publish PolaKiosk\PolaKiosk.csproj -c Release -r win-x64 --self-contained true
;
; Version : UNE SEULE source, <Version> du PolaKiosk.csproj. Elle est lue ici dans la DLL
; publiée (Inno Setup 6.1 ou plus) : rien à modifier dans ce fichier à chaque release.
; Fichier enregistré en UTF-8 AVEC BOM (sinon les accents s'affichent mal dans l'installeur).

#define AppName        "PolaKiosk"
; Éditeur affiché par Windows : celui de l'instance (fichier privé instance.iss,
; ex. #define AppPublisher "Ma société"), sinon le nom de l'application (open core L7).
#if FileExists(AddBackslash(SourcePath) + "instance.iss")
  #include "instance.iss"
#endif
#ifndef AppPublisher
  #define AppPublisher "PolaKiosk"
#endif
#define ExeName        "PolaKiosk.exe"
#define PublishDir     "..\PolaKiosk\bin\Release\net10.0-windows\win-x64\publish"
#define ScriptsDir     "..\scripts"

#define AppDll AddBackslash(SourcePath) + PublishDir + "\PolaKiosk.dll"
#if !FileExists(AppDll)
  #error "PolaKiosk.dll introuvable : lancer d'abord dotnet publish (voir installer\README.md)."
#endif
; ffmpeg.exe (build LGPL, animations LAB-234) : copié dans la publication s'il est dans
; PolaKiosk\ffmpeg\ (build.ps1 lance scripts\fetch-ffmpeg.ps1 avant de publier).
#if !FileExists(AddBackslash(SourcePath) + PublishDir + "\ffmpeg.exe")
  #error "ffmpeg.exe absent de la publication : lancer scripts\fetch-ffmpeg.ps1 puis republier (voir installer\README.md)."
#endif
#define VerMajor 0
#define VerMinor 0
#define VerRev   0
#define VerBuild 0
#expr GetVersionComponents(AppDll, VerMajor, VerMinor, VerRev, VerBuild)
#define AppVersion Str(VerMajor) + "." + Str(VerMinor) + "." + Str(VerRev)

[Setup]
AppId={{B3E9F2A1-7C4D-4E8B-9A6F-1D2C3B4A5E60}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
; Installation par utilisateur — pas de droits admin, indispensable pour l'auto-MAJ silencieuse
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\{#AppName}
DisableProgramGroupPage=yes
OutputBaseFilename=setup-polakiosk
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Icône Polabooth : fichier setup-polakiosk.exe et « Applications installées » de Windows
SetupIconFile=..\PolaKiosk\Assets\Brand\polabooth.ico
UninstallDisplayIcon={app}\{#ExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Signature Authenticode facultative (LAB-424) : build.ps1 passe /DSign et l'outil « polasign »
; (installer\sign.ps1) quand un certificat est configuré. Signe l'installeur et le désinstalleur.
#ifdef Sign
SignTool=polasign
SignedUninstaller=yes
#endif

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Raccourcis :"

[Files]
; App self-contained. On exclut appsettings.local.json et appsettings.Development.json : ce sont
; des réglages DÉVELOPPEUR (base de dev, PIN de dev) qui ne doivent jamais arriver sur un kiosk.
; Le publish ne les copie déjà plus (PolaKiosk.csproj) ; l'exclusion ici couvre un vieux dossier.
; Les réglages machine (imprimante…) sont gérés dans l'app (écran admin) et stockés dans
; machine-settings.json du DataDirectory, hors dossier d'install.
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion; Excludes: "appsettings.local.json,appsettings.Development.json"
; Scripts watchdog + mise à jour
Source: "{#ScriptsDir}\watchdog.ps1";     DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#ScriptsDir}\apply-update.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
; Mentions des composants de tiers (DLL Canon EDSDK, Independent JPEG Group exigées par Canon ;
; FFmpeg : version, adresse des sources) et textes des licences LGPL v3 / GPL v3 de FFmpeg
Source: "THIRD-PARTY-NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "licenses\ffmpeg\*.txt";   DestDir: "{app}\licenses\ffmpeg"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\{#AppName}";        Filename: "{app}\{#ExeName}"
Name: "{autodesktop}\{#AppName}";         Filename: "{app}\{#ExeName}"; Tasks: desktopicon
; Plus de raccourci du watchdog dans {userstartup} : l'app le pose si la case « Lancer la borne au
; démarrage de Windows » de l'Admin est cochée (WindowsStartup.cs), même nom qu'avant.

[Run]
; Démarrer le watchdog tout de suite après une installation manuelle (sans attendre le
; prochain logon). skipifsilent : lors d'une mise à jour silencieuse, le watchdog déjà en
; cours relance l'app une fois le verrou libéré ; en lancer un second ici ferait doublon.
Filename: "powershell.exe"; \
  Parameters: "-WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\watchdog.ps1"" -ExePath ""{app}\{#ExeName}"""; \
  Flags: nowait runhidden skipifsilent; \
  Description: "Démarrer {#AppName}"; \
  StatusMsg: "Démarrage de {#AppName}..."

[UninstallRun]
; Stopper le watchdog et l'app avant la désinstallation
Filename: "powershell.exe"; \
  Parameters: "-WindowStyle Hidden -ExecutionPolicy Bypass -Command ""Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -like '*watchdog.ps1*' } | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Stop-Process -Name PolaKiosk -Force -ErrorAction SilentlyContinue"""; \
  Flags: runhidden; RunOnceId: "StopWatchdog"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\scripts"
; Raccourci du lancement au démarrage de Windows, posé par l'app (case de l'Admin)
Type: files; Name: "{userstartup}\{#AppName} Watchdog.lnk"
