import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { dbHostCpuVerdict, dbHostDiskVerdict, dbHostMemoryVerdict, dbHostRows, parseDbHostReport } from '@/lib/health/db-host'
import { vitalsToMetrics } from '@/lib/observability/app-vitals'
import { CHECKS, METRICS } from '@/lib/health/catalog'
import { auditSecrets, getSecret } from '@/lib/secrets'

const GB = 1024 ** 3
const good = { cpuPct: 12.34, memTotalBytes: 64 * GB, memFreeBytes: 40 * GB, disks: [{ name: 'D:', totalBytes: 500 * GB, freeBytes: 300 * GB }, { name: 'e', totalBytes: 1000 * GB, freeBytes: 700 * GB }] }

describe('database server reporter: what is accepted', () => {
  it('a sensible report is accepted and tidied (drive letters like "e" become "E:")', () => {
    const r = parseDbHostReport(good)
    expect(r?.cpuPct).toBe(12.3)
    expect(r?.disks.map((d) => d.name)).toEqual(['D:', 'E:'])
  })
  it('anything odd is refused', () => {
    const bad = [null, 'x', 5, {}, { ...good, cpuPct: 101 }, { ...good, cpuPct: -1 }, { ...good, cpuPct: 'high' }, { ...good, memTotalBytes: 0 },
      { ...good, memFreeBytes: 65 * GB }, { ...good, disks: 'D:' }, { ...good, disks: Array.from({ length: 13 }, () => good.disks[0]) },
      { ...good, disks: [{ name: 'share', totalBytes: 1, freeBytes: 1 }] }, { ...good, disks: [{ name: 'D:', totalBytes: 10, freeBytes: 11 }] },
      { ...good, cpuPct: Number.NaN }]
    for (const b of bad) expect(parseDbHostReport(b), JSON.stringify(b)?.slice(0, 60)).toBeNull()
  })
})

describe('database server reporter: the verdicts', () => {
  it('CPU: good below 90, a problem at 90 and over', () => {
    expect(dbHostCpuVerdict(89.9).ok).toBe(true)
    expect(dbHostCpuVerdict(90).ok).toBe(false)
  })
  it('memory: the share in use, a problem at 92% and over', () => {
    expect(dbHostMemoryVerdict(100 * GB, 50 * GB)).toMatchObject({ ok: true, pct: 50 })
    expect(dbHostMemoryVerdict(100 * GB, 8 * GB)).toMatchObject({ ok: false, pct: 92 })
  })
  it('disks: low under 10% free OR under 5 GB free, and the emptiest one is reported', () => {
    expect(dbHostDiskVerdict([{ name: 'D:', totalBytes: 500 * GB, freeBytes: 300 * GB }])).toMatchObject({ ok: true, lowestFreePct: 60 })
    const lowPct = dbHostDiskVerdict([{ name: 'D:', totalBytes: 1000 * GB, freeBytes: 99 * GB }, { name: 'E:', totalBytes: 100 * GB, freeBytes: 50 * GB }])
    expect(lowPct.ok).toBe(false)
    expect(lowPct.detail).toContain('D: 9.9% free')
    expect(lowPct.lowestFreePct).toBe(9.9)
    expect(dbHostDiskVerdict([{ name: 'C:', totalBytes: 20 * GB, freeBytes: 4 * GB }]).ok).toBe(false)   // 20% free but under 5 GB
    expect(dbHostDiskVerdict([])).toMatchObject({ ok: true, lowestFreePct: null })
  })
  it('one report gives one sample per check and the chart numbers', () => {
    const rows = dbHostRows(parseDbHostReport(good)!)
    expect(rows.samples.map((s) => s.check_key)).toEqual(['dbhost_cpu', 'dbhost_memory', 'dbhost_disk'])
    expect(rows.samples.every((s) => s.ok)).toBe(true)
    expect(rows.metrics.map((m) => m.metric)).toEqual(['dbhost_cpu_pct', 'dbhost_mem_pct', 'dbhost_disk_free_pct'])
    const noDisks = dbHostRows(parseDbHostReport({ ...good, disks: [] })!)
    expect(noDisks.samples.map((s) => s.check_key)).toEqual(['dbhost_cpu', 'dbhost_memory'])
  })
  it('the three checks and the chart numbers exist in the catalog (page, alerts and charts all read it)', () => {
    for (const k of ['dbhost_cpu', 'dbhost_memory', 'dbhost_disk']) { const c = CHECKS.find((x) => x.key === k); expect(c?.group).toBe('server'); expect(c?.by).toBe('app') }
    const keys = new Set<string>(METRICS.map((m) => m.key))
    const stored = [
      ...dbHostRows(parseDbHostReport(good)!).metrics.map((m) => m.metric),
      ...vitalsToMetrics({ loopMaxMs: 1, loopP99Ms: 1, calls: { calls: 1, slow: 0, hedged: 0, hedgeWon: 0, timeouts: 0, maxMs: 1 } }).map((m) => m.metric).filter((m) => !['loop_p99_ms', 'data_calls', 'data_max_ms'].includes(m)),
      'db_latency_ms',
    ]
    for (const k of stored) expect(keys.has(k), k).toBe(true)
  })
})

describe('database server reporter: its own secret', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  it('has its own variable, is optional, never falls back to CRON_SECRET, and a short value is reported', () => {
    vi.stubEnv('HEALTH_AGENT_SECRET', '')
    vi.stubEnv('CRON_SECRET', 'a-cron-secret-that-is-long-enough')
    vi.stubEnv('ALLOW_SHARED_SECRET_FALLBACK', '1')
    expect(getSecret('health_agent')).toBeNull()
    expect(auditSecrets({}).some((i) => i.env === 'HEALTH_AGENT_SECRET')).toBe(false)         // optional: not reported when unset
    expect(auditSecrets({ HEALTH_AGENT_SECRET: 'short' }).some((i) => i.env === 'HEALTH_AGENT_SECRET' && /shorter/.test(i.problem))).toBe(true)
  })
})

describe('POST /api/health/db-host', () => {
  const SECRET = 'agent-secret-0123456789'
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock('@/lib/supabase/admin') })

  const call = async (headers: Record<string, string>, body: unknown, secret: string = SECRET) => {
    vi.stubEnv('HEALTH_AGENT_SECRET', secret)
    const inserted: { table: string; rows: unknown[] }[] = []
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => ({ insert: async (rows: unknown[]) => { inserted.push({ table, rows }); return { error: null } } }) }) }))
    const { POST } = await import('@/app/api/health/db-host/route')
    const res = await POST(new NextRequest('http://localhost:3210/api/health/db-host', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }))
    return { res, inserted }
  }

  it('is off (503) while the secret is not set, and nothing is stored', async () => {
    const { res, inserted } = await call({ 'x-health-agent-secret': SECRET }, good, '')
    expect(res.status).toBe(503)
    expect(inserted).toHaveLength(0)
  })
  it('refuses a missing or wrong secret (401) and stores nothing', async () => {
    for (const headers of [{}, { 'x-health-agent-secret': 'nope' }, { 'x-health-agent-secret': SECRET + 'x' }] as Record<string, string>[]) {
      const { res, inserted } = await call(headers, good)
      expect(res.status).toBe(401)
      expect(inserted).toHaveLength(0)
    }
  })
  it('refuses a bad body (400) and an oversized one (413)', async () => {
    expect((await call({ 'x-health-agent-secret': SECRET }, 'not json')).res.status).toBe(400)
    expect((await call({ 'x-health-agent-secret': SECRET }, { ...good, cpuPct: 500 })).res.status).toBe(400)
    expect((await call({ 'x-health-agent-secret': SECRET }, JSON.stringify({ pad: 'x'.repeat(5000) }))).res.status).toBe(413)
  })
  it('stores the samples and the chart numbers for a good report, and the answer carries no detail', async () => {
    const { res, inserted } = await call({ 'x-health-agent-secret': SECRET }, good)
    expect(res.status).toBe(200)
    expect(inserted.map((i) => i.table)).toEqual(['health_samples', 'health_metrics'])
    expect(inserted[0].rows).toHaveLength(3)
    expect(JSON.stringify(await res.json())).not.toMatch(/cpu|memory|disk/i)
  })
})
