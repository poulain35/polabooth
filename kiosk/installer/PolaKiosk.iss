; Installeur PolaKiosk — Inno Setup 6+
; Installation PAR UTILISATEUR (aucun droit admin) → les mises à jour silencieuses
; fonctionnent sans UAC. Le watchdog est lancé via le dossier Démarrage de l'utilisateur.
;
; Prérequis avant de compiler (voir installer\README.md) :
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
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Raccourcis :"

[Files]
; App self-contained. On exclut appsettings.local.json : c'est un fichier d'overrides
; DÉVELOPPEUR (clé Supabase de dev) qui ne doit jamais arriver sur un kiosk — sinon il
; écraserait la config prod. Les réglages machine (imprimante…) sont gérés dans l'app
; (écran admin) et stockés dans machine-settings.json du DataDirectory, hors dossier d'install.
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion; Excludes: "appsettings.local.json"
; Scripts watchdog + mise à jour
Source: "{#ScriptsDir}\watchdog.ps1";     DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#ScriptsDir}\apply-update.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
; Mentions des composants de tiers (DLL Canon EDSDK, Independent JPEG Group), exigées par Canon
Source: "THIRD-PARTY-NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\{#AppName}";        Filename: "{app}\{#ExeName}"
Name: "{autodesktop}\{#AppName}";         Filename: "{app}\{#ExeName}"; Tasks: desktopicon
; Watchdog au démarrage de session (lance + surveille l'app), en session utilisateur
Name: "{userstartup}\{#AppName} Watchdog"; Filename: "powershell.exe"; \
  Parameters: "-WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\watchdog.ps1"" -ExePath ""{app}\{#ExeName}"""; \
  WorkingDir: "{app}"

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
