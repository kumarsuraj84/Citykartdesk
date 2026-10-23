# Installs the Citykart Desk scheduled tasks (run once, as Administrator, on the server).
# Only creates/replaces tasks named CitykartDesk-Cron-*; touches nothing else.
#   CitykartDesk-Cron-Alerts         every 30 min  (due-soon / overdue alerts + 08:00 daily digest)
#   CitykartDesk-Cron-BusinessRules  every 15 min  (scheduled business rules / SLA escalation)
#   CitykartDesk-Cron-EmailReplySync every 1 min   (poll IMAP for replies to outbound emails)
#   CitykartDesk-Cron-Csat           every 30 min  (auto-close resolved tickets past their reopen window + the one CSAT reminder)
#   CitykartDesk-Cron-SystemLogArchive every 6 hours (moves old System Log records to the archive; never deletes)
#   CitykartDesk-Cron-ApprovalReminders every day at 10:00 (one e-mail per approver listing everything still waiting for their decision)
#   CitykartDesk-LogShipper          every 2 min   (copies problems from the PostgREST / auth / storage logs into the System Log)
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
Install-Job 'CitykartDesk-Cron-EmailReplySync' 'email-reply-sync' 1
Install-Job 'CitykartDesk-Cron-Csat' 'csat' 30
Install-Job 'CitykartDesk-Cron-SystemLogArchive' 'system-log-archive' 360

# the log shipper has its own runner
$shipRunner = Join-Path $PSScriptRoot 'run-log-shipper.ps1'
$shipAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$shipRunner`""
$shipTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName 'CitykartDesk-LogShipper' -Action $shipAction -Trigger $shipTrigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed CitykartDesk-LogShipper (every 2 min)'

# engineer visit reports: auto-resolve after the deadline and the store reminder, every 15 minutes
Install-Job 'CitykartDesk-Cron-Visits' 'visit-automation' 15

# the AC / Genset / CVM Google Sheets are copied into the database three times a day (same times as lib/masters/schedule.ts)
$mastersAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Job masters-sync"
$mastersTriggers = @('11:00', '15:00', '19:00') | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
Register-ScheduledTask -TaskName 'CitykartDesk-Cron-MastersSync' -Action $mastersAction -Trigger $mastersTriggers -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed CitykartDesk-Cron-MastersSync (every day at 11:00, 15:00 and 19:00)'

# the daily approval reminder (one e-mail per approver listing everything still waiting), every day at 10:00
$remindAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Job approval-reminders"
$remindTrigger = New-ScheduledTaskTrigger -Daily -At '10:00'
Register-ScheduledTask -TaskName 'CitykartDesk-Cron-ApprovalReminders' -Action $remindAction -Trigger $remindTrigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed CitykartDesk-Cron-ApprovalReminders (every day at 10:00)'

# the daily outside temperature of every city with an AC (for the AC Calendar), every day at 08:00
$weatherAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Job weather-daily"
$weatherTrigger = New-ScheduledTaskTrigger -Daily -At '08:00'
Register-ScheduledTask -TaskName 'CitykartDesk-Cron-WeatherDaily' -Action $weatherAction -Trigger $weatherTrigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed CitykartDesk-Cron-WeatherDaily (every day at 08:00)'
