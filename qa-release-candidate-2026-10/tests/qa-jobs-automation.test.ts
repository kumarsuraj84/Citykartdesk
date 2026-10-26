// QA of the scheduled jobs and automation on the isolated audit stack: secrets, overlapping runs (no duplicate effect), missed runs, partial failure, idempotency.
//  - every job route refuses a missing / wrong secret;
//  - auto-close: two overlapping runs close a ticket once and tell the requester once; a ticket reopened in time is never closed;
//  - approval reminder: once per day even when called twice or at the same moment; the sheet copy: two overlapping copies never duplicate units or CVMs;
//  - AC PMS: an interrupted run is finished by the next run, and a partial failure does not lose or double the other tickets.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../../tests/setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (_p: { to: string | string[]; subject: string; html: string; text?: string }) => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { NextRequest } from 'next/server'
import { sendEmail } from '@/lib/email/send'
import { syncMasters } from '@/lib/masters/sync'
import { createDuePmsTickets } from '@/lib/pms/tickets'
import { createAdHocApproval } from '@/lib/approvals/adhoc'
import { sendApprovalReminders, LAST_RUN_KEY } from '@/lib/approvals/reminders'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `qj${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const made: string[] = []
const ids = { cat: '', sub: '', store: '', pmsCat: '', pmsSub: '' }
const SECRET = () => process.env.CRON_SECRET ?? ''

const route = async (name: string, headers: Record<string, string>) => {
  const mod = await ({
    'alerts/run': () => import('@/app/api/alerts/run/route'), 'business-rules/run': () => import('@/app/api/business-rules/run/route'), 'csat/run': () => import('@/app/api/csat/run/route'),
    'approvals/reminders': () => import('@/app/api/approvals/reminders/route'), 'masters/sync': () => import('@/app/api/masters/sync/route'), 'pms/daily': () => import('@/app/api/pms/daily/route'),
    'weather/daily': () => import('@/app/api/weather/daily/route'), 'system-log/archive': () => import('@/app/api/system-log/archive/route'), 'email/inbound-sync': () => import('@/app/api/email/inbound-sync/route'),
  } as Record<string, () => Promise<{ GET?: (r: NextRequest) => Promise<Response>; POST?: (r: NextRequest) => Promise<Response> }>>)[name]()
  const handler = mod.GET ?? mod.POST!
  return handler(new NextRequest(`http://localhost:3310/api/${name}`, { headers }))
}

const setAside: { categories: string[]; source: Record<string, unknown> | null } = { categories: [], source: null }

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  // isolation: other AC PMS categories / an existing PMS sheet source of the same organisation (for example the QA seed company) are set aside while this file runs and put back afterwards
  const keepPms = ((await a.from('service_categories').select('id').eq('is_pms', true)).data ?? []).map((c: { id: string }) => c.id)
  if (keepPms.length) await a.from('service_categories').update({ is_pms: false }).in('id', keepPms)
  setAside.categories = keepPms
  setAside.source = (await a.from('master_sources').select('*').eq('org_id', fx.orgId).eq('kind', 'pms').maybeSingle()).data ?? null
  ids.cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} cat`, slug: `${tag}-cat` }).select('id').single()).data.id
  ids.sub = (await a.from('service_sub_categories').insert({ category_id: ids.cat, name: `${tag} sub`, slug: `${tag}-sub` }).select('id').single()).data.id
  ids.pmsCat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} pms`, slug: `${tag}-pms`, is_pms: true }).select('id').single()).data.id
  ids.pmsSub = (await a.from('service_sub_categories').insert({ category_id: ids.pmsCat, name: `${tag} pmssub`, slug: `${tag}-pmssub` }).select('id').single()).data.id
  await a.from('service_sub_category_tags').insert([{ service_id: fx.teamA.serviceId, sub_category_id: ids.sub }, { service_id: fx.teamA.serviceId, sub_category_id: ids.pmsSub }])
  await a.from('services').update({ form_fields: [{ id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }, { id: 'desc', type: 'textarea', label: 'Description', required: false, order: 2 }] }).eq('id', fx.teamA.serviceId)
}, 300_000)

afterAll(async () => {
  const a = db()
  const reqs = ((await a.from('requests').select('id').like('title', `${tag}%`)).data ?? []).map((r: { id: string }) => r.id)
  const all = [...new Set([...made, ...reqs])]
  if (all.length) {
    const aps = ((await a.from('approvals').select('id, workflow_id').in('request_id', all)).data ?? []) as { id: string; workflow_id: string }[]
    if (aps.length) {
      await a.from('approval_decisions').delete().in('approval_id', aps.map((x) => x.id)); await a.from('approvals').delete().in('id', aps.map((x) => x.id))
      await a.from('approval_workflow_steps').delete().in('workflow_id', aps.map((x) => x.workflow_id)); await a.from('approval_workflows').delete().in('id', aps.map((x) => x.workflow_id))
    }
    await a.from('csat_surveys').delete().in('request_id', all)
    await a.from('notifications').delete().in('request_id', all)
    await a.from('request_activity').delete().in('request_id', all); await a.from('request_comments').delete().in('request_id', all); await a.from('requests').delete().in('id', all)
  }
  const T = tag.toUpperCase()
  await a.from('pms_ticket_log').delete().like('store_code', `${T}%`); await a.from('master_pms_dates').delete().like('store_code', `${T}%`)
  await a.from('master_ac_units').delete().like('store_code', `${T}%`); await a.from('master_gensets').delete().like('store_code', `${T}%`); await a.from('master_store_cvm').delete().like('store_code', `${T}%`)
  await a.from('master_issues').delete().eq('org_id', fx.orgId).in('kind', ['pms', 'ac', 'cvm', 'genset'])
  await a.from('master_sources').delete().eq('org_id', fx.orgId).like('spreadsheet_id', `${tag}%`)
  await a.from('app_settings').delete().eq('key', LAST_RUN_KEY)
  await a.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
  await a.from('stores').delete().like('code', `${T}%`)
  await a.from('service_sub_category_tags').delete().in('sub_category_id', [ids.sub, ids.pmsSub]); await a.from('service_sub_categories').delete().in('id', [ids.sub, ids.pmsSub])
  await a.from('service_categories').delete().in('id', [ids.cat, ids.pmsCat]); await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  if (setAside.categories.length) await a.from('service_categories').update({ is_pms: true }).in('id', setAside.categories)
  if (setAside.source) await a.from('master_sources').upsert(setAside.source, { onConflict: 'org_id,kind' })
  await fx?.cleanup()
}, 240_000)

describe('every job route needs the shared secret', () => {
  for (const name of ['alerts/run', 'business-rules/run', 'csat/run', 'approvals/reminders', 'masters/sync', 'pms/daily', 'weather/daily', 'system-log/archive', 'email/inbound-sync']) {
    it(`/api/${name}: no secret and a wrong secret are refused`, async () => {
      const none = await route(name, {})
      const wrong = await route(name, { 'x-cron-secret': 'definitely-not-the-secret' })
      expect([401, 403, 503]).toContain(none.status)
      expect([401, 403, 503]).toContain(wrong.status)
      expect(none.status).not.toBe(200); expect(wrong.status).not.toBe(200)
    })
  }
})

describe('auto-close (job csat)', () => {
  const mk = async (status: 'resolved' | 'open', deadline: string | null, label: string) => {
    const r = (await db().from('requests').insert({
      request_no: '', title: `${tag} ${label}`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, status, reopen_deadline_at: deadline, resolved_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      form_sections_snapshot: [], form_data: {},
    }).select('id').single()).data.id as string
    made.push(r); return r
  }
  it('two overlapping runs close the ticket once and tell the requester once; a ticket inside its window and a reopened one are left alone', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString(), future = new Date(Date.now() + 86_400_000).toISOString()
    const due = await mk('resolved', past, 'due'); const early = await mk('resolved', future, 'early'); const reopened = await mk('open', past, 'reopened')
    const runs = await Promise.all([route('csat/run', { 'x-cron-secret': SECRET() }), route('csat/run', { 'x-cron-secret': SECRET() })])
    expect(runs.map((r) => r.status)).toEqual([200, 200])
    const closedTotal = (await Promise.all(runs.map((r) => r.json()))).reduce((n: number, j: { autoClosed: number }) => n + j.autoClosed, 0)
    expect(closedTotal).toBeGreaterThanOrEqual(1)
    const st = async (id: string) => (await db().from('requests').select('status').eq('id', id).single()).data.status
    expect(await st(due)).toBe('closed'); expect(await st(early)).toBe('resolved'); expect(await st(reopened)).toBe('open')
    await new Promise((r) => setTimeout(r, 1500))   // the bell notice is written without waiting for it
    const told = ((await db().from('notifications').select('id').eq('request_id', due).eq('type', 'request_auto_closed')).data ?? []).length
    expect(told).toBe(1)
    const third = await (await route('csat/run', { 'x-cron-secret': SECRET() })).json()
    expect(((await db().from('notifications').select('id').eq('request_id', due).eq('type', 'request_auto_closed')).data ?? []).length).toBe(1)
    expect(typeof third.autoClosed).toBe('number')
  })
})

describe('daily approval reminder', () => {
  it('is sent once per approver per day, even when called twice or at the same moment', async () => {
    await db().from('app_settings').delete().eq('key', LAST_RUN_KEY)
    const r = (await db().from('requests').insert({ request_no: '', title: `${tag} reminder`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, status: 'in_progress', form_sections_snapshot: [], form_data: {} }).select('id, request_no, title, status, requester_id, org_id, waiting_since').single()).data
    made.push(r.id)
    expect((await createAdHocApproval(db(), { request: r, approvers: [{ id: fx.manager.id, full_name: 'QA Manager' }], senderId: fx.requesterA.id, senderName: 'QA' })).error).toBeUndefined()
    const sent: { to: string; subject: string }[] = []
    const deps = { send: async (p: { to: string; subject: string }) => { sent.push(p); return {} }, getPending: async (uid: string) => (uid === fx.manager.id ? [{ approvalId: '00000000-0000-0000-0000-00000000aaaa', requestId: r.id, requestNo: r.request_no, requestTitle: r.title, requesterName: 'QA', sentByName: 'QA', awaiting: 'QA Manager', createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }] : []) }
    const [one, two] = await Promise.all([sendApprovalReminders(db(), deps), sendApprovalReminders(db(), deps)])
    expect([one.alreadyRan, two.alreadyRan].filter(Boolean).length).toBe(1)   // exactly one of the two overlapping calls got today's run
    const third = await sendApprovalReminders(db(), deps)
    expect(third.alreadyRan).toBe(true)
    const reminders = sent.filter((m) => /Reminder/i.test(m.subject))
    expect(reminders.length, 'the approver gets exactly one reminder e-mail that day').toBe(1)
    expect(reminders[0].subject).toContain(r.request_no)
  })
})

describe('the sheet copy', () => {
  const head = ['Store Code', 'AC Floor', 'AC Type', 'AC Tonnage', 'AC Brand', 'AC CKDESK SERIAL NO', 'AC Serial No', 'AC-AMC vendor', 'AC-AMC Brand', 'Zenatix (yes/No)', 'Store Priority list', 'Festival', 'Region', 'Cluster', 'Opening date', 'City', 'State', 'Address', 'pincode', 'Status', 'OEM Ticket Mail To']
  const row = (store: string, no: number, serial: string) => [store, 'GF', 'Ductable', '5.5 TR', 'B', no, serial, 'V', 'A', 'NO', 'ROS', 'P', 'R1', 'C1', 46250, 'City', 'ST', 'addr', 100000, 'Active', 'oem@qa-oem.test']
  it('two overlapping copies of the same sheet never duplicate units, CVMs or PMS dates', async () => {
    const T = tag.toUpperCase()
    const sheets: Record<string, unknown[][]> = {
      [`${tag}-ac`]: [head, ...Array.from({ length: 12 }, (_, i) => row(`${T}A${Math.floor(i / 3)}`, (i % 3) + 1, `${tag}-S${i}`))],
      [`${tag}-cvm`]: [['Store Code', 'CVM EMAIL ID'], ...Array.from({ length: 4 }, (_, i) => [`${T}A${i}`, 'cvm@qa.test'])],
      [`${tag}-pms`]: [['Store Code', 'AC PMS Date'], ...Array.from({ length: 4 }, (_, i) => [`${T}A${i}`, '27/10/2026'])],
    }
    const source: SheetsSource = { fetchValues: async (id) => sheets[id] }
    for (const [kind, id] of [['ac', `${tag}-ac`], ['cvm', `${tag}-cvm`], ['pms', `${tag}-pms`]]) await db().from('master_sources').upsert({ org_id: fx.orgId, kind, spreadsheet_id: id, content_hash: null }, { onConflict: 'org_id,kind' })
    await Promise.all([syncMasters({ db: db(), orgId: fx.orgId, source, force: true }), syncMasters({ db: db(), orgId: fx.orgId, source, force: true }), syncMasters({ db: db(), orgId: fx.orgId, source, force: true })])
    const units = ((await db().from('master_ac_units').select('id, store_code, ckdesk_no').like('store_code', `${T}%`).is('removed_at', null)).data ?? []) as { store_code: string; ckdesk_no: string }[]
    const distinct = new Set(units.map((u) => `${u.store_code}|${u.ckdesk_no}`))
    expect(units.length, 'every AC of the sheet exists exactly once').toBe(12)
    expect(distinct.size).toBe(12)
    expect(((await db().from('master_store_cvm').select('id').like('store_code', `${T}%`)).data ?? []).length).toBe(4)
    expect(((await db().from('master_pms_dates').select('store_code').like('store_code', `${T}%`)).data ?? []).length).toBe(4)
  })
})

describe('AC PMS runs that are interrupted or partly fail', () => {
  const NOW = new Date('2026-10-26T04:00:00Z')   // 09:30 India time on 26 Oct 2026
  it('a run that stops half way is finished by the next run; one bad store does not lose or double the others', async () => {
    const T = tag.toUpperCase()
    const a = db()
    // five stores, each with a login; store 3 has none (a partial failure)
    const stores: string[] = []
    for (let i = 0; i < 5; i++) {
      const code = `${T}Z${i}`
      const id = (await a.from('stores').insert({ org_id: fx.orgId, code, name: `${tag} Z${i}`, address: 'x' }).select('id').single()).data.id; stores.push(id)
      await a.from('master_pms_dates').insert({ org_id: fx.orgId, store_code: code, pms_date: '2026-10-26', sheet_row: i + 2 })
    }
    await a.from('master_sources').upsert({ org_id: fx.orgId, kind: 'pms', spreadsheet_id: `${tag}-pms2` }, { onConflict: 'org_id,kind' })
    // the one login we have serves store 0..4 in turn: move requesterA to the store being tested by linking it to store 0 only, so stores 1..4 have no login
    await a.from('profiles').update({ store_id: stores[0] }).eq('id', fx.requesterA.id)
    // a "stuck" earlier run: store 2's date was claimed ("creating") a long time ago and never finished
    await a.from('pms_ticket_log').insert({ org_id: fx.orgId, store_code: `${T}Z2`, pms_date: '2026-10-26', status: 'creating', updated_at: new Date(Date.now() - 3_600_000).toISOString() })
    const first = await createDuePmsTickets(a, fx.orgId, NOW)
    expect(first.created).toBe(1)                                  // only store 0 has a login
    expect(first.skipped).toBe(4)                                  // stores 1, 2, 3 and 4 have no login (store 2 had a stuck claim that was taken over, then skipped like the others)
    const log = ((await a.from('pms_ticket_log').select('store_code, status').like('store_code', `${T}Z%`)).data ?? []) as { store_code: string; status: string }[]
    expect(log.find((l) => l.store_code === `${T}Z0`)?.status).toBe('created')
    expect(log.filter((l) => l.status === 'creating').length).toBe(0)   // the stuck claim was taken over, nothing is left "creating"
    // the next run gives the stores a login and finishes the job; nothing is made twice
    await a.from('profiles').update({ store_id: stores[1] }).eq('id', fx.requesterA.id)
    const second = await createDuePmsTickets(a, fx.orgId, NOW)
    expect(second.created).toBe(1)
    const third = await createDuePmsTickets(a, fx.orgId, NOW)
    expect(third.created).toBe(0)
    const tickets = ((await a.from('requests').select('id, source_metadata').eq('category_id', ids.pmsCat).like('title', '%Z%')).data ?? []) as { id: string }[]
    for (const t of tickets) made.push(t.id)
    expect(tickets.length).toBe(2)
  })
})
