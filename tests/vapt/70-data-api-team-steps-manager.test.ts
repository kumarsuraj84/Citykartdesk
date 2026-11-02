// The three data API additions prepared for the CKOneAI assistant (LOCAL, not released): approval_workflow_steps, team_members (synthetic id team_id:user_id), users.manager_id.
// Isolated audit stack only.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))

import { handleDataApi } from '@/lib/data-api/handler'

vi.setConfig({ testTimeout: 120_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const tag = `t70${String(Date.now()).slice(-6)}`
const TOKEN = `data-api-token-${tag}-0123456789`
let fx: D03Fixtures
let wfId = ''

const call = async (kind: 'meta' | 'rows' | 'ids', qs = '') => {
  const res = await handleDataApi(new NextRequest(`http://localhost:3210/api/data/v1/${kind}?${qs}`, { headers: { authorization: `Bearer ${TOKEN}` } }), kind)
  return { status: res.status, body: await res.json() as Row }
}
const walk = async (kind: 'rows' | 'ids', entity: string, limit: number): Promise<Row[]> => {
  const out: Row[] = []
  let after = ''
  for (let i = 0; i < 200; i++) {
    const r = await call(kind, `entity=${entity}&limit=${limit}${after ? `&after=${after}` : ''}`)
    expect(r.status).toBe(200)
    out.push(...r.body.rows)
    if (!r.body.next_after) break
    after = r.body.next_after
  }
  return out
}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  process.env.DATA_API_TOKEN = TOKEN
  process.env.DATA_API_ORG_ID = fx.orgId
  const a = db()
  wfId = (await a.from('approval_workflows').insert({ org_id: fx.orgId, name: `${tag} flow` }).select('id').single()).data.id
  await a.from('approval_workflow_steps').insert([
    { workflow_id: wfId, step_order: 1, approver_type: 'specific_user', approver_user_id: fx.agentB.id },
    { workflow_id: wfId, step_order: 2, approver_type: 'any_manager', approver_user_id: null },
  ])
  await a.from('profiles').update({ manager_id: fx.manager.id }).eq('id', fx.requesterA.id)
}, 240_000)

afterAll(async () => {
  const a = db()
  delete process.env.DATA_API_TOKEN; delete process.env.DATA_API_ORG_ID
  await a.from('profiles').update({ manager_id: null }).eq('id', fx.requesterA.id)
  if (wfId) { await a.from('approval_workflow_steps').delete().eq('workflow_id', wfId); await a.from('approval_workflows').delete().eq('id', wfId) }
  await fx?.cleanup()
}, 180_000)

describe('meta', () => {
  it('lists the two new entities as snapshots, with ids only and no names', async () => {
    const m = (await call('meta')).body.entities as Row[]
    expect(m.length).toBe(19)
    for (const name of ['approval_workflow_steps', 'team_members']) {
      const e = m.find((x) => x.name === name)!
      expect(e.mode).toBe('snapshot')
      expect(e.cursor).toBeNull()
      expect((e.columns as Row[]).every((c) => c.pii !== 'name')).toBe(true)
      expect((e.columns as Row[]).map((c) => c.name)).not.toContain('email')
    }
    const tm = m.find((x) => x.name === 'team_members')!
    expect((tm.columns as Row[]).find((c) => c.name === 'id')!.type).toBe('text')
  })
})

describe('team_members (composite key, synthetic id)', () => {
  it('every row has the id team_id:user_id and the count matches', async () => {
    const rows = await walk('rows', 'team_members', 1000)
    expect(rows.length).toBeGreaterThanOrEqual(3)           // the fixtures add agent A, agent B and the manager
    for (const r of rows) expect(r.id).toBe(`${r.team_id}:${r.user_id}`)
    const meta = (await call('meta')).body.entities.find((e: Row) => e.name === 'team_members')
    expect(meta.count).toBe(rows.length)
    expect(rows.some((r) => r.team_id === fx.teamA.id && r.user_id === fx.agentA.id)).toBe(true)
  })

  it('paging one row at a time gives every row exactly once, in a stable order', async () => {
    const all = await walk('rows', 'team_members', 1000)
    for (const size of [1, 2, 3]) {
      const paged = await walk('rows', 'team_members', size)
      expect(paged.map((r) => r.id)).toEqual(all.map((r) => r.id))
    }
    expect(all.map((r) => r.id)).toEqual([...all.map((r) => r.id)].sort())   // ordered by team_id then user_id
  })

  it('the ids list matches the rows, and a removed membership drops out', async () => {
    const a = db()
    const before = (await walk('ids', 'team_members', 2)).map((r) => r.id)
    expect(before).toEqual((await walk('rows', 'team_members', 1000)).map((r) => r.id))
    await a.from('team_members').delete().eq('team_id', fx.teamA.id).eq('user_id', fx.manager.id)
    const after = (await walk('ids', 'team_members', 2)).map((r) => r.id)
    expect(after).not.toContain(`${fx.teamA.id}:${fx.manager.id}`)
    expect(after.length).toBe(before.length - 1)
    await a.from('team_members').insert({ team_id: fx.teamA.id, user_id: fx.manager.id, org_id: fx.orgId })
  })

  it('a cursor that is not a team_members cursor is refused with 400', async () => {
    const other = (await call('rows', 'entity=requests&limit=1')).body.next_after ?? Buffer.from(JSON.stringify({ t: null, i: 'abc' })).toString('base64url')
    expect((await call('rows', `entity=team_members&after=${other}`)).status).toBe(400)
    const bad = Buffer.from(JSON.stringify({ t: null, i: `${fx.teamA.id}:x"),id.gt.(` })).toString('base64url')
    expect((await call('rows', `entity=team_members&after=${bad}`)).status).toBe(400)
    expect((await call('ids', `entity=team_members&after=${bad}`)).status).toBe(400)
  })
})

describe('approval_workflow_steps', () => {
  it('lists the steps of the workflow with the approver id, null for an any_manager step', async () => {
    const rows = (await walk('rows', 'approval_workflow_steps', 1000)).filter((r) => r.workflow_id === wfId)
    expect(rows.length).toBe(2)
    expect(rows.find((r) => r.step_order === 1)).toMatchObject({ approver_type: 'specific_user', approver_user_id: fx.agentB.id })
    expect(rows.find((r) => r.step_order === 2)).toMatchObject({ approver_type: 'any_manager', approver_user_id: null })
    expect(Object.keys(rows[0]).sort()).toEqual(['approver_type', 'approver_user_id', 'id', 'step_order', 'workflow_id'])
  })

  it('pages without skipping and the ids list drops a deleted step', async () => {
    const all = await walk('rows', 'approval_workflow_steps', 1000)
    expect((await walk('rows', 'approval_workflow_steps', 1)).map((r) => r.id)).toEqual(all.map((r) => r.id))
    const ids = (await walk('ids', 'approval_workflow_steps', 2)).map((r) => r.id)
    expect(ids).toEqual(all.map((r) => r.id))
  })
})

describe('users.manager_id', () => {
  it('carries the id of the direct manager, null for everybody else, as the last column', async () => {
    const rows = await walk('rows', 'users', 1000)
    const r = rows.find((u) => u.id === fx.requesterA.id)!
    expect(r.manager_id).toBe(fx.manager.id)
    expect(rows.find((u) => u.id === fx.requesterB.id)!.manager_id).toBeNull()
    expect(Object.keys(r).at(-1)).toBe('manager_id')
    expect(r).not.toHaveProperty('email')
  })

  it('a change of manager moves the person into the next incremental read', async () => {
    const a = db()
    const since = new Date(Date.now() - 1000).toISOString()
    await a.from('profiles').update({ manager_id: fx.admin.id }).eq('id', fx.requesterA.id)
    const changed = (await call('rows', `entity=users&limit=1000&updated_since=${encodeURIComponent(since)}`)).body.rows as Row[]
    expect(changed.find((u) => u.id === fx.requesterA.id)?.manager_id).toBe(fx.admin.id)
  })
})
