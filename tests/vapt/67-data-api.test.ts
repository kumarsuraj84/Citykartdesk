// The read-only data API for the data platform (DBA), on the isolated audit stack: the token, the pages (no row skipped or repeated), the changes since a date, the list of ids
// (a deleted ticket drops out of it), the store code of a ticket, and that no typed text or contact detail ever leaves.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))

import { handleDataApi } from '@/lib/data-api/handler'

vi.setConfig({ testTimeout: 120_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t67${String(Date.now()).slice(-6)}`
const TOKEN = `data-api-token-${tag}-0123456789`
let fx: D03Fixtures
let storeId = ''
const reqIds: string[] = []

const call = async (kind: 'meta' | 'rows' | 'ids', qs = '', token: string | null = TOKEN) => {
  const res = await handleDataApi(new NextRequest(`http://localhost:3210/api/data/v1/${kind}?${qs}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), kind)
  return { status: res.status, body: await res.json() as Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
}
const adminIds = async (): Promise<string[]> => { const out: string[] = []; for (let from = 0; ; from += 1000) { const { data } = await db().from('requests').select('id').eq('org_id', fx.orgId).order('id').range(from, from + 999); out.push(...(data ?? []).map((r: { id: string }) => r.id)); if ((data ?? []).length < 1000) break } return out }
const allRows = async (entity: string, limit: number, extra = '') => {
  const rows: Record<string, unknown>[] = []
  let after = ''
  for (let i = 0; i < 50; i++) {
    const r = await call('rows', `entity=${entity}&limit=${limit}${extra}${after ? `&after=${after}` : ''}`)
    expect(r.status).toBe(200)
    rows.push(...r.body.rows)
    if (!r.body.next_after) break
    after = r.body.next_after
  }
  return rows
}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  process.env.DATA_API_TOKEN = TOKEN
  process.env.DATA_API_ORG_ID = fx.orgId
  const a = db()
  storeId = (await a.from('stores').insert({ org_id: fx.orgId, code: `${tag}`.toUpperCase(), name: `${tag} store`, address: 'Main Road', region: 'R9' }).select('id').single()).data.id
  await a.from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id)
  for (let i = 0; i < 5; i++) {
    const r = (await a.from('requests').insert({
      request_no: '', title: `${tag} secret title ${i}`, description: 'secret description', requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, org_id: fx.orgId,
      priority: 'low', status: 'in_progress', assigned_to: fx.agentA.id,
    }).select('id').single()).data
    reqIds.push(r.id)
  }
  await a.from('request_activity').insert({ request_id: reqIds[0], actor_id: fx.agentA.id, action: 'status_changed', metadata: { from: 'open', to: 'in_progress', note: 'secret note' } })
  await a.from('request_activity').insert({ request_id: reqIds[0], actor_id: fx.agentA.id, action: 'comment_added', metadata: { text: 'not a status change' } })
  await a.from('request_comments').insert({ request_id: reqIds[0], author_id: fx.requesterA.id, body: 'secret comment words', is_internal: false })
}, 240_000)

afterAll(async () => {
  const a = db()
  delete process.env.DATA_API_TOKEN; delete process.env.DATA_API_ORG_ID
  if (reqIds.length) {
    await a.from('request_comments').delete().in('request_id', reqIds); await a.from('request_activity').delete().in('request_id', reqIds)
    await a.from('requests').delete().in('id', reqIds)
  }
  await a.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
  if (storeId) await a.from('stores').delete().eq('id', storeId)
  await fx?.cleanup()
}, 180_000)

describe('the token', () => {
  it('refuses a missing or wrong token and serves nothing', async () => {
    expect((await call('rows', 'entity=requests', null)).status).toBe(401)
    expect((await call('rows', 'entity=requests', 'wrong-token-wrong-token-0123')).status).toBe(401)
    expect((await call('meta', '', null)).status).toBe(401)
  })
  it('is off (503) while no token is configured', async () => {
    const keep = process.env.DATA_API_TOKEN
    delete process.env.DATA_API_TOKEN
    const r = await call('rows', 'entity=requests')
    process.env.DATA_API_TOKEN = keep
    expect(r.status).toBe(503)
  })
  it('refuses an unknown entity and bad parameters with a clear sentence', async () => {
    expect((await call('rows', 'entity=profiles_raw')).status).toBe(404)
    expect((await call('rows', 'entity=requests&limit=99999')).status).toBe(400)
    expect((await call('rows', 'entity=requests&after=junk')).status).toBe(400)
  })
})

describe('the pages', () => {
  it('give every ticket of the organisation exactly once, whatever the page size', async () => {
    const expected = (await adminIds()).sort()
    for (const size of [1000, 1700, 5000]) {
      const rows = await allRows('requests', size)
      const got = rows.map((r) => String(r.id))
      expect(new Set(got).size, `size ${size}: no repeats`).toBe(got.length)
      expect([...got].sort(), `size ${size}`).toEqual(expected)
    }
  })
  it('a ticket carries its store code and no title, description or typed text', async () => {
    const rows = await allRows('requests', 5000)
    const mine = rows.find((r) => r.id === reqIds[0])!
    expect(mine.store_code).toBe(tag.toUpperCase())
    expect(mine.requester_id).toBe(fx.requesterA.id)
    expect(Object.keys(mine)).not.toEqual(expect.arrayContaining(['title']))
    expect(JSON.stringify(rows)).not.toMatch(/secret title|secret description/)
  })
  it('only the changes since a date, and a changed ticket comes back', async () => {
    const before = new Date(Date.now() - 1000).toISOString()
    await db().from('requests').update({ priority: 'high' }).eq('id', reqIds[1])
    const rows = await allRows('requests', 100, `&updated_since=${encodeURIComponent(before)}`)
    expect(rows.map((r) => r.id)).toContain(reqIds[1])
    expect(rows.find((r) => r.id === reqIds[1])!.priority).toBe('high')
    const none = await allRows('requests', 100, `&updated_since=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}`)
    expect(none).toEqual([])
  })
  it('status changes give from -> to only, and other activity is left out', async () => {
    const rows = await allRows('request_status_history', 100)
    const mine = rows.filter((r) => r.request_id === reqIds[0])
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ from_status: 'open', to_status: 'in_progress' })
    expect(JSON.stringify(rows)).not.toMatch(/secret note|not a status change/)
  })
  it('a comment shows flags and a length, never the words', async () => {
    const rows = await allRows('request_comments', 100)
    const mine = rows.find((r) => r.request_id === reqIds[0])!
    expect(mine).toMatchObject({ is_internal: false, text_length: 'secret comment words'.length, from_external: false })
    expect(JSON.stringify(rows)).not.toMatch(/secret comment words/)
  })
  it('the store master carries the code, and a person is an id with a store code only', async () => {
    const stores = await allRows('stores', 100)
    expect(stores.find((s) => s.code === tag.toUpperCase())).toMatchObject({ region: 'R9' })
    const users = await allRows('users', 100)
    const me = users.find((u) => u.id === fx.requesterA.id)!
    expect(me.store_code).toBe(tag.toUpperCase())
    const realName = (await db().from('profiles').select('full_name').eq('id', fx.requesterA.id).single()).data.full_name
    expect(me.full_name).toBe(realName)
    expect(Object.keys(me)).not.toEqual(expect.arrayContaining(['email', 'mobile', 'phone', 'employee_id']))
    expect(JSON.stringify(users)).not.toMatch(/@/)
  })
})

describe('every entity can be read from the real database', () => {
  it('answers a page and an ids page for each entity, with exactly the described columns', async () => {
    const { ENTITIES } = await import('@/lib/data-api/entities')
    for (const e of ENTITIES) {
      const r = await call('rows', `entity=${e.name}&limit=5`)
      expect(r.status, `${e.name} rows: ${JSON.stringify(r.body)}`).toBe(200)
      for (const row of r.body.rows as Record<string, unknown>[]) expect(Object.keys(row).sort(), e.name).toEqual(e.columns.map((c) => c.name).sort())
      const ids = await call('ids', `entity=${e.name}&limit=5`)
      expect(ids.status, `${e.name} ids: ${JSON.stringify(ids.body)}`).toBe(200)
    }
  })
})

describe('the ids and the counts', () => {
  it('lists every id, and a deleted ticket drops out of the ids and the rows', async () => {
    const ids = async () => { const out: string[] = []; let after = ''; for (let i = 0; i < 60; i++) { const r = await call('ids', `entity=requests&limit=1000${after ? `&after=${after}` : ''}`); out.push(...r.body.rows.map((x: { id: string }) => x.id)); if (!r.body.next_after) break; after = r.body.next_after } return out }
    expect(await ids()).toContain(reqIds[4])
    await db().from('requests').delete().eq('id', reqIds[4])
    expect(await ids()).not.toContain(reqIds[4])
    expect((await allRows('requests', 100)).map((r) => r.id)).not.toContain(reqIds[4])
    reqIds.pop()
  })
  it('the meta lists each entity with its columns, a count and the newest change', async () => {
    const m = await call('meta')
    expect(m.status).toBe(200)
    const names = m.body.entities.map((e: { name: string }) => e.name)
    expect(names).toEqual(expect.arrayContaining(['requests', 'request_status_history', 'request_comments', 'stores', 'users', 'csat_surveys', 'approvals', 'approval_decisions']))
    const requests = m.body.entities.find((e: { name: string }) => e.name === 'requests')
    expect(requests.count).toBe((await adminIds()).length)
    expect(requests.cursor).toBe('updated_at')
    expect(requests.max_cursor).toMatch(/Z$/)
    expect(requests.columns.some((c: { name: string; pii: string }) => c.name === 'requester_id' && c.pii === 'id')).toBe(true)
  })
})
