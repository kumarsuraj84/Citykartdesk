# STEP 4 - run on 10.0.1.98 (PowerShell as Administrator), ONLY AFTER the database script on 10.0.0.205 said DONE.
# What it does, in this order, and stops at the first problem:
#   1. Restarts CkDeskPostgrest (it must learn the new tables) and proves it can see them (one read of an empty new table, status code only).
#   2. Checks the zip (exists, 8-80 MB).
#   3. Stops CkDeskApp, renames app\standalone to app\standalone-bak-<time> (the rollback copy), expands the zip to app\standalone,
#      copies .env.local back from the bak folder, starts CkDeskApp.
#   4. Waits for /api/health = ok and shows /api/version. If the app does not come up in 90 seconds it ROLLS BACK by itself.
# Usage:   .\04-swap-app.ps1 -Zip D:\release\ckdesk-20261027.zip
param(
  [Parameter(Mandatory = $true)][string]$Zip,
  [string]$Root = 'D:\Citykart_Applications\Citykart_Ckdesk_App'
)
$ErrorActionPreference = 'Stop'
$app = Join-Path $Root 'app'
$cur = Join-Path $app 'standalone'
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$bak = Join-Path $app "standalone-bak-$stamp"
$log = Join-Path $PSScriptRoot "swap-app-$stamp.log"
Start-Transcript -Path $log | Out-Null

function Get-EnvValue($file, $name) { foreach ($l in (Get-Content $file)) { if ($l -match "^\s*$name\s*=\s*(.*)$") { return $Matches[1].Trim().Trim('"').Trim("'") } } return $null }
function Wait-Health($seconds) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3210/api/health' -TimeoutSec 5; if ($r.Content -match '"status"\s*:\s*"ok"' -and $r.Content -match '"db"\s*:\s*"ok"') { return $true } } catch {}
    Start-Sleep -Seconds 3
  }
  return $false
}

$swapped = $false
try {
  "--- 1. PostgREST restart and schema check"
  if (-not (Test-Path $cur)) { throw "not found: $cur" }
  Restart-Service CkDeskPostgrest
  Start-Sleep -Seconds 12
  if ((Get-Service CkDeskPostgrest).Status -ne 'Running') { throw 'CkDeskPostgrest is not running after the restart.' }
  $envFile = Join-Path $cur '.env.local'
  $svcKey = Get-EnvValue $envFile 'SUPABASE_SERVICE_ROLE_KEY'
  $base = Get-EnvValue $envFile 'SUPABASE_URL'
  if (-not $svcKey -or -not $base) { throw 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found in .env.local.' }
  foreach ($tbl in 'master_sources', 'vendor_companies', 'master_pms_dates') {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "$base/rest/v1/${tbl}?select=*&limit=1" -Headers @{ apikey = $svcKey; Authorization = "Bearer $svcKey" } -TimeoutSec 15
      "table $tbl visible to PostgREST: HTTP $($r.StatusCode)"
    } catch { throw "PostgREST cannot see the table $tbl ($($_.Exception.Message)). The database migrations (175-185) are NOT in place - do not continue." }
  }
  $svcKey = $null

  "--- 2. zip"
  if (-not (Test-Path $Zip)) { throw "zip not found: $Zip" }
  $mb = [math]::Round((Get-Item $Zip).Length / 1MB, 1)
  "zip size: $mb MB"
  if ($mb -lt 8 -or $mb -gt 80) { throw "The zip is $mb MB; expected about 20-25 MB. A very large zip is the node_modules-junction problem. Nothing was changed." }

  "--- 3. swap"
  Stop-Service CkDeskApp
  Start-Sleep -Seconds 3
  Rename-Item $cur $bak
  $swapped = $true
  Expand-Archive -Path $Zip -DestinationPath $cur -Force
  if (-not (Test-Path (Join-Path $cur 'server.js'))) {
    "server.js not found directly in $cur - checking one level down"
    $inner = Get-ChildItem $cur -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'server.js') } | Select-Object -First 1
    if ($inner) { Get-ChildItem $inner.FullName -Force | Move-Item -Destination $cur; Remove-Item $inner.FullName -Recurse -Force }
  }
  if (-not (Test-Path (Join-Path $cur 'server.js'))) { throw 'The new folder has no server.js - the zip is not the standalone build.' }
  Copy-Item (Join-Path $bak '.env.local') (Join-Path $cur '.env.local') -Force
  Start-Service CkDeskApp

  "--- 4. health"
  if (Wait-Health 90) {
    "health OK"
    try { "version: " + (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3210/api/version' -TimeoutSec 10).Content } catch {}
    "Rollback copy kept: $bak"
    "DONE. Next: step 5 (scripts and scheduled tasks), then the admin set-up."
  } else {
    throw 'The app did not become healthy within 90 seconds.'
  }
}
catch {
  "STOPPED: $($_.Exception.Message)"
  if ($swapped) {
    "ROLLING BACK to $bak"
    Stop-Service CkDeskApp -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    if (Test-Path $cur) { Rename-Item $cur (Join-Path $app "standalone-failed-$stamp") }
    Rename-Item $bak $cur
    Start-Service CkDeskApp
    if (Wait-Health 90) { 'Rolled back: the previous app is running again.' } else { 'Rollback done but health is not OK - look at the logs folder, file CkDeskApp.err.log.' }
  } else { 'Nothing was swapped: the running app is unchanged.' }
  "Keep this log: $log"
}
finally { Stop-Transcript | Out-Null }
