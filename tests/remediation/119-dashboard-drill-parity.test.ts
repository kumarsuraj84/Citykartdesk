// The normal Dashboards page now opens the Smart Dashboard's pop-up when a number is clicked. A list that does not match the number it was opened
// from would be worse than the old plain list, so this checks, for every kind of clickable number, that the pop-up's tickets are EXACTLY the
// tickets the old side list's own definition selects (the same ids, not just the same count), on the audit database's synthetic tickets, as a
// signed-in administrator and through the real server actions. Also checks the old drawer's rows (the real action) are all inside the pop-up's set.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, type D03Fixtures } from '../setup/fixtures-d03'
import { svc } from './helpers'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { loadDrillData } from '@/lib/actions/analytics-drill'
import { getFilteredRequests, type DrawerFilter } from '@/lib/actions/analytics'
import { drawerToDrill, type BridgeEnv } from '@/lib/analytics/drill-bridge'
import { drillCohort, type ExecTicket } from '@/lib/reporting/executive/engine'
import { OPEN_REQUEST_STATUSES } from '@/lib/constants/requests'
import { emptyStoreFilter } from '@/lib/analytics/store-filter'

vi.setConfig({ testTimeout: 180_000 })

const DAY = 86_400_000
let fx: D03Fixtures
let orgId = ''
let tickets: ExecTicket[] = []
let dataNow = 0
let env: Omit<BridgeEnv, 'now'>
const teams = new Map<string, string>()
const people = new Map<string, string>()

/** every row id a REST query returns (the database answers 1000 at a time) */
async function ids(filter: string): Promise<Set<string>> {
  const out = new Set<string>()
  for (let offset = 0; ; offset += 1000) {
    const r = await svc<{ id: string }[]>('GET', `/requests?select=id&org_id=eq.${orgId}${filter}&order=id.asc&limit=1000&offset=${offset}`)
    if (!Array.isArray(r.json)) throw new Error(`query failed: ${r.text.slice(0, 200)}`)
    r.json.forEach((x) => out.add(x.id))
    if (r.json.length < 1000) return out
  }
}

/** what the OLD side list selects, written out from its own definition (lib/actions/analytics.ts getFilteredRequests) */
function oldDefinition(f: DrawerFilter, win: { start: number; end: number } | null, nowIso: string): string {
  const a = win ? new Date(win.start).toISOString() : ''
  const b = win ? new Date(win.end).toISOString() : ''
  let q = ''
  if (f.status?.length) q += `&status=in.(${f.status.join(',')})`
  if (f.priority) q += `&priority=eq.${f.priority}`
  if (f.teamId) q += `&team_id=eq.${f.teamId}`
  if (f.assignedTo) q += `&assigned_to=eq.${f.assignedTo}`
  // (a ticket whose clock is stopped - waiting on the user, on purchase from HO, on an approval - is not breached and has no first response overdue while it waits, audit F-02)
  const paused = '&status=not.in.(waiting_user,hold_purchase_ho,pending_approval)'
  if (f.slaBreached) q += `&resolution_due_at=lt.${nowIso}&status=not.in.(resolved,closed,cancelled)${paused}`
  if (f.frtBreached) q += `&responded_at=is.null&status=not.in.(resolved,closed,cancelled)${paused}`
  if (f.createdInPeriod) q += `&created_at=gte.${a}&created_at=lte.${b}`
  if (f.closedInPeriod) q += `&closed_at=gte.${a}&closed_at=lte.${b}`
  if (f.resolvedInPeriod) q += `&or=(${encodeURIComponent(`and(resolved_at.gte.${a},resolved_at.lte.${b}),and(resolved_at.is.null,closed_at.gte.${a},closed_at.lte.${b}),and(resolved_at.is.null,closed_at.is.null,status.in.(resolved,closed),updated_at.gte.${a},updated_at.lte.${b})`)})`
  return q
}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  vi.mocked(createClient).mockResolvedValue(clientForToken(fx.admin.accessToken) as never)
  const profile = await getCurrentProfile()
  orgId = profile!.org_id!
  const data = await loadDrillData()
  if ('error' in data) throw new Error(data.error)
  tickets = data.tickets
  dataNow = data.now
  for (const t of (await svc<{ id: string; name: string }[]>('GET', `/teams?select=id,name&org_id=eq.${orgId}`)).json) teams.set(t.id, t.name)
  for (const p of (await svc<{ id: string; full_name: string }[]>('GET', `/profiles?select=id,full_name&org_id=eq.${orgId}&limit=1000`)).json) people.set(p.id, p.full_name)
  env = {
    period: '30d', periodWindow: { start: dataNow - 30 * DAY, end: dataNow }, periodLabel: 'last 30 days', groupIds: [],
    groupName: (id) => teams.get(id), techName: (id) => people.get(id), store: emptyStoreFilter(),
  }
}, 240_000)
afterAll(async () => { await fx?.cleanup() }, 120_000)

/** the pop-up's tickets for this click, using the very function the pop-up uses */
function popupIds(f: DrawerFilter): Set<string> {
  const req = drawerToDrill(f, { ...env, now: dataNow })
  if (!req) throw new Error(`not mappable: ${f.title}`)
  const { ctx, filters } = req
  const { behind } = drillCohort(tickets, filters, dataNow, ctx.win ?? env.periodWindow, { metric: ctx.metric, only: ctx.only, dims: ctx.dims })
  return new Set(behind.map((t) => t.id))
}

async function check(f: DrawerFilter) {
  const req = drawerToDrill(f, { ...env, now: dataNow })!
  const expected = await ids(oldDefinition(f, req.ctx.win ?? null, new Date(dataNow).toISOString()))
  const got = popupIds(f)
  const missing = [...expected].filter((x) => !got.has(x)).length
  const extra = [...got].filter((x) => !expected.has(x)).length
  expect({ title: f.title, size: got.size, missing, extra }).toEqual({ title: f.title, size: expected.size, missing: 0, extra: 0 })

  // the real old drawer (50 most recent rows) must be inside the pop-up's set
  const drawer = await getFilteredRequests(f)
  expect(drawer.error).toBeUndefined()
  for (const r of drawer.data) expect(got.has(r.id), `${f.title}: ${r.id} is in the old list but not in the pop-up`).toBe(true)
  return got.size
}

describe('the normal dashboard numbers open pop-ups with exactly the same tickets', () => {
  it('the data is there to test with', () => { expect(tickets.length).toBeGreaterThan(1000) })

  it('created, resolved and closed in the page period', async () => {
    expect(await check({ title: 'Created', createdInPeriod: true, period: '30d' })).toBeGreaterThan(0)
    expect(await check({ title: 'Resolved', resolvedInPeriod: true, period: '30d', sort: 'tat_desc' })).toBeGreaterThan(0)
    await check({ title: 'Closed', closedInPeriod: true, period: '30d' })
  })

  it('created, resolved and closed over a day and over a week (the Daily Activity and inflow / outflow cards)', async () => {
    const day = (n: number) => { const d = new Date(dataNow - n * DAY); const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return { from: s, to: s } }
    for (const n of [0, 1, 5]) {
      await check({ title: `Created day -${n}`, createdInPeriod: true, period: day(n) })
      await check({ title: `Closed day -${n}`, closedInPeriod: true, period: day(n) })
      await check({ title: `Resolved day -${n}`, resolvedInPeriod: true, period: day(n) })
    }
    await check({ title: 'Inflow week', createdInPeriod: true, period: { from: day(7).from, to: day(0).to } })
    await check({ title: 'Outflow week', closedInPeriod: true, period: { from: day(7).from, to: day(0).to } })
  })

  it('currently breached, first response overdue, all open', async () => {
    await check({ title: 'Breached', slaBreached: true })
    await check({ title: 'FRT', frtBreached: true })
    expect(await check({ title: 'Open', status: [...OPEN_REQUEST_STATUSES] })).toBeGreaterThan(0)
  })

  it('every status, priority, group and technician row', async () => {
    for (const s of new Set(tickets.map((t) => t.status))) await check({ title: `Status ${s}`, status: [s] })
    for (const p of new Set(tickets.map((t) => t.prio))) await check({ title: `Priority ${p}`, priority: p })
    const groupIds = [...teams].filter(([, name]) => tickets.some((t) => t.group === name)).slice(0, 4).map(([id]) => id)
    for (const id of groupIds) await check({ title: `Group ${teams.get(id)}`, teamId: id })
    const techIds = [...people].filter(([, name]) => tickets.some((t) => t.tech === name)).slice(0, 4).map(([id]) => id)
    for (const id of techIds) await check({ title: `Tech ${people.get(id)}`, assignedTo: id })
    expect(groupIds.length + techIds.length).toBeGreaterThan(0)
  })

  it('with a Store Master choice on, the pop-up holds only the tickets of those stores (the same as the old list)', async () => {
    const region = tickets.map((t) => t.region).find((r) => r && r !== '(Not set)')
    if (!region) return   // no Store Master data in this database: nothing to compare
    const f: DrawerFilter = { title: `Region ${region}`, createdInPeriod: true, period: '30d', store: { ...emptyStoreFilter(), region: [region] } }
    const got = popupIds(f)
    expect(got.size).toBeGreaterThan(0)
    for (const t of tickets.filter((x) => got.has(x.id))) expect(t.region).toBe(region)
    const drawer = await getFilteredRequests(f)
    for (const r of drawer.data) expect(got.has(r.id), r.id).toBe(true)
  })
})
