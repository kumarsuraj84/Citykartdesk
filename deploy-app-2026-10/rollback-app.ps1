# ROLLBACK of the app only - run on 10.0.1.98 (PowerShell as Administrator). Puts the newest standalone-bak-* folder back as the running app.
# "Newest" is read from the timestamp in the FOLDER NAME (standalone-bak-yyyyMMdd-HHmm), not from the folder's modified time: renaming a folder does not
# change its modified time, so the old way could pick an older build. The chosen build id is printed before anything is changed.
# It does NOT touch the database (the new tables stay; they are harmless for the old app) and does NOT remove the new scheduled tasks
# (disable them with:  Disable-ScheduledTask CitykartDesk-Cron-MastersSync, CitykartDesk-Cron-PmsDaily, CitykartDesk-Cron-WeatherDaily ).
# Do NOT roll back to a build older than the security release once database migration 165 or later is applied (see docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md).
# Usage:   .\rollback-app.ps1            (asks you to type YES)
#          .\rollback-app.ps1 -Confirm   (no question; for a deliberate, scripted use)
#          .\rollback-app.ps1 -Name standalone-bak-20261027-1015   (choose the folder yourself)
param([string]$Root = 'D:\Citykart_Applications\Citykart_Ckdesk_App', [string]$Name = '', [switch]$Confirm)
$ErrorActionPreference = 'Stop'
$app = Join-Path $Root 'app'
$all = @(Get-ChildItem $app -Directory -Filter 'standalone-bak-*' | Where-Object { $_.Name -match '^standalone-bak-(\d{8}-\d{4,6})$' } |
  Sort-Object { $_.Name -replace '^standalone-bak-', '' } -Descending)
if ($all.Count -eq 0) { throw 'no standalone-bak-<yyyyMMdd-HHmm> folder found' }
"available (newest first by the time in the name):"
$all | ForEach-Object { "  $($_.Name)" }
$bak = if ($Name) { $all | Where-Object { $_.Name -eq $Name } | Select-Object -First 1 } else { $all[0] }
if (-not $bak) { throw "no folder named $Name" }
if (-not (Test-Path (Join-Path $bak.FullName 'server.js'))) { throw "$($bak.Name) has no server.js - it is not a complete app folder" }

# which build is that? (the build id the folder was made with, when it can be read)
$buildId = '(unknown)'
foreach ($rel in '.next-deploy\BUILD_ID', '.next\BUILD_ID') {
  $f = Join-Path $bak.FullName $rel
  if (Test-Path $f) { $buildId = (Get-Content $f -Raw).Trim(); break }
}
"will put back: $($bak.Name)   build id: $buildId"
if (-not $Confirm) {
  $ok = Read-Host 'Type YES to continue'
  if ($ok -ne 'YES') { 'cancelled'; return }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
Stop-Service CkDeskApp
Start-Sleep -Seconds 3
Rename-Item (Join-Path $app 'standalone') (Join-Path $app "standalone-failed-$stamp")
Rename-Item $bak.FullName (Join-Path $app 'standalone')
Start-Service CkDeskApp
Start-Sleep -Seconds 15
try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3210/api/health' -TimeoutSec 10).Content; (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3210/api/version' -TimeoutSec 10).Content } catch { "health failed: $($_.Exception.Message)" }
"The failed new app is kept as standalone-failed-$stamp (remove it later)."
