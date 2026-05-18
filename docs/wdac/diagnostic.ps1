# diagnostic.ps1 — Collecte d'informations WDAC pour le ticket DSI APPMETIER
#
# Script EN LECTURE SEULE. Ne modifie aucun paramètre du poste, ne tente
# aucune élévation, ne contourne aucune politique. Produit un fichier
# diagnostic-wdac.txt à joindre au ticket DSI.
#
# Usage :
#   Ouvrir PowerShell (pas besoin d'admin), naviguer dans le dossier où se
#   trouve ce script, puis :
#       powershell -ExecutionPolicy Bypass -File .\diagnostic.ps1
#
# Si ExecutionPolicy bloque le script lui-même, copier/coller le contenu
# directement dans une fenêtre PowerShell.

$ErrorActionPreference = 'Continue'
$report = "diagnostic-wdac.txt"

"=== Diagnostic WDAC — APPMETIER ===" | Out-File $report
"Date            : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File $report -Append
"Utilisateur     : $env:USERDOMAIN\$env:USERNAME" | Out-File $report -Append
"Poste           : $env:COMPUTERNAME" | Out-File $report -Append
"Version Windows : $((Get-CimInstance Win32_OperatingSystem).Caption) $((Get-CimInstance Win32_OperatingSystem).Version)" | Out-File $report -Append
"" | Out-File $report -Append

# 1. État de WDAC / Device Guard
"--- 1. État WDAC / Device Guard ---" | Out-File $report -Append
try {
    $dg = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard -ErrorAction Stop
    "CodeIntegrityPolicyEnforcementStatus   : $($dg.CodeIntegrityPolicyEnforcementStatus)" | Out-File $report -Append
    "UserModeCodeIntegrityPolicyEnforcement : $($dg.UsermodeCodeIntegrityPolicyEnforcementStatus)" | Out-File $report -Append
    "VirtualizationBasedSecurityStatus      : $($dg.VirtualizationBasedSecurityStatus)" | Out-File $report -Append
    "SecurityServicesConfigured             : $($dg.SecurityServicesConfigured -join ', ')" | Out-File $report -Append
    "SecurityServicesRunning                : $($dg.SecurityServicesRunning -join ', ')" | Out-File $report -Append
    "" | Out-File $report -Append
    "Interprétation : 0 = désactivé, 1 = audit only, 2 = enforced" | Out-File $report -Append
} catch {
    "ERREUR lors de la lecture Win32_DeviceGuard : $($_.Exception.Message)" | Out-File $report -Append
}
"" | Out-File $report -Append

# 2. Derniers blocages CodeIntegrity (event log)
"--- 2. Derniers événements de blocage Code Integrity ---" | Out-File $report -Append
"(Les events 3077 = bloque enforced, 3076 = aurait ete bloque en audit)" | Out-File $report -Append
"" | Out-File $report -Append
try {
    $events = Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 30 -ErrorAction Stop |
              Where-Object { $_.Id -in 3076, 3077 } |
              Select-Object -First 10
    if ($events) {
        foreach ($e in $events) {
            "[$($e.TimeCreated)] Event $($e.Id) — $($e.LevelDisplayName)" | Out-File $report -Append
            $e.Message -split "`n" | ForEach-Object { "    $_" } | Out-File $report -Append
            "" | Out-File $report -Append
        }
    } else {
        "Aucun event 3076/3077 dans les 30 derniers événements du journal." | Out-File $report -Append
    }
} catch {
    "ERREUR lors de la lecture du journal CodeIntegrity : $($_.Exception.Message)" | Out-File $report -Append
}
"" | Out-File $report -Append

# 3. Vérification de la présence et signature des binaires APPMETIER
"--- 3. Binaires APPMETIER détectés sur le poste ---" | Out-File $report -Append
$searchRoots = @(
    "$env:USERPROFILE\Documents\AppMetier - Audran",
    "$env:USERPROFILE\Documents\AppMetier",
    "$env:USERPROFILE\Desktop\AppMetier",
    $PSScriptRoot
) | Where-Object { Test-Path $_ } | Select-Object -Unique

if (-not $searchRoots) {
    "Aucun dossier AppMetier connu trouvé sous le profil utilisateur." | Out-File $report -Append
} else {
    foreach ($root in $searchRoots) {
        "Recherche dans : $root" | Out-File $report -Append
        $bins = Get-ChildItem -Path $root -Recurse -Include 'node.exe','electron.exe','next-swc.win32-x64-msvc.node' -ErrorAction SilentlyContinue
        if (-not $bins) {
            "    (aucun binaire cible trouve)" | Out-File $report -Append
            continue
        }
        foreach ($b in $bins) {
            $h = Get-FileHash -Path $b.FullName -Algorithm SHA256
            $sig = Get-AuthenticodeSignature -FilePath $b.FullName
            "    Fichier  : $($b.FullName)" | Out-File $report -Append
            "    Taille   : $($b.Length) octets" | Out-File $report -Append
            "    SHA-256  : $($h.Hash.ToLower())" | Out-File $report -Append
            "    Statut   : $($sig.Status)" | Out-File $report -Append
            if ($sig.SignerCertificate) {
                "    Signataire : $($sig.SignerCertificate.Subject)" | Out-File $report -Append
            } else {
                "    Signataire : (aucun — fichier non signé)" | Out-File $report -Append
            }
            "" | Out-File $report -Append
        }
    }
}

"=== Fin du diagnostic ===" | Out-File $report -Append

Write-Host ""
Write-Host "Rapport généré : $((Resolve-Path $report).Path)" -ForegroundColor Green
Write-Host "À joindre tel quel au ticket DSI."
