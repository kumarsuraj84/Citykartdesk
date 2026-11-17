// QA 2026-11 — PRODUCTION-MODE copy of the app for performance testing. Isolated audit stack only (same guard, same gate as start-demo.cjs).
//   node docs/qa-full-audit-2026-11/perf/start-audit-prod.cjs [--build-only]
// Builds into .next-audit-prod (never touches .next or .next-deploy) and serves on port 3311.
const fs = require('fs'), path = require('path'), { spawn, spawnSync } = require('child_process')
const root = path.resolve(__dirname, '..', '..', '..')
for (const line of fs.readFileSync(path.join(root, 'audit-2026-10', 'env', '.env.audit'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=(.*)$/.exec(line); if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].trim()
}
const guard = path.join(root, 'audit-2026-10', 'guard', 'egress-guard.cjs').replace(/\\/g, '/')
process.env.NODE_OPTIONS = `--require "${guard}" --max-old-space-size=4096`
process.env.AUDIT_EVIDENCE_DIR = path.join(root, 'audit-2026-10', 'evidence')
process.env.NEXT_DIST_DIR = '.next-audit-prod'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3311'
process.env.NODE_ENV = 'production'
const gate = spawnSync(process.execPath, [path.join(root, 'audit-2026-10', 'guard', 'isolation-check.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } })
if (gate.status !== 0) { console.error('Isolation gate FAILED - nothing started.'); process.exit(2) }
const next = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
if (!fs.existsSync(path.join(root, '.next-audit-prod', 'BUILD_ID')) || process.argv.includes('--rebuild')) {
  console.log('building production bundle into .next-audit-prod ...')
  const b = spawnSync(process.execPath, [next, 'build'], { cwd: root, stdio: 'inherit', env: process.env })
  if (b.status !== 0) { console.error('build failed'); process.exit(b.status || 1) }
}
if (process.argv.includes('--build-only')) process.exit(0)
const child = spawn(process.execPath, [next, 'start', '--port', '3311'], { cwd: root, stdio: 'inherit', env: process.env })
child.on('exit', (code) => process.exit(code ?? 0))
