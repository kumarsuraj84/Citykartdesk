# Installs the Citykart Desk scheduled tasks (run once, as Administrator, on the server).
# Only creates/replaces tasks named CitykartDesk-Cron-*; touches nothing else.
#   CitykartDesk-Cron-Alerts         every 30 min  (due-soon / overdue alerts + 08:00 daily digest)
#   CitykartDesk-Cron-BusinessRules  every 15 min  (scheduled business rules / SLA escalation)
#   CitykartDesk-Cron-EmailReplySync every 10 min  (poll IMAP for replies to outbound emails)
$runner = Join-Path $PSScriptRoot 'run-cron-tick.ps1'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

function Install-Job($name, $job, $minutes) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Job $job"
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes $minutes)
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Write-Output "Installed $name (every $minutes min)"
}
Install-Job 'CitykartDesk-Cron-Alerts' 'alerts' 30
Install-Job 'CitykartDesk-Cron-BusinessRules' 'business-rules' 15
Install-Job 'CitykartDesk-Cron-EmailReplySync' 'email-reply-sync' 10
