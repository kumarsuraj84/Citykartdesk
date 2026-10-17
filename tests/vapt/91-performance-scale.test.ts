// Performance at scale on the isolated audit stack (synthetic data only). The size of the data set and the schema state are named by PERF_LABEL.
// Per operation: P50 / P95 / P99 in milliseconds over RUNS timed calls, as real signed-in users through the data API (row security on). Then write throughput
// with 1, 10 and 25 parallel updates (every audited update takes the System Log hash-chain lock), with the database container's CPU / memory, connections and
// waiting locks sampled during the run. Output: security-assessment-2026-10/07-FINAL-REMEDIATION/perf/perf-<PERF_LABEL>.json
import { describe, it, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

let fx: D03Fixtures
beforeAll(async () => { fx = await setupD03Fixtures() }, 240_000)
afterAll(async () => { await fx?.cleanup() }, 120_000)

const RUNS = Number(process.env.PERF_RUNS ?? 40)
const DB = 'supabase_db_ckdesk_audit'
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 10) / 10 }
const stats = (xs: number[]) => ({ p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), runs: xs.length })
async function time(fn: () => Promise<unknown>) {
  await fn()                                                            // warm-up
  const xs: number[] = []; let errors = 0
  for (let i = 0; i < RUNS; i++) { const t = performance.now(); try { await fn() } catch { errors++ } xs.push(performance.now() - t) }
  return { ...stats(xs), errors }
}
const psql = (sql: string) => execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', sql], { encoding: 'utf8' }).trim()
function dockerStats() {
  try {
    const j = JSON.parse(execFileSync('docker', ['stats', '--no-stream', '--format', '{{json .}}', DB], { encoding: 'utf8' }).trim())
    return { cpu: j.CPUPerc, mem: j.MemUsage }
  } catch { return { cpu: 'n/a', mem: 'n/a' } }
}

describe('latency and throughput at scale', () => {
  it('measures and records', async () => {
    const admin = getAdmin()
    const manager = clientForToken(fx.manager.accessToken)
    const agent = clientForToken(fx.agentA.accessToken)
    const requester = clientForToken(fx.requesterA.accessToken)
    const total = Number(psql('select count(*) from requests'))
    const out: Record<string, unknown> = { label: process.env.PERF_LABEL ?? 'run', at: new Date().toISOString(), tickets: total, runs_per_operation: RUNS }

    // ── latency of reads (the same operations as the 3,000-ticket baseline, plus the ones this remediation touched) ──
    const ops: Record<string, () => Promise<unknown>> = {
      'manager: list 1000 tickets': async () => { const r = await manager.from('requests').select('id,priority,status,title').order('created_at', { ascending: false }).limit(1000); if (r.error) throw r.error },
      'manager: count all tickets': async () => { const r = await manager.from('requests').select('id', { count: 'exact', head: true }); if (r.error) throw r.error },
      'technician: list own group tickets': async () => { const r = await agent.from('requests').select('id,priority,status,title').limit(500); if (r.error) throw r.error },
      'requester: list own tickets': async () => { const r = await requester.from('requests').select('id,priority,status,title').limit(200); if (r.error) throw r.error },
      'technician: open one ticket': async () => { const r = await agent.from('requests').select('id,priority,status,title,description').eq('id', fx.requestA.id).single(); if (r.error) throw r.error },
      'requester: attachment rows of a ticket': async () => { const r = await requester.from('request_attachments').select('id').eq('request_id', fx.requestA.id); if (r.error) throw r.error },
      'manager: title search': async () => { const r = await manager.from('requests').select('id,title').ilike('title', '%a%').limit(50); if (r.error) throw r.error },
      'requester: list people they can see (profile rule)': async () => { const r = await requester.from('profiles').select('id,full_name').limit(1000); if (r.error) throw r.error },
      'technician: list people': async () => { const r = await agent.from('profiles').select('id,full_name').limit(1000); if (r.error) throw r.error },
      'requester: home dashboard': async () => { const r = await requester.rpc('get_home_dashboard', { p_is_manager: false, p_is_agent: false, p_has_tasks: false }); if (r.error) throw r.error },
      'manager: home dashboard': async () => { const r = await manager.rpc('get_home_dashboard', { p_is_manager: true, p_is_agent: true, p_has_tasks: true }); if (r.error) throw r.error },
      'technician: activity of one ticket': async () => { const r = await agent.from('request_activity').select('id,action').eq('request_id', fx.requestA.id).limit(100); if (r.error) throw r.error },
    }
    const reads: Record<string, unknown> = {}
    for (const [name, fn] of Object.entries(ops)) reads[name] = await time(fn)
    out.reads_ms = reads

    // ── writes under parallel load: updates of different tickets through the server's key (each update is audited into the hash-chained System Log) ──
    const ids = (await admin.from('requests').select('id').limit(400)).data!.map((r) => r.id as string)
    const writes: Record<string, unknown> = {}
    const samples: { cpu: string; mem: string; connections: number; waiting_locks: number }[] = []
    for (const parallel of [1, 10, 25]) {
      const per: number[] = []; let errors = 0
      const batches = Math.floor(120 / parallel)
      const sampler = setInterval(() => {
        try { const s = dockerStats(); samples.push({ ...s, connections: Number(psql('select count(*) from pg_stat_activity')), waiting_locks: Number(psql('select count(*) from pg_locks where not granted')) }) } catch { /* sampling is best effort */ }
      }, 4000)
      const started = performance.now()
      for (let b = 0; b < batches; b++) {
        await Promise.all(Array.from({ length: parallel }, async (_, k) => {
          const id = ids[(b * parallel + k) % ids.length]
          const t = performance.now()
          const r = await admin.from('requests').update({ description: `perf ${parallel} ${b} ${k}` }).eq('id', id)
          if (r.error) errors++
          per.push(performance.now() - t)
        }))
      }
      clearInterval(sampler)
      const seconds = (performance.now() - started) / 1000
      writes[`${parallel} parallel updates`] = { ...stats(per), errors, updates: per.length, seconds: Math.round(seconds * 10) / 10, updates_per_second: Math.round((per.length / seconds) * 10) / 10 }
    }
    out.writes = writes
    out.database_samples = samples
    out.system_log_rows = Number(psql('select count(*) from system_log'))
    out.chain_still_valid = psql("select (system_log_verify_chain(0, 1000)::jsonb)->>'ok'")
    mkdirSync('security-assessment-2026-10/07-FINAL-REMEDIATION/perf', { recursive: true })
    writeFileSync(`security-assessment-2026-10/07-FINAL-REMEDIATION/perf/perf-${process.env.PERF_LABEL ?? 'run'}.json`, JSON.stringify(out, null, 2))
    console.log(JSON.stringify(out, null, 1))
  })
})
