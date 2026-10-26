// QA APP LAUNCHER (local only). Starts the app on port 3310 against the ISOLATED audit stack (never the dev stack, never a real server):
//   - audit environment loaded, egress guard preloaded, the isolation gate must pass first (same steps as audit-2026-10/guard/run.ps1 and the demo launcher);
//   - the sheets are read from the QA sample CSV files (MASTERS_DEMO_DIR), nothing goes to Google;
//   - MAIL_SINK_DIR makes every e-mail a file in qa-release-candidate-2026-10/evidence/mail-sink/ (nothing is sent);
//   - mode "dev" (default) runs `next dev`; mode "prod" runs `next start` on a build made with NEXT_DIST_DIR=.next-audit-prod (used for the performance runs).
// Usage:  node qa-release-candidate-2026-10/tooling/qa-start.cjs [dev|prod]
const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..', '..')
const mode = process.argv[2] === 'prod' ? 'prod' : 'dev'
for (const line of fs.readFileSync(path.join(root, 'audit-2026-10', 'env', '.env.audit'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=(.*)$/.exec(line)
  if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].trim()
}
const guard = path.join(root, 'audit-2026-10', 'guard', 'egress-guard.cjs').replace(/\\/g, '/')
process.env.NODE_OPTIONS = `--require "${guard}"`
process.env.AUDIT_EVIDENCE_DIR = path.join(root, 'audit-2026-10', 'evidence')
process.env.NEXT_DIST_DIR = mode === 'prod' ? '.next-audit-prod' : '.next-audit'
process.env.MASTERS_DEMO_DIR = path.join(root, 'qa-release-candidate-2026-10', 'tooling', 'sheets')
if (mode === 'dev') process.env.MAIL_SINK_DIR = path.join(root, 'qa-release-candidate-2026-10', 'evidence', 'mail-sink')
process.env.VISIT_CODE_SECRET = 'qa-only-visit-code-secret-0123456789'

const gate = spawnSync(process.execPath, [path.join(root, 'audit-2026-10', 'guard', 'isolation-check.mjs')], { cwd: root, stdio: 'inherit', env: process.env })
if (gate.status !== 0) { console.error('Isolation gate FAILED - the QA app was not started.'); process.exit(2) }
const next = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
const args = mode === 'prod' ? [next, 'start', '--port', '3310'] : [next, 'dev', '--port', '3310']
if (mode === 'prod') process.env.NODE_ENV = 'production'
const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env })
child.on('exit', (code) => process.exit(code ?? 0))
