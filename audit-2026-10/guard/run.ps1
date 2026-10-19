# Runs a command in AUDIT MODE: audit env loaded, egress guard preloaded, isolation gate must pass first.
#   powershell -NoProfile -File audit-2026-10\guard\run.ps1 -- npx vitest run tests/unit
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Cmd)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
foreach ($line in Get-Content (Join-Path $root 'audit-2026-10\env\.env.audit')) {
  if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z0-9_]+)\s*=(.*)$') { continue }
  [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process')
}
$guard = Join-Path $root 'audit-2026-10\guard\egress-guard.cjs'
$guardFwd = $guard.Replace([string][char]92, [string][char]47)
$env:NODE_OPTIONS = "--require `"$guardFwd`""
$env:AUDIT_EVIDENCE_DIR = Join-Path $root 'audit-2026-10\evidence'
Set-Location $root
node audit-2026-10\guard\isolation-check.mjs
if ($LASTEXITCODE -ne 0) { Write-Error 'Isolation gate FAILED - not running the command.'; exit 2 }
if ($Cmd -and $Cmd[0] -eq '--') { $Cmd = $Cmd[1..($Cmd.Length - 1)] }
if (-not $Cmd) { exit 0 }
& $Cmd[0] @($Cmd[1..($Cmd.Length - 1)])
exit $LASTEXITCODE
