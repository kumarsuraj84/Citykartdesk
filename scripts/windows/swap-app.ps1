# Swaps the Citykart Desk app folder on 10.0.1.98 for the new build, checks health, and puts the old build back by itself if the new one is not healthy.
# Lives on the app server at D:\Citykart_Applications\Citykart_Ckdesk_App\swap-app.ps1 (copy it there; it is not part of the build zip).
#
# SHORT DOWNTIME (was about 40 s): the slow part, unpacking the zip (thousands of small files), now happens BEFORE the app is stopped, into a side folder, while the
# old build keeps serving people. Only then is the app stopped, two folders are renamed (instant) and the app is started again. The app is down only for
# "stop + rename + start + first healthy answer" (typically 8-12 s). The health check also asks every second instead of every 3 seconds.
# If the new build does not become healthy, the old one is put back (also quickly) and the script exits with 1.
#
# Parameters exist only so the folder logic can be tested on a PC without the real service (tests/unit/swap-app-script.test.ts); on the server run it with no parameters.
param(
  [string]$Base = 'D:\Citykart_Applications\Citykart_Ckdesk_App',
  [string]$ServiceName = 'CkDeskApp',
  [string]$HealthUrl = 'http://127.0.0.1:3210',
  [int]$HealthTries = 60
)
$ErrorActionPreference = 'Stop'
$app  = "$Base\app"
$zip  = "$Base\ckdesk-deploy.zip"
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$bakName = "standalone-bak-$stamp"
$bak  = "$app\$bakName"
$next = "$app\standalone-next"
$live = "$app\standalone"

# a folder can stay locked for a moment after its process has stopped: try again for a few seconds before giving up
function Rename-Folder($from, $toName) {
  for ($i = 0; $i -lt 20; $i++) {
    try { Rename-Item $from $toName -ErrorAction Stop; return } catch { if ($i -eq 19) { throw }; Start-Sleep -Milliseconds 500 }
  }
}

function Healthy {
  for ($i = 0; $i -lt $HealthTries; $i++) {
    try {
      $h = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "$HealthUrl/api/health").Content
      if ($h -match '"status":"ok"' -and $h -match '"db":"ok"') { return $true }
    } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}

if (-not (Test-Path $zip)) { throw "zip not found: $zip" }
$stopwatch = [Diagnostics.Stopwatch]::StartNew()

# 1. unpack the new build next to the running one (the app is still up)
if (Test-Path $next) { Remove-Item $next -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $next -Force
if (-not (Test-Path "$live\.env.local")) { throw "no .env.local in the running build ($live)" }
Copy-Item "$live\.env.local" "$next\.env.local" -Force
if (-not (Test-Path "$next\server.js")) { Remove-Item $next -Recurse -Force; throw 'the unpacked build has no server.js: nothing was changed' }
"unpacked in $([int]$stopwatch.Elapsed.TotalSeconds) s (the app was still running)"

# 1b. keep the page files of the previous build. A browser tab that was open before the release still asks for the OLD page files (".next-deploy\static"); once they are gone the person
# sees "Loading chunk ... failed" and a blank page until they refresh (the system log held thousands of these). Only files the new build does not have are copied (a new file is
# never overwritten), and copied files older than 14 days are removed again so the folder cannot grow for ever. Any problem here is reported and ignored: it never stops a release.
$oldStatic = "$live\.next-deploy\static"
$newStatic = "$next\.next-deploy\static"
if ((Test-Path $oldStatic) -and (Test-Path $newStatic)) {
  try {
    # /XC /XN /XO = skip a file that already exists in the new build, whatever its state: only the missing ones are copied
    & robocopy $oldStatic $newStatic /E /XC /XN /XO /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    $cutoff = (Get-Date).AddDays(-14)
    Get-ChildItem $newStatic -Recurse -File | Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force -ErrorAction SilentlyContinue
    "kept the page files of the previous build for open browser tabs"
  } catch {
    "could not keep the old page files (the release goes on): $($_.Exception.Message)"
  }
}

# 2. the short part: stop, swap the folders, start
$down = [Diagnostics.Stopwatch]::StartNew()
try {
  Stop-Service $ServiceName -Force
  Rename-Folder $live $bakName
  Rename-Folder $next 'standalone'
} catch {
  # the folders could not be swapped: put things back as they were and start the old build again, so the app is never left stopped
  "FAILED before the new build started: $($_.Exception.Message) - restoring the old build"
  if (-not (Test-Path $live) -and (Test-Path $bak)) { Rename-Folder $bak 'standalone' }
  Start-Service $ServiceName
  exit 1
}
Start-Service $ServiceName
if (-not (Healthy)) {
  "FAILED: the new build did not become healthy - rolling back"
  Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
  if (Test-Path $live) { Remove-Item $live -Recurse -Force }
  Rename-Folder $bak 'standalone'
  Start-Service $ServiceName
  if (Healthy) { 'ROLLED BACK: the old build is running again' } else { 'ROLLBACK DID NOT BECOME HEALTHY - needs attention' }
  exit 1
}
$down.Stop()
"HEALTHY: " + (Invoke-WebRequest -UseBasicParsing "$HealthUrl/api/health").Content
"VERSION: " + (Invoke-WebRequest -UseBasicParsing "$HealthUrl/api/version").Content
"the app was out of service for about $([int]$down.Elapsed.TotalSeconds) s"
"backup of the previous build: $bak"
