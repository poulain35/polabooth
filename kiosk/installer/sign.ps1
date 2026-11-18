# Signature Authenticode d'un fichier (LAB-424). Facultative : la construction de l'installeur
# (build.ps1) l'appelle seulement si une des variables ci-dessous est définie. Sans signature,
# Windows SmartScreen avertit « éditeur inconnu » au premier lancement de setup-polakiosk.exe.
#
#   KIOSK_SIGN_CERT_THUMBPRINT  empreinte (SHA-1) d'un certificat de signature de code du magasin
#                               Windows (CurrentUser\My, sinon LocalMachine\My) : jeton USB du
#                               fournisseur ou certificat importé
#   KIOSK_SIGN_CERT_FILE        ou fichier .pfx, avec KIOSK_SIGN_CERT_PASSWORD
#   KIOSK_SIGN_COMMAND          ou commande complète d'un service de signature (signtool avec /dlib…),
#                               où {file} est remplacé par le chemin du fichier entre guillemets
#   KIOSK_SIGN_TIMESTAMP_URL    serveur d'horodatage (par défaut http://timestamp.digicert.com) : la
#                               signature reste valable après l'expiration du certificat
#
# Usage : powershell -NoProfile -ExecutionPolicy Bypass -File installer\sign.ps1 <fichier>...
param([Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Files)

$ErrorActionPreference = 'Stop'
$timestamp = if ($env:KIOSK_SIGN_TIMESTAMP_URL) { $env:KIOSK_SIGN_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' }

function Get-SigningCertificate {
    if ($env:KIOSK_SIGN_CERT_THUMBPRINT) {
        $thumb = ($env:KIOSK_SIGN_CERT_THUMBPRINT -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
        foreach ($store in 'Cert:\CurrentUser\My', 'Cert:\LocalMachine\My') {
            $cert = Get-ChildItem $store -CodeSigningCert | Where-Object { $_.Thumbprint -eq $thumb } | Select-Object -First 1
            if ($cert) { return $cert }
        }
        throw "Certificat de signature de code $thumb introuvable (CurrentUser\My, LocalMachine\My)."
    }
    if (-not (Test-Path -LiteralPath $env:KIOSK_SIGN_CERT_FILE)) { throw "Fichier du certificat introuvable : $($env:KIOSK_SIGN_CERT_FILE)" }
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
        (Resolve-Path -LiteralPath $env:KIOSK_SIGN_CERT_FILE).Path, $env:KIOSK_SIGN_CERT_PASSWORD)
    if (-not $cert.HasPrivateKey) { throw 'Le fichier du certificat ne contient pas de clé privée.' }
    return $cert
}

function Test-Signature([string]$file) {
    $sig = Get-AuthenticodeSignature -LiteralPath $file
    if ($sig.Status -eq 'Valid') { return }
    $signer = $sig.SignerCertificate
    if ($signer -and $signer.Subject -eq $signer.Issuer -and $sig.Status -in 'UnknownError', 'NotTrusted') {
        Write-Warning "$file signé avec un certificat auto-signé (essai) : Windows ne l'approuve pas."
        return
    }
    throw "Signature refusée pour $file : $($sig.Status) $($sig.StatusMessage)"
}

if (-not ($env:KIOSK_SIGN_COMMAND -or $env:KIOSK_SIGN_CERT_THUMBPRINT -or $env:KIOSK_SIGN_CERT_FILE)) {
    throw 'Signature demandée sans certificat : définissez KIOSK_SIGN_CERT_THUMBPRINT, KIOSK_SIGN_CERT_FILE ou KIOSK_SIGN_COMMAND.'
}
$cert = if ($env:KIOSK_SIGN_COMMAND) { $null } else { Get-SigningCertificate }

foreach ($file in $Files) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Fichier à signer introuvable : $file" }
    $path = (Resolve-Path -LiteralPath $file).Path
    if ($env:KIOSK_SIGN_COMMAND) {
        & cmd.exe /d /c ($env:KIOSK_SIGN_COMMAND.Replace('{file}', '"' + $path + '"'))
        if ($LASTEXITCODE -ne 0) { throw "La commande de signature a échoué pour $path (code $LASTEXITCODE)." }
    } else {
        $result = Set-AuthenticodeSignature -LiteralPath $path -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $timestamp
        if ($result.Status -eq 'NotSigned' -or $result.Status -eq 'HashMismatch') {
            throw "Signature impossible pour $path : $($result.StatusMessage)"
        }
    }
    Test-Signature $path
    Write-Host "Signé : $path"
}
