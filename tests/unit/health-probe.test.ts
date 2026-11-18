// The server checks of the one-minute health probe (scripts/health-probe.mjs): the decisions are pure functions, so each rule has a test.
import { describe, it, expect } from 'vitest'
import { cpuPercent, cpuVerdict, memoryVerdict, diskVerdict, parseServiceState, servicesVerdict, LIMITS, DEFAULT_SERVICES } from '../../scripts/health-probe.mjs'
import { dbLoadVerdict } from '@/lib/health/evaluate'
import { CHECKS, METRICS, SERVER_LIMITS } from '@/lib/health/catalog'

const GB = 1024 ** 3
const cpu = (user: number, sys: number, idle: number) => ({ times: { user, nice: 0, sys, idle, irq: 0 } })

describe('CPU', () => {
  it('is the share of time that was not idle between two snapshots, all cores together', () => {
    expect(cpuPercent([cpu(0, 0, 0), cpu(0, 0, 0)], [cpu(50, 0, 50), cpu(50, 0, 50)])).toBe(50)
    expect(cpuPercent([cpu(10, 10, 80)], [cpu(10, 10, 180)])).toBe(0)
    expect(cpuPercent([cpu(0, 0, 0)], [cpu(95, 5, 0)])).toBe(100)
    expect(cpuPercent([cpu(5, 5, 5)], [cpu(5, 5, 5)])).toBe(0)          // no time passed: never a divide by zero
  })
  it('fails at 90% and above, not below', () => {
    expect(LIMITS.cpuPct).toBe(SERVER_LIMITS.cpuPct)                      // the probe and the page text use the same number
    expect(cpuVerdict(89.9).ok).toBe(true)
    expect(cpuVerdict(90).ok).toBe(false)
  })
})

describe('memory', () => {
  it('fails at 92% in use and above', () => {
    expect(LIMITS.memoryPct).toBe(SERVER_LIMITS.memoryPct)
    const ok = memoryVerdict(16 * GB, 8 * GB)
    expect(ok).toMatchObject({ ok: true, pct: 50 })
    expect(memoryVerdict(16 * GB, 1 * GB)).toMatchObject({ ok: false, pct: 93.8 })
    expect(memoryVerdict(0, 0).pct).toBe(0)
  })
})

describe('disk space', () => {
  it('is low when under 10% OR under 5 GB free, and names the drive', () => {
    expect(LIMITS.diskFreePct).toBe(SERVER_LIMITS.diskFreePct)
    expect(LIMITS.diskFreeGb).toBe(SERVER_LIMITS.diskFreeGb)
    const good = diskVerdict([{ name: 'C:', totalBytes: 100 * GB, freeBytes: 40 * GB }, { name: 'D:', totalBytes: 500 * GB, freeBytes: 120 * GB }])
    expect(good).toMatchObject({ ok: true })
    const lowPct = diskVerdict([{ name: 'D:', totalBytes: 500 * GB, freeBytes: 30 * GB }])   // 6%
    expect(lowPct).toMatchObject({ ok: false, detail: expect.stringContaining('D: 6% free') })
    const lowGb = diskVerdict([{ name: 'C:', totalBytes: 20 * GB, freeBytes: 4 * GB }])      // 20% but only 4 GB
    expect(lowGb).toMatchObject({ ok: false, detail: expect.stringContaining('C:') })
  })
  it('does not apply when no drive could be read', () => {
    expect(diskVerdict([])).toBeNull()
  })
})

describe('Windows services', () => {
  it('reads the state from an sc query answer', () => {
    const running = 'SERVICE_NAME: CkDeskApp\r\n        TYPE               : 10  WIN32_OWN_PROCESS\r\n        STATE              : 4  RUNNING\r\n'
    const stopped = 'SERVICE_NAME: CkDeskApp\r\n        STATE              : 1  STOPPED\r\n'
    expect(parseServiceState(running)).toBe('RUNNING')
    expect(parseServiceState(stopped)).toBe('STOPPED')
    expect(parseServiceState('[SC] EnumQueryServicesStatus:OpenService FAILED 1060:\r\nThe specified service does not exist as an installed service.')).toBeNull()
  })
  it('all running = good; one stopped = fails and names it; none installed = not applicable (a developer PC)', () => {
    expect(DEFAULT_SERVICES).toHaveLength(5)
    const all = Object.fromEntries(DEFAULT_SERVICES.map((n: string) => [n, 'RUNNING']))
    expect(servicesVerdict(all)).toMatchObject({ ok: true })
    expect(servicesVerdict({ ...all, CkDeskAuth: 'STOPPED' })).toMatchObject({ ok: false, detail: expect.stringContaining('CkDeskAuth (stopped)') })
    expect(servicesVerdict({ ...all, CkDeskProxy: null })).toMatchObject({ ok: false, detail: expect.stringContaining('CkDeskProxy (missing)') })
    expect(servicesVerdict(Object.fromEntries(DEFAULT_SERVICES.map((n: string) => [n, null])))).toBeNull()
  })
})

describe('database server load', () => {
  const base = { connections: 20, maxConnections: 100, longestQuerySeconds: 3, waitingLocks: 0 }
  it('good when connections are well under the limit and nothing runs long', () => {
    expect(dbLoadVerdict(base)).toMatchObject({ ok: true })
  })
  it('fails on 80% of the connections, on a query over 5 minutes, or on many waiting locks, and says which', () => {
    expect(dbLoadVerdict({ ...base, connections: 79 }).ok).toBe(true)
    expect(dbLoadVerdict({ ...base, connections: 80 })).toMatchObject({ ok: false, detail: expect.stringContaining('80 of 100 connections') })
    expect(dbLoadVerdict({ ...base, longestQuerySeconds: 300 })).toMatchObject({ ok: false, detail: expect.stringContaining('5 min') })
    expect(dbLoadVerdict({ ...base, waitingLocks: 12 })).toMatchObject({ ok: false, detail: expect.stringContaining('12 requests are waiting on locks') })
  })
})

describe('the catalog of server checks', () => {
  it('has the new checks, with the right owner (probe or app) and group', () => {
    const by = (k: string) => CHECKS.find((c) => c.key === k)
    expect(by('services')).toMatchObject({ by: 'probe', group: 'core' })          // a stopped service is a core problem
    for (const k of ['server_cpu', 'server_memory', 'server_disk']) expect(by(k)).toMatchObject({ by: 'probe', group: 'server' })
    expect(by('db_load')).toMatchObject({ by: 'app', group: 'server' })
  })
  it('keeps every chart metric once, with a worst end', () => {
    expect(new Set(METRICS.map((m) => m.key)).size).toBe(METRICS.length)
    for (const m of METRICS) expect(['max', 'min']).toContain(m.worst)
  })
})
