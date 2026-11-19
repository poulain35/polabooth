# Récupère ffmpeg.exe (build LGPL de BtbN/FFmpeg-Builds, version figée) pour les animations de la
# borne (LAB-234). Depuis kiosk\ :
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-ffmpeg.ps1
#
# Résultat : PolaKiosk\ffmpeg\ffmpeg.exe (gitignoré, comme les DLL Canon), copié à côté de
# PolaKiosk.exe par la construction. Déjà présent avec la bonne empreinte : rien à faire.
# Le fichier téléchargé est une donnée non fiable : il arrive dans un dossier temporaire vide, son
# empreinte SHA-256 est vérifiée avant toute ouverture, et seuls `-version` et `-encoders` y sont
# lancés pour contrôler la licence (ni --enable-gpl ni --enable-nonfree) et l'encodeur H.264.
# Changer de version : nouvelle URL (build de fin de mois, gardé par BtbN) et les deux empreintes.
# Fichier enregistré en UTF-8 AVEC BOM (Windows PowerShell 5.1).
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Version   = 'n9.0.2-39-g7adfbe40dc (BtbN autobuild-2026-10-31-12-59, win64-lgpl-9.0)'
$ZipUrl    = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n9.0.2-39-g7adfbe40dc-win64-lgpl-9.0.zip'
$ZipSha256 = '9d37c564e0d01c18cde184a079fa6ef04d7d2783ada41da81d04165cc8f1a650'
$ExeSha256 = 'd03c858a130cae1382902925d9f46eb15d7de42e025d34cc29b7ddca6cfb4c62'

$kiosk  = Split-Path -Parent $PSScriptRoot
$target = Join-Path $kiosk 'PolaKiosk\ffmpeg\ffmpeg.exe'

function Get-Sha256([string]$path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }

if (-not $Force -and (Test-Path -LiteralPath $target)) {
    if ((Get-Sha256 $target) -eq $ExeSha256) {
        Write-Host "ffmpeg.exe déjà présent ($Version)."
        exit 0
    }
    Write-Host 'ffmpeg.exe présent mais différent de la version attendue : nouveau téléchargement.'
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('polakiosk-ffmpeg-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $zip = Join-Path $work 'ffmpeg.zip'
    Write-Host "Téléchargement de ffmpeg $Version…"
    Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
    $zipHash = Get-Sha256 $zip
    if ($zipHash -ne $ZipSha256) { throw "Empreinte de l'archive inattendue ($zipHash) : fichier refusé." }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $exe = Join-Path $work 'ffmpeg.exe'
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        $entry = $archive.Entries | Where-Object { $_.FullName -match '^[^/]+/bin/ffmpeg\.exe$' } | Select-Object -First 1
        if (-not $entry) { throw "bin/ffmpeg.exe introuvable dans l'archive." }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $exe)
    } finally {
        $archive.Dispose()
    }
    $exeHash = Get-Sha256 $exe
    if ($exeHash -ne $ExeSha256) { throw "Empreinte de ffmpeg.exe inattendue ($exeHash) : fichier refusé." }

    $versionText = (& $exe -hide_banner -version | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg.exe -version a échoué (code $LASTEXITCODE)." }
    if ($versionText -match '--enable-gpl' -or $versionText -match '--enable-nonfree') {
        throw 'Ce ffmpeg est construit avec --enable-gpl ou --enable-nonfree : refusé (LGPL seulement).'
    }
    $encoders = (& $exe -hide_banner -encoders | Out-String)
    if ($encoders -notmatch '\sh264_mf\s' -and $encoders -notmatch '\slibopenh264\s') {
        throw 'Aucun encodeur H.264 LGPL (h264_mf, libopenh264) dans ce ffmpeg.'
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    $tmp = "$target.part"
    Copy-Item -LiteralPath $exe -Destination $tmp -Force
    Move-Item -LiteralPath $tmp -Destination $target -Force
    $size = (Get-Item -LiteralPath $target).Length / 1MB
    Write-Host ("ffmpeg.exe prêt : {0} ({1:N0} Mo, LGPL)." -f $target, $size)
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
