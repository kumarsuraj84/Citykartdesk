# ROLLBACK of the app only - run on 10.0.1.98 (PowerShell as Administrator). Puts the newest standalone-bak-* folder back as the running app.
# It does NOT touch the database (the new tables stay; they are harmless for the old app) and does NOT remove the three new scheduled tasks
# (disable them with:  Disable-ScheduledTask CitykartDesk-Cron-MastersSync, CitykartDesk-Cron-PmsDaily, CitykartDesk-Cron-WeatherDaily ).
# Usage:   .\rollback-app.ps1
param([string]$Root = 'D:\Citykart_Applications\Citykart_Ckdesk_App')
$ErrorActionPreference = 'Stop'
$app = Join-Path $Root 'app'
$bak = Get-ChildItem $app -Directory -Filter 'standalone-bak-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $bak) { throw 'no standalone-bak-* folder found' }
"will put back: $($bak.Name)  ($($bak.LastWriteTime))"
$ok = Read-Host 'Type YES to continue'
if ($ok -ne 'YES') { 'cancelled'; return }
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
Stop-Service CkDeskApp
Start-Sleep -Seconds 3
Rename-Item (Join-Path $app 'standalone') (Join-Path $app "standalone-failed-$stamp")
Rename-Item $bak.FullName (Join-Path $app 'standalone')
Start-Service CkDeskApp
Start-Sleep -Seconds 15
try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3210/api/health' -TimeoutSec 10).Content; (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3210/api/version' -TimeoutSec 10).Content } catch { "health failed: $($_.Exception.Message)" }
"The failed new app is kept as standalone-failed-$stamp (remove it later)."
