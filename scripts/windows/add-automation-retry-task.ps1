# Adds ONE scheduled task: CitykartDesk-Cron-AutomationRetry, every 15 minutes (server time = India time).
# It finishes the automatic steps of new tickets that did not happen (the mail to the OEM / vendor, the Business Rules, the CVM approval), 3 tries per ticket at most, and never
# repeats a step that already worked. Touches nothing else (unlike install-cron-tasks.ps1, which re-registers every task). Run once, as Administrator, on the app server,
# AFTER the "Run automation again" release is deployed.
$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-cron-tick.ps1'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Job automation-retry"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'CitykartDesk-Cron-AutomationRetry' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed CitykartDesk-Cron-AutomationRetry (every 15 min)'
