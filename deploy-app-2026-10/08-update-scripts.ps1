# STEP 8 - run on 10.0.1.98 (PowerShell as Administrator), after the app swap (04) said DONE.
# Copies the updated scheduler / log-shipper scripts into app\scripts (the folder OUTSIDE standalone), keeping a dated copy of the old ones first.
#   cron-tick.mjs                  stricter failure detection (a job whose answer says the work failed is reported), time limits per job, no forced exit
#   log-shipper.mjs                the log shipper's fixes
#   windows\run-log-shipper.ps1    the runner of the log shipper task
#   windows\install-cron-tasks.ps1 used only when the tasks are installed from scratch
# No scheduled task is added, removed or changed: the existing tasks keep their names and times and simply run the new files from their next start.
# Usage:   .\08-update-scripts.ps1 -NewScripts D:\release\scripts      (the "scripts" folder that came in the release folder)
param(
  [Parameter(Mandatory = $true)][string]$NewScripts,
  [string]$Root = 'D:\Citykart_Applications\Citykart_Ckdesk_App'
)
$ErrorActionPreference = 'Stop'
$dst = Join-Path $Root 'app\scripts'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Start-Transcript -Path (Join-Path $PSScriptRoot "update-scripts-$stamp.log") | Out-Null
try {
  $files = 'cron-tick.mjs', 'log-shipper.mjs', 'windows\run-log-shipper.ps1', 'windows\install-cron-tasks.ps1'
  foreach ($need in $files) { if (-not (Test-Path (Join-Path $NewScripts $need))) { throw "missing in the release folder: $need" } }
  if (-not (Select-String -Path (Join-Path $NewScripts 'cron-tick.mjs') -Pattern 'automation-retry' -Quiet)) { throw 'cron-tick.mjs in the release folder does not know the job automation-retry.' }
  "--- copy of the old scripts"
  Copy-Item $dst (Join-Path $Root "app\scripts-bak-$stamp") -Recurse
  "kept: app\scripts-bak-$stamp"
  "--- new scripts"
  foreach ($f in $files) { Copy-Item (Join-Path $NewScripts $f) (Join-Path $dst $f) -Force; "copied $f" }
  "--- scheduled tasks (unchanged - all should be Ready)"
  Get-ScheduledTask -TaskName 'CitykartDesk-*' | ForEach-Object { '{0,-38} {1}' -f $_.TaskName, $_.State }
  "DONE. The next run of each task uses the new files."
}
catch { "STOPPED: $($_.Exception.Message)"; "The old scripts (if copied) are in app\scripts-bak-$stamp." }
finally { Stop-Transcript | Out-Null }
