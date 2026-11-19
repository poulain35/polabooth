# Construction de l'installeur de la borne (LAB-424) : publication .NET, signature facultative,
# Inno Setup. Depuis kiosk\ :
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File installer\build.ps1
#
# Résultat : installer\Output\setup-polakiosk.exe. Signature : si KIOSK_SIGN_CERT_THUMBPRINT,
# KIOSK_SIGN_CERT_FILE ou KIOSK_SIGN_COMMAND est défini (voir sign.ps1), PolaKiosk.exe, PolaKiosk.dll,
# l'installeur et son désinstalleur sont signés ; sinon l'installeur est le même qu'avant.
# ffmpeg.exe (animations) : scripts\fetch-ffmpeg.ps1 le récupère avant la publication s'il manque.
# -NoPublish : la publication est déjà faite (script de l'installeur public, qui la contrôle avant).
# Inno Setup : variable ISCC, sinon installation pour tous ou pour l'utilisateur courant.
param([switch]$NoPublish)

$ErrorActionPreference = 'Stop'
$kiosk = Split-Path -Parent $PSScriptRoot
$publishDir = Join-Path $kiosk 'PolaKiosk\bin\Release\net10.0-windows\win-x64\publish'
$signScript = Join-Path $PSScriptRoot 'sign.ps1'
$signing = [bool]($env:KIOSK_SIGN_COMMAND -or $env:KIOSK_SIGN_CERT_THUMBPRINT -or $env:KIOSK_SIGN_CERT_FILE)

$iscc = @($env:ISCC,
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    (Join-Path "$env:LOCALAPPDATA" 'Programs\Inno Setup 6\ISCC.exe')) |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $iscc) { throw 'ISCC introuvable : installez Inno Setup 6.1+ ou définissez la variable ISCC.' }

Push-Location $kiosk
try {
    if (-not $NoPublish) {
        # ffmpeg.exe (animations, LAB-234) : récupéré et vérifié s'il manque, puis copié par la publication.
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kiosk 'scripts\fetch-ffmpeg.ps1')
        if ($LASTEXITCODE -ne 0) { throw "Récupération de ffmpeg.exe impossible (code $LASTEXITCODE)." }
        & dotnet publish PolaKiosk\PolaKiosk.csproj -c Release -r win-x64 --self-contained true --nologo
        if ($LASTEXITCODE -ne 0) { throw "dotnet publish a échoué (code $LASTEXITCODE)." }
    }
    $isccArgs = @('/Q')
    if ($signing) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $signScript `
            (Join-Path $publishDir 'PolaKiosk.exe') (Join-Path $publishDir 'PolaKiosk.dll')
        if ($LASTEXITCODE -ne 0) { throw 'Signature de PolaKiosk.exe impossible.' }
        # Inno Setup signe l'installeur et le désinstalleur avec la même commande ($f = fichier à signer).
        $isccArgs += '/DSign', "/Spolasign=powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$signScript`" `$f"
    } else {
        Write-Host 'Installeur non signé (aucune variable KIOSK_SIGN_* définie).'
    }
    & $iscc @isccArgs 'installer\PolaKiosk.iss'
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup a échoué (code $LASTEXITCODE)." }
    Write-Host "Installeur : $(Join-Path $kiosk 'installer\Output\setup-polakiosk.exe')"
} finally {
    Pop-Location
}
