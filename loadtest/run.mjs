#!/usr/bin/env node
// Conductor: spawns N genuinely separate `vitest run` processes against
// loadtest/vitest.config.ts, one per shard, all at once - real OS-level
// concurrency, not a sequential loop. Phase 8 safety: refuses to run
// without an explicit target, requires confirmation for Main.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const env = process.env.LOADTEST_ENV
if (env !== 'local' && env !== 'main') {
  console.error(`LOADTEST_ENV must be "local" or "main" (got: ${JSON.stringify(env)}). Refusing to run.`)
  process.exit(1)
}
if (env === 'main' && process.env.LOADTEST_CONFIRM_MAIN !== 'yes-run-against-main') {
  console.error('Targeting MAIN requires LOADTEST_CONFIRM_MAIN=yes-run-against-main. Refusing to run.')
  process.exit(1)
}
const RUN_ID = process.env.LOADTEST_RUN_ID
if (!RUN_ID) { console.error('LOADTEST_RUN_ID must be set.'); process.exit(1) }

const WORKERS = Number(process.env.LOADTEST_WORKERS || 10)
console.log(`[loadtest] TARGET=${env.toUpperCase()} runId=${RUN_ID} workers=${WORKERS}`)

const startedAt = Date.now()
const children = []
for (let i = 0; i < WORKERS; i++) {
  const child = spawn(
    'npx',
    ['vitest', 'run', '--config', 'loadtest/vitest.config.ts'],
    {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        LOADTEST_WORKER_INDEX: String(i),
        LOADTEST_TOTAL_WORKERS: String(WORKERS),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    }
  )
  child.stdout.on('data', (d) => process.stdout.write(`[w${i}] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[w${i}] ${d}`))
  children.push(new Promise((resolve) => child.on('exit', (code) => resolve({ i, code }))))
}

const outcomes = await Promise.all(children)
const durationS = ((Date.now() - startedAt) / 1000).toFixed(1)
const failed = outcomes.filter((o) => o.code !== 0)
console.log(`[loadtest] All ${WORKERS} workers finished in ${durationS}s. Failed workers: ${failed.length}/${WORKERS}`)
if (failed.length) console.log('[loadtest] Failed worker indices:', failed.map((f) => f.i))
process.exit(failed.length > 0 ? 1 : 0)
