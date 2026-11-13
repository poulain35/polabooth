# Applique une mise à jour PolaKiosk : attend la fermeture de l'app, lance l'installeur
# en silencieux (per-user, aucun droit admin), puis libère le verrou pour que le watchdog
# relance l'app (nouvelle version si l'installation a réussi, sinon la version installée).
#
# Lancé par l'app elle-même juste avant qu'elle se ferme. Le fichier verrou (update.lock)
# est créé par l'app AVANT de lancer ce script, pour éviter toute relance entre-temps.
# En cas d'échec, update.failed (numéro de version) indique à l'app relancée que la mise à
# jour demandée a échoué : elle le signale au SaaS (LAB-200) et ne réessaie pas sans
# nouvelle demande depuis la page Licences.
#
# Fichier enregistré en UTF-8 AVEC BOM : sans BOM, Windows PowerShell 5.1 le lit en ANSI.

param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [string]$Version = "",
    [string]$ProcessName = "PolaKiosk",
    # Doit rester sous les 10 min au-delà desquelles le watchdog ignore le verrou.
    [int]$InstallerTimeoutSeconds = 480
)

$ErrorActionPreference = "Continue"

$dataDir    = Join-Path $env:LOCALAPPDATA "PolaKiosk"
$lockFile   = Join-Path $dataDir "update.lock"
$failedFile = Join-Path $dataDir "update.failed"
$log        = Join-Path $dataDir "update.log"
$setupLog   = Join-Path $dataDir "setup-install.log"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
function L($m) { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" -Encoding utf8 }

function Invoke-Installer {
    if (-not (Test-Path $Installer)) {
        L "ERREUR : installeur introuvable."
        return 1
    }

    # Process.Start plutôt que Start-Process -Wait : attente bornée et code retour fiable.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName        = $Installer
    $psi.Arguments       = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG=`"$setupLog`""
    $psi.UseShellExecute = $false
    $p = [System.Diagnostics.Process]::Start($psi)

    if (-not $p.WaitForExit($InstallerTimeoutSeconds * 1000)) {
        L "ERREUR : installeur toujours en cours après $InstallerTimeoutSeconds s, arrêt forcé."
        try { $p.Kill() } catch { }
        return 1
    }
    L "Installeur terminé (code $($p.ExitCode))."
    return $p.ExitCode
}

$code = 1
try {
    # Horodatage du verrou rafraîchi : le watchdog le considère orphelin au bout de 10 min.
    Set-Content -Path $lockFile -Value (Get-Date -Format o) -Encoding utf8
    L "Mise à jour démarrée : $Installer (version $Version)"

    # Attendre la fermeture de l'app (max 30 s) puis forcer si nécessaire
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
    }
    Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    $code = Invoke-Installer
} catch {
    L "ERREUR installeur : $($_.Exception.Message)"
    $code = 1
} finally {
    if ($code -ne 0 -and $Version) {
        Set-Content -Path $failedFile -Value $Version -Encoding utf8 -ErrorAction SilentlyContinue
    }
    # Nettoyage installeur téléchargé
    Remove-Item $Installer -ErrorAction SilentlyContinue
    # Libère le verrou → le watchdog relance l'app
    Remove-Item $lockFile -ErrorAction SilentlyContinue
}

if ($code -eq 0) {
    L "Mise à jour terminée."
} else {
    L "Mise à jour ÉCHOUÉE (code $code) : la version installée redémarre et signale l'échec de la version $Version au SaaS."
}
exit $code
