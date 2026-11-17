# Same protections as audit-2026-10\guard\run.ps1 (audit env loaded, egress guard preloaded, isolation gate must pass first),
# but the command is passed as ONE string so flags such as --reporter are not mangled.
#   powershell -NoProfile -File docs\qa-full-audit-2026-11\evidence\audit-run.ps1 -Command "npx vitest run tests/unit"
param([Parameter(Mandatory = $true)][string]$Command, [switch]$SkipGate)
$ErrorActionPreference = 'Stop'
$root = 'D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate'
foreach ($line in Get-Content (Join-Path $root 'audit-2026-10\env\.env.audit')) {
  if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z0-9_]+)\s*=(.*)$') { continue }
  [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process')
}
$guardFwd = (Join-Path $root 'audit-2026-10\guard\egress-guard.cjs').Replace([string][char]92, [string][char]47)
$env:NODE_OPTIONS = "--require `"$guardFwd`""
$env:AUDIT_EVIDENCE_DIR = Join-Path $root 'audit-2026-10\evidence'
Set-Location $root
if (-not $SkipGate) {
  node audit-2026-10\guard\isolation-check.mjs | Select-Object -Last 3
  if ($LASTEXITCODE -ne 0) { Write-Error 'Isolation gate FAILED - not running the command.'; exit 2 }
}
$ErrorActionPreference = 'Continue'
Invoke-Expression $Command
exit $LASTEXITCODE
