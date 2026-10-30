# STEP 7 - run on 10.0.1.98 (PowerShell as Administrator), after the app swap (04) said DONE.
# 1. Copies the updated scheduler script cron-tick.mjs (it learns the job "automation-retry") and the task scripts into app\scripts (the folder OUTSIDE standalone), keeping a dated copy of the old ones first.
# 2. Adds ONE scheduled task: CitykartDesk-Cron-AutomationRetry (every 15 minutes). The other tasks are not touched.
# Usage:   .\07-automation-task.ps1 -NewScripts D:\release\scripts-automation      (the "scripts" folder copied from the release: cron-tick.mjs and windows\add-automation-retry-task.ps1, windows\install-cron-tasks.ps1)
param(
  [Parameter(Mandatory = $true)][string]$NewScripts,
  [string]$Root = 'D:\Citykart_Applications\Citykart_Ckdesk_App'
)
$ErrorActionPreference = 'Stop'
$dst = Join-Path $Root 'app\scripts'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Start-Transcript -Path (Join-Path $PSScriptRoot "automation-task-$stamp.log") | Out-Null
try {
  foreach ($need in 'cron-tick.mjs', 'windows\add-automation-retry-task.ps1', 'windows\install-cron-tasks.ps1') {
    if (-not (Test-Path (Join-Path $NewScripts $need))) { throw "missing in the release folder: $need" }
  }
  if (-not (Select-String -Path (Join-Path $NewScripts 'cron-tick.mjs') -Pattern 'automation-retry' -Quiet)) { throw 'cron-tick.mjs in the release folder does not know the job automation-retry.' }
  "--- copy of the old scripts"
  Copy-Item $dst (Join-Path $Root "app\scripts-bak-$stamp") -Recurse
  "kept: app\scripts-bak-$stamp"
  "--- new scripts"
  Copy-Item (Join-Path $NewScripts 'cron-tick.mjs') (Join-Path $dst 'cron-tick.mjs') -Force
  foreach ($n in 'add-automation-retry-task.ps1', 'install-cron-tasks.ps1') { Copy-Item (Join-Path $NewScripts "windows\$n") (Join-Path $dst "windows\$n") -Force }
  "--- scheduled tasks (before)"
  Get-ScheduledTask -TaskName 'CitykartDesk-*' | ForEach-Object { '{0,-38} {1}' -f $_.TaskName, $_.State }
  & (Join-Path $dst 'windows\add-automation-retry-task.ps1')
  "--- scheduled tasks (after) - the old ones plus AutomationRetry, all Ready:"
  Get-ScheduledTask -TaskName 'CitykartDesk-*' | ForEach-Object { '{0,-38} {1}' -f $_.TaskName, $_.State }
  "DONE."
}
catch { "STOPPED: $($_.Exception.Message)"; "The old scripts (if copied) are in app\scripts-bak-$stamp." }
finally { Stop-Transcript | Out-Null }
