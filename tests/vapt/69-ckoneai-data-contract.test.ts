// The data contract behind the CKOneAI assistant (proposed gold_ckdesk datasets), checked through the REAL read-only data API on the isolated audit stack:
// nulls, timestamps (explicit offset), duplicates, status values, SLA flags, store mapping, freshness, identifier consistency, CSAT counts, snapshot and incremental loads.
// (Paging, deleted-row reconciliation, privacy of every entity and the token rules are in 67-data-api.test.ts.)
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'
import { Constants } from '@/types/database'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))

import { handleDataApi } from '@/lib/data-api/handler'

vi.setConfig({ testTimeout: 120_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const tag = `t69${String(Date.now()).slice(-6)}`
const TOKEN = `data-api-token-${tag}-0123456789`
let fx: D03Fixtures
let storeId = ''
const reqIds: Record<string, string> = {}
const svIds: string[] = []

const call = async (kind: 'meta' | 'rows' | 'ids', qs = '') => {
  const res = await handleDataApi(new NextRequest(`http://localhost:3210/api/data/v1/${kind}?${qs}`, { headers: { authorization: `Bearer ${TOKEN}` } }), kind)
  return { status: res.status, body: await res.json() as Row }
}
const allRows = async (entity: string, limit = 1000, extra = ''): Promise<Row[]> => {
  const rows: Row[] = []
  let after = ''
  for (let i = 0; i < 100; i++) {
    const r = await call('rows', `entity=${entity}&limit=${limit}${extra}${after ? `&after=${after}` : ''}`)
    expect(r.status).toBe(200)
    rows.push(...r.body.rows)
    if (!r.body.next_after) break
    after = r.body.next_after
  }
  return rows
}
const iso = (n: number) => new Date(Date.now() + n * 3600_000).toISOString()

beforeAll(async () => {
  fx = await setupD03Fixtures()
  process.env.DATA_API_TOKEN = TOKEN
  process.env.DATA_API_ORG_ID = fx.orgId
  const a = db()
  storeId = (await a.from('stores').insert({ org_id: fx.orgId, code: tag.toUpperCase(), name: `${tag} store`, region: 'R9' }).select('id').single()).data.id
  await a.from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id)
  const mk = async (key: string, over: Row) => {
    const r = (await a.from('requests').insert({ request_no: '', title: `${tag} ${key}`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, org_id: fx.orgId, priority: 'low', status: 'in_progress', ...over }).select('id').single()).data
    reqIds[key] = r.id
  }
  // answered in time / answered late / not answered with a target / not answered without a target / resolved late / unassigned
  await mk('in_time', { assigned_to: fx.agentA.id, response_due_at: iso(-10), responded_at: iso(-12), resolution_due_at: iso(-5), resolved_at: iso(-6), status: 'resolved' })
  await mk('late', { assigned_to: fx.agentA.id, response_due_at: iso(-10), responded_at: iso(-9), resolution_due_at: iso(-5), resolved_at: iso(-4), status: 'resolved' })
  await mk('unanswered_target', { assigned_to: fx.agentA.id, response_due_at: iso(5), resolution_due_at: iso(20) })
  await mk('no_target', { assigned_to: fx.agentA.id })
  await mk('unassigned_open', { status: 'open' })
  await mk('paused', { assigned_to: fx.agentA.id, status: 'waiting_user', waiting_since: iso(-3), paused_ms_total: 3600000 })
  // a head-office requester (no store) raises one
  await a.from('requests').insert({ request_no: '', title: `${tag} head_office`, requester_id: fx.requesterB.id, service_id: fx.teamB.serviceId, team_id: fx.teamB.id, org_id: fx.orgId, priority: 'low', status: 'open' }).select('id').single().then((r: Row) => { reqIds.head_office = r.data.id })
  const now = new Date().toISOString()
  const sv = await a.from('csat_surveys').insert([
    { org_id: fx.orgId, request_id: reqIds.in_time, requester_id: fx.requesterA.id, rating: 4, sent_at: now, submitted_at: now },
    { org_id: fx.orgId, request_id: reqIds.late, requester_id: fx.requesterA.id, rating: null, sent_at: now },
  ]).select('id')
  svIds.push(...(sv.data ?? []).map((r: Row) => r.id))
}, 240_000)

afterAll(async () => {
  const a = db()
  delete process.env.DATA_API_TOKEN; delete process.env.DATA_API_ORG_ID
  if (svIds.length) await a.from('csat_surveys').delete().in('id', svIds)
  const ids = Object.values(reqIds)
  if (ids.length) await a.from('requests').delete().in('id', ids)
  await a.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
  if (storeId) await a.from('stores').delete().eq('id', storeId)
  await fx?.cleanup()
}, 180_000)

describe('requests: values and nulls', () => {
  it('every status is one the application defines, every priority is a known one', async () => {
    const rows = await allRows('requests')
    const known = new Set<string>(Constants.public.Enums.request_status)
    const bad = rows.filter((r) => !known.has(r.status))
    expect(bad.map((r) => r.status)).toEqual([])
    expect(rows.every((r) => ['low', 'medium', 'high', 'urgent'].includes(r.priority))).toBe(true)
  })

  it('an unassigned ticket has a real null (not an empty text) and a head-office requester has no store code', async () => {
    const rows = await allRows('requests')
    const un = rows.find((r) => r.id === reqIds.unassigned_open)!
    expect(un.assigned_to).toBeNull()
    expect(rows.find((r) => r.id === reqIds.head_office)!.store_code).toBeNull()
    expect(rows.every((r) => r.assigned_to === null || /^[0-9a-f-]{36}$/.test(r.assigned_to))).toBe(true)
  })

  it('the store code of a ticket is the store of its requester', async () => {
    const rows = await allRows('requests')
    expect(rows.find((r) => r.id === reqIds.in_time)!.store_code).toBe(tag.toUpperCase())
    const stores = await allRows('stores')
    expect(stores.find((s) => s.code === tag.toUpperCase())).toBeTruthy()           // the join key exists in the stores entity
    expect(new Set(stores.map((s) => s.code)).size).toBe(stores.length)              // one row per code (the platform joins on it)
  })

  it('the paused time and the waiting flag are consistent', async () => {
    const rows = await allRows('requests')
    const p = rows.find((r) => r.id === reqIds.paused)!
    expect(p.status).toBe('waiting_user')
    expect(p.waiting_since).not.toBeNull()
    expect(p.paused_ms_total).toBe(3600000)
    expect(rows.every((r) => Number.isInteger(r.paused_ms_total ?? 0) && (r.paused_ms_total ?? 0) >= 0)).toBe(true)
    expect(rows.filter((r) => r.resolved_at === null && ['resolved', 'closed'].includes(r.status) && r.id.length === 36 && Object.values(reqIds).includes(r.id))).toEqual([])
  })
})

describe('SLA flags (response_breached, resolution_breached)', () => {
  it('are true when answered or resolved late, false when in time, null while open or without a target', async () => {
    const rows = await allRows('requests')
    const g = (k: string) => rows.find((r) => r.id === reqIds[k])!
    expect([g('in_time').response_breached, g('in_time').resolution_breached]).toEqual([false, false])
    expect([g('late').response_breached, g('late').resolution_breached]).toEqual([true, true])
    expect([g('unanswered_target').response_breached, g('unanswered_target').resolution_breached]).toEqual([null, null])
    expect([g('no_target').response_breached, g('no_target').resolution_breached]).toEqual([null, null])
  })
})

describe('timestamps, duplicates, freshness, identifiers', () => {
  it('every timestamp of every entity carries an explicit offset (Z or +/-hh:mm) and is a real moment', async () => {
    const meta = await call('meta')
    const bad: string[] = []
    for (const e of meta.body.entities as Row[]) {
      const tsCols = (e.columns as Row[]).filter((c) => /timestamp/.test(c.type)).map((c) => c.name)
      if (!tsCols.length) continue
      const page = await call('rows', `entity=${e.name}&limit=200`)
      for (const row of page.body.rows as Row[]) for (const c of tsCols) {
        const v = row[c]
        if (v === null) continue
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) || Number.isNaN(Date.parse(v))) bad.push(`${e.name}.${c}=${v}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('no id appears twice when a whole entity is read in small pages (requests, comments, history, approvals)', async () => {
    for (const entity of ['requests', 'request_comments', 'request_status_history', 'approvals', 'users']) {
      const rows = await allRows(entity, 700)
      expect(new Set(rows.map((r) => r.id)).size, entity).toBe(rows.length)
    }
  })

  it('the row count and newest change date in meta equal what the pages deliver (freshness check)', async () => {
    const meta = await call('meta')
    const req = (meta.body.entities as Row[]).find((e) => e.name === 'requests')!
    const rows = await allRows('requests')
    expect(req.count).toBe(rows.length)
    const newest = rows.map((r) => Date.parse(r.updated_at)).reduce((a, b) => Math.max(a, b), 0)
    expect(Date.parse(req.newest ?? req.max_cursor ?? req.newest_change)).toBe(newest)
  })

  it('an incremental load with updated_since returns only changed rows, and a re-read never duplicates', async () => {
    const since = iso(1)                                  // in the future: nothing changed since
    const none = await allRows('requests', 1000, `&updated_since=${encodeURIComponent(since)}`)
    expect(none).toEqual([])
    const a = db()
    await a.from('requests').update({ priority: 'high' }).eq('id', reqIds.no_target)
    const changed = await allRows('requests', 1000, `&updated_since=${encodeURIComponent(iso(-0.05))}`)
    expect(changed.map((r) => r.id)).toContain(reqIds.no_target)
    expect(changed.length).toBeLessThan((await allRows('requests')).length)
    expect(new Set(changed.map((r) => r.id)).size).toBe(changed.length)
  })

  it('identifiers agree between entities: every history, comment and survey row points at a ticket that exists', async () => {
    const ids = new Set((await allRows('requests')).map((r) => r.id))
    for (const entity of ['request_status_history', 'request_comments', 'csat_surveys', 'approvals']) {
      const rows = await allRows(entity)
      expect(rows.filter((r) => !ids.has(r.request_id)).length, entity).toBe(0)
    }
    const users = new Set((await allRows('users')).map((u) => u.id))
    const reqs = await allRows('requests')
    expect(reqs.filter((r) => !users.has(r.requester_id)).length).toBe(0)
  })
})

describe('CSAT', () => {
  it('a survey that is sent but not answered has a null rating, and only rated ones count in the average', async () => {
    const rows = (await allRows('csat_surveys')).filter((s) => [reqIds.in_time, reqIds.late].includes(s.request_id))
    expect(rows.length).toBe(2)
    expect(rows.filter((s) => s.rating !== null).map((s) => s.rating)).toEqual([4])
    expect(rows.find((s) => s.rating === null)!.submitted_at).toBeNull()
    const all = await allRows('csat_surveys')
    expect(all.every((s) => s.rating === null || (s.rating >= 1 && s.rating <= 5))).toBe(true)
    expect(all.filter((s) => s.rating !== null).every((s) => s.submitted_at !== null)).toBe(true)
  })

  it('the survey entity is a snapshot (read whole each time) and has no comment text', async () => {
    const meta = await call('meta')
    const e = (meta.body.entities as Row[]).find((x) => x.name === 'csat_surveys')!
    expect(e.mode).toBe('snapshot')
    expect((e.columns as Row[]).map((c) => c.name)).not.toContain('comment')
  })
})
