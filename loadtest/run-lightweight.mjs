#!/usr/bin/env node
// Single-process conductor for concurrent-runner.worker.ts. Unlike run.mjs
// (which spawns one OS process per shard - the fork-storm proven on
// 2026-09-16 to consume 4.4x more CPU than Main's own services), this
// spawns exactly ONE vitest process; all concurrency happens inside it via
// AsyncLocalStorage-scoped personas + a bounded Promise pool.
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

console.log(`[loadtest-lightweight] TARGET=${env.toUpperCase()} runId=${RUN_ID} concurrency=${process.env.LOADTEST_CONCURRENCY ?? 15}`)

const startedAt = Date.now()
const child = spawn('npx', ['vitest', 'run', '--config', 'loadtest/vitest.lightweight.config.ts'], {
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
  shell: true,
})
child.on('exit', (code) => {
  const durationS = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[loadtest-lightweight] Finished in ${durationS}s, exit=${code}`)
  process.exit(code ?? 1)
})
