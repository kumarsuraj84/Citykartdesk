# Changes ONE scheduled task: how often CitykartDesk-Cron-EmailReplySync runs (the check for e-mail replies to ticket mails). Default every 3 minutes (it was every minute).
# Load review of 18 Nov 2026: each pass takes 4 s typically and up to 28 s (it connects to Gmail), which made it the biggest single user of the app's time; a reply now shows within 3 minutes.
# Touches nothing else: the task keeps its own action, account and settings; only the repeat interval changes. Run on the app server (10.0.1.98) as Administrator.
# Back to every minute:  .\set-email-sync-interval.ps1 -Minutes 1
param([int]$Minutes = 3)
$ErrorActionPreference = 'Stop'
if ($Minutes -lt 1 -or $Minutes -gt 30) { throw 'Minutes must be between 1 and 30.' }
$name = 'CitykartDesk-Cron-EmailReplySync'
$task = Get-ScheduledTask -TaskName $name
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes $Minutes)
Set-ScheduledTask -TaskName $name -Trigger $trigger | Out-Null
$now = Get-ScheduledTask -TaskName $name
Write-Output ("{0}: now repeats every {1}, state {2}" -f $name, $now.Triggers[0].Repetition.Interval, $now.State)
