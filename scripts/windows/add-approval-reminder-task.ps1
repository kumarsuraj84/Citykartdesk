# Adds ONE scheduled task: CitykartDesk-Cron-ApprovalReminders, every day at 10:00 (server time = India time).
# It runs the approval reminders job (one e-mail per approver listing everything still waiting for their decision).
# Touches nothing else (unlike install-cron-tasks.ps1, which re-registers every task). Run once, as Administrator, on the app server.
$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-cron-tick.ps1'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Job approval-reminders"
$trigger = New-ScheduledTaskTrigger -Daily -At '10:00'
Register-ScheduledTask -TaskName 'CitykartDesk-Cron-ApprovalReminders' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed CitykartDesk-Cron-ApprovalReminders (every day at 10:00)'
