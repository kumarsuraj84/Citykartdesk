# STEP 1 - run on 10.0.1.98 (PowerShell as Administrator). READ ONLY: changes nothing. Prints the state before the release and saves it next to this script.
# Keep the output: it is the "before" picture for a rollback.
$ErrorActionPreference = 'Continue'
$Root = 'D:\Citykart_Applications\Citykart_Ckdesk_App'
$out = Join-Path $PSScriptRoot ("precheck-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Start-Transcript -Path $out | Out-Null
"host $env:COMPUTERNAME  $(Get-Date)"
"--- services"
Get-Service CkDesk* | ForEach-Object { '{0,-18} {1}' -f $_.Name, $_.Status }
"--- scheduled tasks"
Get-ScheduledTask -TaskName 'CitykartDesk*' -ErrorAction SilentlyContinue | ForEach-Object { $i = Get-ScheduledTaskInfo $_; '{0,-38} {1,-8} last result {2}' -f $_.TaskName, $_.State, $i.LastTaskResult }
"--- live build and health"
try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3210/api/version' -TimeoutSec 10).Content } catch { "version: $($_.Exception.Message)" }
try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3210/api/health' -TimeoutSec 10).Content } catch { "health: $($_.Exception.Message)" }
"--- folders in app\"
Get-ChildItem "$Root\app" -Directory | ForEach-Object { '{0,-34} {1}' -f $_.Name, $_.LastWriteTime }
"--- free space (GB)"
foreach ($d in 'C','D') { $p = Get-PSDrive $d -ErrorAction SilentlyContinue; if ($p) { '{0}: {1:N1}' -f $d, ($p.Free/1GB) } }
"--- key NAMES in app\standalone\.env.local (values are never printed)"
$env1 = "$Root\app\standalone\.env.local"
$names = @(); foreach ($l in (Get-Content $env1)) { if ($l -match '^\s*([A-Za-z0-9_]+)\s*=') { $names += $Matches[1] } }
$names -join ', '
foreach ($need in 'GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','OAUTH_STATE_SECRET','OAUTH_REDIRECT_BASE_URL') { '{0,-30} {1}' -f $need, $(if ($names -contains $need) { 'present' } else { 'MISSING (step 3 adds it)' }) }
"--- internet from this server (TCP 443, nothing sent)"
foreach ($h in 'oauth2.googleapis.com','sheets.googleapis.com','api.open-meteo.com','geocoding-api.open-meteo.com','archive-api.open-meteo.com') {
  $ok = $false; try { $c = New-Object System.Net.Sockets.TcpClient; $iar = $c.BeginConnect($h, 443, $null, $null); $ok = $iar.AsyncWaitHandle.WaitOne(6000) -and $c.Connected; $c.Close() } catch {}
  '{0,-34} {1}' -f $h, $(if ($ok) { 'reachable' } else { 'NOT reachable' })
}
"--- old scheduled task that must not exist"
if (Get-ScheduledTask -TaskName 'CitykartDesk-Cron-Visits' -ErrorAction SilentlyContinue) { 'CitykartDesk-Cron-Visits EXISTS (step 6 removes it)' } else { 'CitykartDesk-Cron-Visits not present (good)' }
"saved to $out"
Stop-Transcript | Out-Null
