// Performance at scale on the isolated audit stack (synthetic data only). The size of the data set and the schema state are named by PERF_LABEL.
// Per operation: P50 / P95 / P99 in milliseconds over RUNS timed calls, as real signed-in users through the data API (row security on). Then write throughput
// with 1, 10 and 25 parallel updates (every audited update takes the System Log hash-chain lock), with the database container's CPU / memory, connections and
// waiting locks sampled during the run. Output: security-assessment-2026-10/07-FINAL-REMEDIATION/perf/perf-<PERF_LABEL>.json
import { describe, it, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
// Sampling runs in a separate process and never blocks the test (a blocking sampler would add its own seconds to the latencies being measured).
const run = promisify(execFile)
async function sample() {
  try {
    const st = JSON.parse((await run('docker', ['stats', '--no-stream', '--format', '{{json .}}', DB], { encoding: 'utf8' })).stdout.trim())
    const q = (await run('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-F', ',', '-c', 'select (select count(*) from pg_stat_activity), (select count(*) from pg_locks where not granted)'], { encoding: 'utf8' })).stdout.trim().split(',')
    return { cpu: st.CPUPerc as string, mem: st.MemUsage as string, connections: Number(q[0]), waiting_locks: Number(q[1]) }
  } catch { return null }
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
      const batches = Math.floor(Number(process.env.PERF_WRITES ?? 600) / parallel)
      let inFlight = false
      const sampler = setInterval(() => { if (inFlight) return; inFlight = true; void sample().then((s) => { if (s) samples.push(s) }).finally(() => { inFlight = false }) }, 3000)
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

    // ── System Log appends: every audit/security row takes the single hash-chain lock (system_log_chain_head FOR UPDATE), so this is where parallel writers queue ──
    const logWrites: Record<string, unknown> = {}
    const seqBefore = Number(psql('select seq from system_log_chain_head'))
    let appended = 0
    for (const parallel of [1, 10, 25]) {
      const per: number[] = []; let errors = 0
      const batches = Math.floor(Number(process.env.PERF_LOG_WRITES ?? 600) / parallel)
      const started = performance.now()
      for (let b = 0; b < batches; b++) {
        await Promise.all(Array.from({ length: parallel }, async (_, k) => {
          const t = performance.now()
          const r = await (admin as unknown as { from: (t: string) => { insert: (v: object) => Promise<{ error: unknown }> } }).from('system_log').insert({ category: 'audit', source: 'server_action', action: 'perf.append', message: `perf ${parallel} ${b} ${k}`, org_id: fx.orgId })
          if (r.error) errors++; else appended++
          per.push(performance.now() - t)
        }))
      }
      const seconds = (performance.now() - started) / 1000
      logWrites[`${parallel} parallel chained appends`] = { ...stats(per), errors, appends: per.length, seconds: Math.round(seconds * 10) / 10, appends_per_second: Math.round((per.length / seconds) * 10) / 10 }
    }
    out.system_log_appends = logWrites
    const seqAfter = Number(psql('select seq from system_log_chain_head'))
    out.chain_sequence_gap = (seqAfter - seqBefore) - appended              // 0 = every successful append took exactly one position in the chain (none lost, none duplicated)
    out.database_samples = samples
    out.system_log_rows = Number(psql('select count(*) from system_log'))
    // the hash chain of the audit rows is re-computed over the newest rows; the function returns the rows that do NOT fit, so 0 means intact
    out.chain_broken_rows = Number(psql('select count(*) from system_log_verify_chain((select greatest(seq - 20000, 0) from system_log_chain_head), 20000)'))
    out.chain_rows_verified = 20000
    mkdirSync('security-assessment-2026-10/07-FINAL-REMEDIATION/perf', { recursive: true })
    writeFileSync(`security-assessment-2026-10/07-FINAL-REMEDIATION/perf/perf-${process.env.PERF_LABEL ?? 'run'}.json`, JSON.stringify(out, null, 2))
    console.log(JSON.stringify(out, null, 1))
  }, 900_000)
})
