# Adds ONE scheduled task: CitykartDesk-HealthProbe, every minute, as SYSTEM (it can open the NAS folder).
# It runs scripts\health-probe.mjs: measures the app, the data service, the gateway and the NAS, stores one row per check for the Health & Performance page
# (platform owners only), opens / closes outages, and asks the app to run its own checks. It changes nothing else and sends nothing anywhere.
# Needs database migration 200 first (the health tables). Touches nothing else (unlike install-cron-tasks.ps1). Run once, as Administrator, on the app server (10.0.1.98).
# Remove with:  Unregister-ScheduledTask -TaskName 'CitykartDesk-HealthProbe' -Confirm:$false
$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script = Join-Path $appDir 'scripts\health-probe.mjs'
if (-not (Test-Path $script)) { throw "health-probe.mjs not found at $script - copy scripts\health-probe.mjs there first." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $node)) { throw "node.exe not found - edit `$node in this script." }
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $appDir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName 'CitykartDesk-HealthProbe' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed CitykartDesk-HealthProbe (every minute). First run within a minute; the Health page fills in a few minutes later.'
