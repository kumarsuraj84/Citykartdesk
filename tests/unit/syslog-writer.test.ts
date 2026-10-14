import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SystemLogWriter, type Spool } from '@/lib/syslog/writer'
import { toRow, type SystemLogRow } from '@/lib/syslog/row'
import { fileSpool } from '@/lib/syslog/spool'

const row = (action: string, extra: Partial<Parameters<typeof toRow>[0]> = {}): SystemLogRow => toRow({ category: 'error', source: 'app_server', action, message: action, ...extra })
const memorySpool = (): Spool & { rows: SystemLogRow[] } => {
  const s = { rows: [] as SystemLogRow[], append(r: SystemLogRow[]) { s.rows.push(...r) }, drain() { const r = s.rows; s.rows = []; return r }, size: () => s.rows.length }
  return s
}

describe('toRow', () => {
  it('redacts errors and events fully, but keeps audit evidence readable (only secret keys are blanked)', () => {
    const err = toRow({ category: 'error', source: 'database', action: 'x', message: 'mail to a@b.com failed, token=abc123', detail: { password: 'p', note: 'call 9876543210' } })
    expect(err.message).toBe('mail to [email] failed, token=[redacted]')
    expect(err.detail).toEqual({ password: '[redacted]', note: 'call [phone]' })
    const audit = toRow({ category: 'audit', source: 'server_action', action: 'user.email_changed', before: { email: 'old@x.com', password: 'p' }, after: { email: 'new@x.com' } })
    expect(audit.before_data).toEqual({ email: 'old@x.com', password: '[redacted]' })
    expect(audit.after_data).toEqual({ email: 'new@x.com' })
  })
  it('gives errors a fingerprint and audit rows none; defaults severity and outcome from the category; drops bad ids; trims the path query', () => {
    const e = toRow({ category: 'error', source: 'api_route', action: 'a', message: 'boom 12', path: '/x?token=secret', actorId: 'not-a-uuid', orgId: 'nope' })
    expect(e.fingerprint).toMatch(/^[0-9a-f]{14}$/)
    expect(e.severity).toBe('error'); expect(e.outcome).toBe('failure')
    expect(e.path).toBe('/x'); expect(e.actor_id).toBeNull(); expect(e.org_id).toBeNull()
    const a = toRow({ category: 'audit', source: 'admin', action: 'a', actorId: '49762e2f-9499-414b-b2c3-707c023683fa' })
    expect(a.fingerprint).toBeNull(); expect(a.severity).toBe('info'); expect(a.outcome).toBe('success')
    expect(a.actor_id).toBe('49762e2f-9499-414b-b2c3-707c023683fa')
  })
  it('bounds huge values', () => {
    const r = toRow({ category: 'error', source: 'app_server', action: 'a', message: 'something failed '.repeat(1000), stack: 'at frame (file.js:1:1) '.repeat(5000), detail: { a: 'some long note '.repeat(5000) } })
    expect(r.message!.length).toBe(2000); expect(r.stack!.length).toBe(8000)
    expect(JSON.stringify(r.detail).length).toBeLessThan(7000)
  })
})

describe('SystemLogWriter', () => {
  it('sends queued rows in batches', async () => {
    const sent: number[] = []
    const w = new SystemLogWriter({ insert: async (rows) => { sent.push(rows.length) } }, { batchSize: 3 })
    for (let i = 0; i < 7; i++) w.enqueue(row(`e${i}`))
    await w.flush()
    expect(sent).toEqual([3, 3, 1]); expect(w.stats.written).toBe(7); expect(w.pending).toBe(0)
  })

  it('drops repeats of the same failure beyond the limit, counts them, and says how many once the window passes', async () => {
    let t = 1_000_000
    const sent: SystemLogRow[] = []
    const w = new SystemLogWriter({ insert: async (rows) => { sent.push(...rows) }, now: () => t }, { floodLimit: 3, floodWindowMs: 60_000 })
    for (let i = 0; i < 10; i++) w.enqueue(row('db.timeout'), 'k1')
    w.enqueue(row('other'), 'k2')
    expect(w.stats.suppressed).toBe(7)
    t += 61_000
    w.enqueue(row('db.timeout'), 'k1')                      // a new window: allowed, and the earlier suppression is reported
    await w.flush()
    expect(sent.filter((r) => r.action === 'db.timeout')).toHaveLength(4)
    const summary = sent.find((r) => r.action === 'system_log.flood_suppressed')!
    expect(summary.detail).toEqual({ key: 'k1', suppressed: 7 })
    expect(sent.some((r) => r.action === 'other')).toBe(true)
  })

  it('audit-style rows without a flood key are never dropped', async () => {
    const sent: SystemLogRow[] = []
    const w = new SystemLogWriter({ insert: async (rows) => { sent.push(...rows) } }, { floodLimit: 1 })
    for (let i = 0; i < 20; i++) w.enqueue(row('audit.thing', { category: 'audit' }))
    await w.flush()
    expect(sent).toHaveLength(20)
  })

  it('when the database is down the rows go to the spool, the database is not hammered, and they are sent when it is back', async () => {
    let t = 0, up = false, calls = 0
    const spool = memorySpool()
    const w = new SystemLogWriter({ insert: async () => { calls++; if (!up) throw new Error('ECONNREFUSED') }, spool, now: () => t }, { backoffMs: 15_000, batchSize: 2 })
    for (let i = 0; i < 6; i++) w.enqueue(row(`d${i}`))
    await w.flush()
    expect(calls).toBe(1)                                    // one failed attempt, the rest went straight to the spool
    expect(spool.rows).toHaveLength(6); expect(w.stats.spooled).toBe(6)
    expect(await w.retrySpool()).toBe(0)                     // still inside the back-off
    t += 16_000; up = true
    expect(await w.retrySpool()).toBe(6)
    expect(spool.rows).toHaveLength(0)
    expect(w.stats.written).toBe(6)
  })

  it('a retry that fails again keeps the unsent rows', async () => {
    let t = 0, n = 0
    const spool = memorySpool(); spool.append([row('a'), row('b'), row('c'), row('d')])
    const w = new SystemLogWriter({ insert: async () => { if (++n > 1) throw new Error('down again') }, spool, now: () => t }, { batchSize: 2 })
    expect(await w.retrySpool()).toBe(2)
    expect(spool.rows.map((r) => r.action)).toEqual(['c', 'd'])
  })

  it('with no database and no spool the rows are reported as dropped, never thrown', async () => {
    const dropped: string[] = []
    const w = new SystemLogWriter({ insert: async () => { throw new Error('down') }, onDrop: (_r, why) => dropped.push(why) })
    w.enqueue(row('lost'))
    await expect(w.flush()).resolves.toBeUndefined()
    expect(w.stats.dropped).toBe(1); expect(dropped).toEqual(['down'])
  })

  it('a full buffer drops the newest row instead of growing without limit', () => {
    const w = new SystemLogWriter({ insert: async () => {} }, { maxBuffer: 2 })
    for (let i = 0; i < 5; i++) w.enqueue(row(`b${i}`))
    expect(w.pending).toBe(2); expect(w.stats.dropped).toBe(3)
  })
})

describe('fileSpool', () => {
  it('appends, reports its size, drains everything once, and ignores a damaged line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syslog-spool-'))
    const file = path.join(dir, 'spool.jsonl')
    const s = fileSpool(file)
    try {
      expect(s.size()).toBe(0); expect(s.drain()).toEqual([])
      s.append([row('one'), row('two')])
      s.append([row('three')])
      fs.appendFileSync(file, '{this is not json\n')
      expect(s.size()).toBeGreaterThan(0)
      expect(s.drain().map((r) => r.action)).toEqual(['one', 'two', 'three'])
      expect(s.size()).toBe(0); expect(s.drain()).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
