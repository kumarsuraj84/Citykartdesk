# Builds the app (production mode, webpack) with the AUDIT env baked in, then starts it on :3310 with the egress guard preloaded.
# The build step is the only thing run without the guard: it downloads web fonts from Google (next/font) and executes no application code.
param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = 'D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate'
Set-Location $root
foreach ($line in Get-Content (Join-Path $root 'audit-2026-10\env\.env.audit')) {
  if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z0-9_]+)\s*=(.*)$') { continue }
  [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process')
}
$env:NEXT_DIST_DIR = '.next-audit'
$env:CK_BUILD_ID = 'vapt-audit'
$env:NODE_OPTIONS = ''
if (-not $SkipBuild) {
  & npx next build --webpack *> (Join-Path $root 'security-assessment-2026-10\02-VAPT\work\audit-build.log')
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
}
cmd /c "git checkout tsconfig.json >nul 2>&1"
$guard = (Join-Path $root 'audit-2026-10\guard\egress-guard.cjs').Replace('\', '/')
$env:NODE_OPTIONS = "--require `"$guard`""
$env:AUDIT_EVIDENCE_DIR = Join-Path $root 'audit-2026-10\evidence'
$env:PORT = '3310'
$env:HOSTNAME = '127.0.0.1'
node audit-2026-10\guard\isolation-check.mjs
if ($LASTEXITCODE -ne 0) { throw 'isolation gate failed' }
Start-Process -FilePath 'npx.cmd' -ArgumentList 'next','start','-p','3310','-H','127.0.0.1' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'security-assessment-2026-10\02-VAPT\work\audit-app.log') -RedirectStandardError (Join-Path $root 'security-assessment-2026-10\02-VAPT\work\audit-app.err.log')
Start-Sleep -Seconds 8
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3310/api/health).Content
