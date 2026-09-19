# Runs one Citykart Desk scheduled job (calls the app's own /api/.../run endpoint).
# Reads CRON_SECRET from the app's .env.local so the secret is never stored in the task.
# Usage: run-cron-tick.ps1 -Job alerts|business-rules
param([Parameter(Mandatory = $true)][string]$Job, [string]$Target = 'http://127.0.0.1:3210')

$appDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $appDir '.env.local'
if (-not (Test-Path $envFile)) { Write-Error ".env.local not found at $envFile"; exit 1 }

$secret = $null
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*CRON_SECRET\s*=\s*(.+?)\s*$') { $secret = $Matches[1].Trim('"').Trim("'") }
}
if (-not $secret) { Write-Error 'CRON_SECRET missing in .env.local'; exit 1 }

$env:CRON_SECRET = $secret
$env:CRON_TARGET_URL = $Target
$env:CRON_JOBS = $Job
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
& $node (Join-Path $appDir 'scripts\cron-tick.mjs')
exit $LASTEXITCODE
