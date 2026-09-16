#!/usr/bin/env node
// Aggregates every worker's loadtest/results/<runId>/worker-*.ndjson into
// P50/P95/P99/throughput/error-rate per scenario.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUN_ID = process.argv[2] || process.env.LOADTEST_RUN_ID
if (!RUN_ID) { console.error('Usage: node loadtest/report.mjs <runId>'); process.exit(1) }

const dir = path.resolve(__dirname, 'results', RUN_ID)
const files = readdirSync(dir).filter((f) => f.endsWith('.ndjson'))

const byScenario = new Map()
let totalOk = 0
let totalFail = 0
let firstAt = null
let lastAt = null

for (const file of files) {
  const lines = readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    const sample = JSON.parse(line)
    if (!byScenario.has(sample.scenario)) byScenario.set(sample.scenario, [])
    byScenario.get(sample.scenario).push(sample)
    if (sample.ok) totalOk++; else totalFail++
    const t = new Date(sample.at).getTime()
    if (firstAt === null || t < firstAt) firstAt = t
    if (lastAt === null || t > lastAt) lastAt = t
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return Math.round(sorted[idx])
}

console.log(`\n=== Load Test Report: ${RUN_ID} ===`)
console.log(`Workers/files: ${files.length}`)
console.log(`Total samples: ${totalOk + totalFail} (ok: ${totalOk}, failed: ${totalFail}, error rate: ${((totalFail / Math.max(1, totalOk + totalFail)) * 100).toFixed(2)}%)`)
if (firstAt && lastAt) {
  const spanS = (lastAt - firstAt) / 1000
  console.log(`Wall-clock span: ${spanS.toFixed(1)}s, aggregate throughput: ${((totalOk + totalFail) / Math.max(1, spanS)).toFixed(1)} ops/s`)
}

console.log('\nScenario         | Count | OK  | Fail | P50ms | P95ms | P99ms')
console.log('------------------|-------|-----|------|-------|-------|------')
for (const [scenario, samples] of byScenario) {
  const ok = samples.filter((s) => s.ok)
  const fail = samples.filter((s) => !s.ok)
  const sorted = ok.map((s) => s.ms).sort((a, b) => a - b)
  console.log(
    `${scenario.padEnd(17)} | ${String(samples.length).padStart(5)} | ${String(ok.length).padStart(3)} | ${String(fail.length).padStart(4)} | ` +
    `${String(percentile(sorted, 50)).padStart(5)} | ${String(percentile(sorted, 95)).padStart(5)} | ${String(percentile(sorted, 99)).padStart(5)}`
  )
}

if (totalFail > 0) {
  console.log('\n-- Sample errors (first 10) --')
  const allFailed = [...byScenario.values()].flat().filter((s) => !s.ok).slice(0, 10)
  for (const f of allFailed) console.log(`  [${f.scenario}] ${f.error}`)
}
