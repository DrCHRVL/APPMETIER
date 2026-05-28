# ──────────────────────────────────────────────────────────────────────
# Tâche planifiée Windows — Export consultation AppMetier
#
# Met à jour automatiquement le paquet de consultation déposé sur le
# partage réseau, à intervalle régulier.
#
# INSTALLATION (à faire une fois, dans une console PowerShell admin) :
#
#   $script   = "C:\chemin\complet\vers\APPMETIER\scripts\scheduled-task.ps1"
#   $action   = New-ScheduledTaskAction `
#                 -Execute "powershell.exe" `
#                 -Argument "-ExecutionPolicy Bypass -File `"$script`""
#   $trigger  = New-ScheduledTaskTrigger `
#                 -Once -At (Get-Date) `
#                 -RepetitionInterval (New-TimeSpan -Minutes 15) `
#                 -RepetitionDuration ([TimeSpan]::MaxValue)
#   $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
#                 -DontStopOnIdleEnd -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1)
#   Register-ScheduledTask -TaskName "AppMetier_Export_Consultation" `
#     -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited
#
# DÉSINSTALLATION :
#   Unregister-ScheduledTask -TaskName "AppMetier_Export_Consultation" -Confirm:$false
# ──────────────────────────────────────────────────────────────────────

# ▼▼▼ À ADAPTER ▼▼▼
$RepoPath   = "C:\Users\<VOUS>\AppMetier"              # racine du repo sur votre PC
$TargetUser = "<identifiant.de.la.collegue>"            # son username dans users.json
$DeployDir  = "P:\Consultation_AppMetier"               # destination sur le partage
$LogFile    = "$env:TEMP\appmetier-consultation.log"    # journal
# ▲▲▲ À ADAPTER ▲▲▲

$ErrorActionPreference = 'Stop'
Set-Location -Path $RepoPath

"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  Démarrage export…" | Out-File -Append $LogFile

try {
    # node + npm doivent être dans le PATH. Si ce n'est pas le cas, mettez le chemin
    # absolu vers node.exe ici.
    & node "$RepoPath\scripts\export-consultation.js" `
        --user $TargetUser `
        --deploy $DeployDir 2>&1 | Out-File -Append $LogFile

    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  ✓ OK" | Out-File -Append $LogFile
} catch {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  ✖ Erreur : $_" | Out-File -Append $LogFile
    exit 1
}
