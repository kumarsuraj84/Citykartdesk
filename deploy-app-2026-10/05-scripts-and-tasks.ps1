# STEP 5 - run on 10.0.1.98 (PowerShell as Administrator), after step 4 said DONE.
# 1. Copies the new scheduler scripts into app\scripts (the folder OUTSIDE standalone), keeping a dated copy of the old ones first.
# 2. Adds the THREE new scheduled tasks (each script touches only its own task; the seven existing tasks are not changed).
# 3. Removes the old "CitykartDesk-Cron-Visits" task if it exists.
# Usage:   .\05-scripts-and-tasks.ps1 -NewScripts D:\release\scripts      (the "scripts" folder that came in the release folder)
param(
  [Parameter(Mandatory = $true)][string]$NewScripts,
  [string]$Root = 'D:\Citykart_Applications\Citykart_Ckdesk_App'
)
$ErrorActionPreference = 'Stop'
$dst = Join-Path $Root 'app\scripts'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Start-Transcript -Path (Join-Path $PSScriptRoot "scripts-and-tasks-$stamp.log") | Out-Null
try {
  foreach ($need in 'cron-tick.mjs', 'windows\add-masters-sync-task.ps1', 'windows\add-pms-task.ps1', 'windows\add-weather-task.ps1') {
    if (-not (Test-Path (Join-Path $NewScripts $need))) { throw "missing in the release folder: $need" }
  }
  "--- copy of the old scripts"
  Copy-Item $dst (Join-Path $Root "app\scripts-bak-$stamp") -Recurse
  "kept: app\scripts-bak-$stamp"
  "--- new scripts"
  Copy-Item (Join-Path $NewScripts 'cron-tick.mjs') (Join-Path $dst 'cron-tick.mjs') -Force
  foreach ($n in 'add-masters-sync-task.ps1', 'add-pms-task.ps1', 'add-weather-task.ps1', 'install-cron-tasks.ps1') {
    Copy-Item (Join-Path $NewScripts "windows\$n") (Join-Path $dst "windows\$n") -Force
  }
  "--- scheduled tasks (before)"
  Get-ScheduledTask -TaskName 'CitykartDesk-Cron-*' | ForEach-Object { $_.TaskName }
  if (Get-ScheduledTask -TaskName 'CitykartDesk-Cron-Visits' -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName 'CitykartDesk-Cron-Visits' -Confirm:$false
    'removed the old CitykartDesk-Cron-Visits task'
  }
  & (Join-Path $dst 'windows\add-masters-sync-task.ps1')
  & (Join-Path $dst 'windows\add-weather-task.ps1')
  & (Join-Path $dst 'windows\add-pms-task.ps1')
  "--- scheduled tasks (after) - the old ones plus MastersSync, WeatherDaily, PmsDaily, all Ready:"
  Get-ScheduledTask -TaskName 'CitykartDesk-*' | ForEach-Object { '{0,-38} {1}' -f $_.TaskName, $_.State }
  "DONE. Next: the admin set-up in the browser (connect Google, sheets, AC PMS service)."
}
catch { "STOPPED: $($_.Exception.Message)"; "The old scripts (if copied) are in app\scripts-bak-$stamp." }
finally { Stop-Transcript | Out-Null }
