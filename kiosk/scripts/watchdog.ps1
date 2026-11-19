# Watchdog PolaKiosk — lance l'app et la relance si elle plante ou après une mise à jour.
# S'exécute en session utilisateur, aucun droit admin. Lancé à l'ouverture de session par le
# raccourci du dossier Démarrage si la case « Lancer la borne au démarrage de Windows » de l'Admin
# est cochée (désactivé à l'installation) ; sinon par l'app elle-même, ouverte à la main.
# « Quitter vers Windows » (admin de la borne) pose stop.flag : plus de relance jusqu'à la prochaine
# ouverture de session (ce watchdog le supprime en démarrant) ou jusqu'au lancement de l'app à la main
# (l'app le supprime à son démarrage).
# Pendant une mise à jour, un fichier verrou empêche la relance (sinon l'installeur ne
# pourrait pas remplacer l'exe en cours d'utilisation). Un verrou de plus de 10 min est
# orphelin (mise à jour interrompue) : il est ignoré et supprimé.
#
# Fichier enregistré en UTF-8 AVEC BOM : sans BOM, Windows PowerShell 5.1 le lit en ANSI
# et le tiret long des messages casse l'analyse du script.
#
# Manuel :
#   powershell -ExecutionPolicy Bypass -File watchdog.ps1 -ExePath "...\PolaKiosk.exe"

param(
    [string]$ExePath = "",
    [int]$IntervalSeconds = 15,
    [int]$OrphanLockMinutes = 10
)

$ErrorActionPreference = "Continue"

if ([string]::IsNullOrWhiteSpace($ExePath)) {
    $candidates = @(
        (Join-Path $PSScriptRoot "..\PolaKiosk.exe"),
        (Join-Path $PSScriptRoot "PolaKiosk.exe")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $ExePath = (Resolve-Path $c).Path; break }
    }
}

if ([string]::IsNullOrWhiteSpace($ExePath) -or -not (Test-Path $ExePath)) {
    Write-Host "[watchdog] Exe introuvable. Préciser -ExePath." -ForegroundColor Red
    exit 1
}

$processName = [System.IO.Path]::GetFileNameWithoutExtension($ExePath)
$dataDir  = Join-Path $env:LOCALAPPDATA "PolaKiosk"
$lockFile = Join-Path $dataDir "update.lock"
$logFile  = Join-Path $dataDir "watchdog.log"
$stopFile = Join-Path $dataDir "stop.flag"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }

function Write-Log($msg) {
    Add-Content -Path $logFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" -Encoding utf8
}

# Un seul watchdog par session (raccourci du dossier Démarrage + lancement manuel…)
$mutex = New-Object System.Threading.Mutex($false, "Local\PolaKiosk.Watchdog")
$owned = $false
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) {
    Write-Log "[watchdog] Un autre watchdog surveille déjà '$processName' : arrêt."
    exit 0
}

# Nouvelle session : un « Quitter vers Windows » de la session précédente ne compte plus.
if (Test-Path $stopFile) {
    Remove-Item $stopFile -ErrorAction SilentlyContinue
    Write-Log "[watchdog] Arrêt volontaire de la session précédente oublié (stop.flag supprimé)."
}

Write-Log "[watchdog] Démarrage. Surveillance de '$processName' toutes les ${IntervalSeconds}s."
$stopped = $false

while ($true) {
    # Mise à jour en cours → ne pas relancer l'app (l'installeur a besoin qu'elle reste fermée)
    $lock = Get-Item $lockFile -ErrorAction SilentlyContinue
    if ($lock) {
        $age = (Get-Date) - $lock.LastWriteTime
        if ($age.TotalMinutes -lt $OrphanLockMinutes) {
            Start-Sleep -Seconds 2
            continue
        }
        Write-Log "[watchdog] Verrou de mise à jour orphelin ($([int]$age.TotalMinutes) min) : ignoré et supprimé."
        Remove-Item $lockFile -ErrorAction SilentlyContinue
    }

    # Arrêt volontaire (« Quitter vers Windows ») → pas de relance tant que stop.flag existe
    if (Test-Path $stopFile) {
        if (-not $stopped) { Write-Log "[watchdog] Arrêt volontaire : relance suspendue."; $stopped = $true }
        Start-Sleep -Seconds 2
        continue
    }
    if ($stopped) { Write-Log "[watchdog] stop.flag retiré : surveillance reprise."; $stopped = $false }

    $running = Get-Process -Name $processName -ErrorAction SilentlyContinue
    if (-not $running) {
        Write-Log "[watchdog] '$processName' arrêté : relance."
        try { Start-Process -FilePath $ExePath -WorkingDirectory (Split-Path $ExePath) }
        catch { Write-Log "[watchdog] ERREUR au lancement : $($_.Exception.Message)" }
    }
    Start-Sleep -Seconds $IntervalSeconds
}
