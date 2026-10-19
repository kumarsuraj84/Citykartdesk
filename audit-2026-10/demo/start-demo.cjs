// LOCAL DEMO ONLY. Starts the app on port 3310 against the ISOLATED audit stack (never the dev stack, never a real server): the same steps as
// audit-2026-10/guard/run.ps1 (audit environment, egress guard preloaded, isolation gate must pass first), then `next dev`, with:
//   - the three sheets read from the sample CSV files in audit-2026-10/demo/sheets (MASTERS_DEMO_DIR; ignored by a production build),
//   - the engineer visit page switched on (VISIT_CODE_SECRET, a demo-only value).
// Used by the preview configuration "citykart-desk-demo" in .claude/launch.json.
const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..', '..')
for (const line of fs.readFileSync(path.join(root, 'audit-2026-10', 'env', '.env.audit'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=(.*)$/.exec(line)
  if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].trim()
}
const guard = path.join(root, 'audit-2026-10', 'guard', 'egress-guard.cjs').replace(/\\/g, '/')
process.env.NODE_OPTIONS = `--require "${guard}"`
process.env.AUDIT_EVIDENCE_DIR = path.join(root, 'audit-2026-10', 'evidence')
process.env.NEXT_DIST_DIR = '.next-audit'
process.env.MASTERS_DEMO_DIR = path.join(root, 'audit-2026-10', 'demo', 'sheets')
process.env.VISIT_CODE_SECRET = 'demo-only-visit-code-secret-0123456789'

const gate = spawnSync(process.execPath, [path.join(root, 'audit-2026-10', 'guard', 'isolation-check.mjs')], { cwd: root, stdio: 'inherit', env: process.env })
if (gate.status !== 0) {
  console.error('Isolation gate FAILED - the demo was not started.')
  process.exit(2)
}
const child = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--port', '3310'], { cwd: root, stdio: 'inherit', env: process.env })
child.on('exit', (code) => process.exit(code ?? 0))
