# Adds ONE scheduled task: CitykartDesk-Cron-PmsDaily, every day at 09:00 (server time = India time).
# It re-reads the AC PMS Google Sheet (read only) and makes the AC PMS tickets whose PMS date is today. Touches nothing else
# (unlike install-cron-tasks.ps1, which re-registers every task). Run once, as Administrator, on the app server, AFTER the AC PMS release is deployed.
$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-cron-tick.ps1'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Job pms-daily"
$trigger = New-ScheduledTaskTrigger -Daily -At '09:00'
Register-ScheduledTask -TaskName 'CitykartDesk-Cron-PmsDaily' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed CitykartDesk-Cron-PmsDaily (every day at 09:00)'
