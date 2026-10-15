// VAPT 2026-10 performance check on the isolated audit stack (3,000 synthetic tickets): the security changes must not make the common operations slower.
// Bounded synthetic workload only. Results are written to security-assessment-2026-10/05-REMEDIATION/perf-<PERF_LABEL>.json.
import { describe, it, beforeAll, afterAll } from 'vitest'
import { writeFileSync } from 'node:fs'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

let fx: D03Fixtures
beforeAll(async () => { fx = await setupD03Fixtures() }, 180_000)
afterAll(async () => { await fx?.cleanup() }, 120_000)

const RUNS = 40
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 10) / 10 }
async function time(fn: () => Promise<unknown>) {
  await fn()                                                       // warm-up
  const xs: number[] = []
  for (let i = 0; i < RUNS; i++) { const t = performance.now(); await fn(); xs.push(performance.now() - t) }
  return { p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), runs: RUNS }
}

describe('latency of security-sensitive operations (milliseconds)', () => {
  it('measures and records', async () => {
    const manager = clientForToken(fx.manager.accessToken)
    const agent = clientForToken(fx.agentA.accessToken)
    const requester = clientForToken(fx.requesterA.accessToken)
    const out: Record<string, unknown> = { label: process.env.PERF_LABEL ?? 'run', at: new Date().toISOString(), tickets_in_audit_db: (await getAdmin().from('requests').select('id', { count: 'exact', head: true })).count }
    out['manager: list 1000 tickets (row security over the whole organisation)'] = await time(async () => { const r = await manager.from('requests').select('id,priority,status,title').order('created_at', { ascending: false }).limit(1000); if (r.error) throw r.error })
    out['manager: count all tickets'] = await time(async () => { const r = await manager.from('requests').select('id', { count: 'exact', head: true }); if (r.error) throw r.error })
    out['technician: list own group tickets'] = await time(async () => { const r = await agent.from('requests').select('id,priority,status,title').limit(500); if (r.error) throw r.error })
    out['requester: list own tickets'] = await time(async () => { const r = await requester.from('requests').select('id,priority,status,title').limit(200); if (r.error) throw r.error })
    out['technician: edit a ticket (update trigger path)'] = await time(async () => { const r = await agent.from('requests').update({ description: `perf ${Math.random()}` }).eq('id', fx.requestA.id); if (r.error) throw r.error })
    out['requester: read attachments rows of a ticket'] = await time(async () => { const r = await requester.from('request_attachments').select('id').eq('request_id', fx.requestA.id); if (r.error) throw r.error })
    out['search: manager title search'] = await time(async () => { const r = await manager.from('requests').select('id,title').ilike('title', '%a%').limit(50); if (r.error) throw r.error })
    writeFileSync(`security-assessment-2026-10/05-REMEDIATION/perf-${process.env.PERF_LABEL ?? 'run'}.json`, JSON.stringify(out, null, 2))
    console.log(JSON.stringify(out, null, 1))
  })
})
