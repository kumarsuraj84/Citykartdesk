$ErrorActionPreference = 'Continue'
$root = 'D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate'
$out = Join-Path $root 'docs\qa-full-audit-2026-11\evidence\final'
$run = Join-Path $root 'audit-2026-10\guard\run.ps1'
function Step($name, $args2) {
  $t = Get-Date
  & powershell -NoProfile -File $run -- @args2 *> (Join-Path $out "$name.log")
  "$name exit=$LASTEXITCODE seconds=$([int]((Get-Date)-$t).TotalSeconds)" | Out-File -Append (Join-Path $out 'summary.txt')
}
Remove-Item (Join-Path $out 'summary.txt') -ErrorAction SilentlyContinue
Step 'tsc' @('node','node_modules/typescript/lib/tsc.js','--noEmit')
Step 'eslint' @('node','node_modules/eslint/bin/eslint.js','app','lib','components','types','proxy.ts','instrumentation.ts','next.config.ts','scripts')
Step 'unit-integration' @('npx','vitest','run','--reporter=json','--outputFile=docs/qa-full-audit-2026-11/evidence/final/main.json')
Step 'remediation' @('npx','vitest','run','-c','vitest.remediation.config.ts','--reporter=json','--outputFile=docs/qa-full-audit-2026-11/evidence/final/remediation.json')
Step 'vapt' @('npx','vitest','run','-c','vitest.vapt.config.ts','--reporter=json','--outputFile=docs/qa-full-audit-2026-11/evidence/final/vapt.json')
"DONE" | Out-File -Append (Join-Path $out 'summary.txt')
