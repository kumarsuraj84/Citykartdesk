# STEP 6 - run on 10.0.1.98 any time after the release (and again the next morning). READ ONLY. Prints what to look at.
$Root = 'D:\Citykart_Applications\Citykart_Ckdesk_App'
"host $env:COMPUTERNAME  $(Get-Date)"
"--- services (all Running)"
Get-Service CkDesk* | ForEach-Object { '{0,-18} {1}' -f $_.Name, $_.Status }
"--- build and health"
try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3210/api/version' -TimeoutSec 10).Content } catch { "version: $($_.Exception.Message)" }
try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3210/api/health' -TimeoutSec 10).Content } catch { "health: $($_.Exception.Message)" }
"--- scheduled tasks (last result must be 0 once they have run)"
Get-ScheduledTask -TaskName 'CitykartDesk-*' | ForEach-Object { $i = Get-ScheduledTaskInfo $_; '{0,-38} {1,-8} last run {2}  result {3}  next {4}' -f $_.TaskName, $_.State, $i.LastRunTime, $i.LastTaskResult, $i.NextRunTime }
"--- app error log: lines of the last 30 minutes that mention an error (count only, then the first 5)"
$lg = Join-Path $Root 'logs\CkDeskApp.err.log'
if (Test-Path $lg) {
  $since = (Get-Date).AddMinutes(-30)
  $lines = Get-Content $lg -Tail 600
  $hits = @($lines | Where-Object { $_ -match 'error|Error|ERR' })
  "error-like lines in the last 600 log lines: $($hits.Count)"
  $hits | Select-Object -First 5 | ForEach-Object { $_.Substring(0, [math]::Min(200, $_.Length)) }
}
"--- the four settings of the Google connection are in .env.local (names only)"
$names = @(); foreach ($l in (Get-Content (Join-Path $Root 'app\standalone\.env.local'))) { if ($l -match '^\s*([A-Za-z0-9_]+)\s*=') { $names += $Matches[1] } }
foreach ($need in 'GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','OAUTH_STATE_SECRET','OAUTH_REDIRECT_BASE_URL') { '{0,-30} {1}' -f $need, $(if ($names -contains $need) { 'present' } else { 'MISSING' }) }
"--- folders in app\ (the newest standalone-bak-* is your rollback copy; keep it for 24 hours)"
Get-ChildItem (Join-Path $Root 'app') -Directory | ForEach-Object { '{0,-34} {1}' -f $_.Name, $_.LastWriteTime }
