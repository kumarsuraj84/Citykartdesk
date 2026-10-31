# Adds ONE scheduled task: CitykartDesk-Cron-ScheduledReports, every 30 minutes.
# It sends the scheduled reports (Admin > Reports > Scheduled reports) that are due: daily reports at 07:00 India time, weekly ones on Monday at 07:00, monthly ones on the 1st at 07:00.
# A report is never sent twice (the app claims it before sending). Touches nothing else (unlike install-cron-tasks.ps1, which re-registers every task).
# Run once, as Administrator, on the app server, AFTER the release that contains /api/reports/run is deployed.
$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-cron-tick.ps1'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Job scheduled-reports"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'CitykartDesk-Cron-ScheduledReports' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed CitykartDesk-Cron-ScheduledReports (every 30 minutes)'
