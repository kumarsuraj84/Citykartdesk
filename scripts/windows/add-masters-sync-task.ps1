# Adds ONE scheduled task: CitykartDesk-Cron-MastersSync, every day at 11:00, 15:00 and 19:00 (server time = India time).
# It copies the AC, Genset, CVM (and AC PMS) Google Sheets into the Citykart Desk database (read only: nothing is ever written to a sheet).
# Touches nothing else (unlike install-cron-tasks.ps1, which re-registers every task). Run once, as Administrator, on the app server, AFTER the
# Sheet Masters release is deployed and Google Sheets is connected (Admin > Sheet Masters). Same times as lib/masters/schedule.ts.
$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-cron-tick.ps1'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Job masters-sync"
$triggers = @('11:00', '15:00', '19:00') | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
Register-ScheduledTask -TaskName 'CitykartDesk-Cron-MastersSync' -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed CitykartDesk-Cron-MastersSync (every day at 11:00, 15:00 and 19:00)'
