# Adds ONE scheduled task: CitykartDesk-Cron-WeatherDaily, every day at 08:00 (server time = India time).
# It saves the highest and lowest outside temperature of every city that has an AC, for the AC Calendar on the Smart Dashboard.
# Touches nothing else (unlike install-cron-tasks.ps1, which re-registers every task). Run once, as Administrator, on the app server.
# The server must be able to reach api.open-meteo.com, geocoding-api.open-meteo.com and archive-api.open-meteo.com (https, outbound). Only city names are sent.
$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-cron-tick.ps1'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Job weather-daily"
$trigger = New-ScheduledTaskTrigger -Daily -At '08:00'
Register-ScheduledTask -TaskName 'CitykartDesk-Cron-WeatherDaily' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed CitykartDesk-Cron-WeatherDaily (every day at 08:00)'
