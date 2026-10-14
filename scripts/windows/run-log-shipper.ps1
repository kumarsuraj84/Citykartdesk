# One pass of the System Log shipper: copies new PROBLEM lines from the service logs into the Citykart Desk System Log.
# Reads the shared secret from the app's .env.local (SYSTEM_LOG_INGEST_SECRET, else CRON_SECRET) so it is never stored in the task.
# Usage: run-log-shipper.ps1 [-LogDir <folder with CkDeskPostgrest.err.log ...>] [-Target http://127.0.0.1:3210]
param([string]$LogDir = '', [string]$Target = 'http://127.0.0.1:3210')

$appDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $LogDir) { $LogDir = Join-Path (Split-Path -Parent $appDir) 'logs' }
$envFile = Join-Path $appDir '.env.local'
if (-not (Test-Path $envFile)) { Write-Error ".env.local not found at $envFile"; exit 1 }

$secret = $null
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*(CRON_SECRET|SYSTEM_LOG_INGEST_SECRET)\s*=\s*(.+?)\s*$') {
    $v = $Matches[2].Trim('"').Trim("'")
    if ($Matches[1] -eq 'SYSTEM_LOG_INGEST_SECRET' -or -not $secret) { $secret = $v }
  }
}
if (-not $secret) { Write-Error 'Neither SYSTEM_LOG_INGEST_SECRET nor CRON_SECRET is set in .env.local'; exit 1 }

$env:SYSTEM_LOG_INGEST_SECRET = $secret
$env:SYSTEM_LOG_TARGET_URL = $Target
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }

# service log files that exist on this machine (PostgreSQL runs on the database server and is read there, see docs/SYSTEM-LOG.md)
$sources = @(
  @('postgrest', 'CkDeskPostgrest'), @('auth', 'CkDeskAuth'), @('storage', 'CkDeskStorage')
)
$shipperArgs = @((Join-Path $appDir 'scripts\log-shipper.mjs'), '--once', '--cursor', (Join-Path $LogDir 'system-log-shipper-cursor.json'))
foreach ($s in $sources) {
  foreach ($stream in 'err', 'out') {
    $f = Join-Path $LogDir "$($s[1]).$stream.log"
    if (Test-Path $f) { $shipperArgs += @('--file', "$($s[0])=$f") }
  }
}
if ($shipperArgs.Count -le 4) { Write-Error "No service logs found in $LogDir"; exit 1 }
& $node @shipperArgs
exit $LASTEXITCODE
