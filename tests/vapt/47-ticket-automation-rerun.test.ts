// "Run automation again", the 15-minute retry and the Stuck tickets list, on the isolated audit stack (mail goes nowhere):
//  - a ticket whose mail to the OEM / vendor failed is shown as "missing", and the button (administrator / platform owner ONLY) sends it once; pressing again does nothing, no second mail;
//  - a step that cannot work (the sheet has no address) is "blocked", not run, and is picked up by the automatic retry once the sheet is fixed;
//  - the automatic retry tries 3 times, then gives up and leaves a note; the button still works after that;
//  - a ticket the Business Rules gave to nobody is a "queue" ticket: the retry leaves it alone, the button runs the rules again; an INTERRUPTED one the retry finishes by itself;
//  - a resolved ticket has nothing to run.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
let failMail = false
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => (failMail ? { error: 'smtp down' } : {})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { createRequest } from '@/lib/actions/requests'
import { syncPrograms } from '@/lib/programs/sync'
import { getTicketAutomation, runTicketAutomationAgain } from '@/lib/actions/automation'
import { diagnoseTickets } from '@/lib/automation/diagnose'
import { runAutomationRetry } from '@/lib/automation/rerun'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t47${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const code = (s: string) => `${tag}${s}`.toUpperCase()
const A = code('a'), B = code('b')
const ids = { storeA: '', storeB: '', program: '', cat: '', sub: '', plainCat: '', plainSub: '' }
const made: string[] = []
const ruleIds: string[] = []
const SHEET = `${tag}-sheet-automation-0`
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const HEAD = ['Store Code', 'Ticket Mail To']
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000)
// the mail to the vendor only (the program's subject starts with "New ticket"), not the "your ticket was logged" mail to the requester
const mailsFor = (title: string) => vi.mocked(sendEmail).mock.calls.map((c) => c[0] as unknown as { html: string; subject: string }).filter((m) => m.subject.startsWith('New ticket') && m.html.includes(`${tag} ${title}`))

async function raise(title: string, store: string | null, sub = ids.sub) {
  await db().from('profiles').update({ store_id: store }).eq('id', fx.requesterA.id)
  actAs(fx.requesterA)
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', sub)
  f.set('form_data', JSON.stringify({ subject: `${tag} ${title}` }))
  const r = await createRequest(f)
  expect(r.error).toBeUndefined()
  made.push(r.requestId!)
  return r.requestId!
}
const reqRow = async (id: string) => (await db().from('requests').select('status, assigned_to').eq('id', id).single()).data as { status: string; assigned_to: string | null }
const stateRow = async (id: string) => (await db().from('request_automation_state').select('*').eq('request_id', id).single()).data as Record<string, unknown>
const diag = async (id: string) => (await diagnoseTickets(db(), [id]))[0]
const step = (d: Awaited<ReturnType<typeof diag>>, key: string) => d.steps.find((s) => s.key === key)!
const notes = async (id: string) => ((await db().from('request_comments').select('body, is_internal').eq('request_id', id)).data ?? []) as { body: string; is_internal: boolean }[]

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  const mkStore = async (c: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: c, name: `${tag} ${c}`, address: 'Main Road' }).select('id').single()).data.id as string
  ids.storeA = await mkStore(A); ids.storeB = await mkStore(B)
  ids.program = (await a.from('vendor_programs').insert({
    org_id: fx.orgId, name: 'Auto test program', slug: `${tag}-auto`, is_active: true, level: 'mail', row_type: 'store', spreadsheet_id: SHEET,
    mail_subject: 'New ticket {{ticket_no}}', mail_body_html: '<p>Ticket {{ticket_no}}: {{subject}}</p>',
  }).select('id').single()).data.id
  const mkCat = async (n: string, extra: Record<string, unknown>) => {
    const cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ${n}`, slug: `${tag}-${n}-cat`, ...extra }).select('id').single()).data.id as string
    const sub = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} ${n}-sub`, slug: `${tag}-${n}-sub` }).select('id').single()).data.id as string
    await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: sub })
    return { cat, sub }
  }
  const p = await mkCat('prog', { program_id: ids.program }); ids.cat = p.cat; ids.sub = p.sub
  const q = await mkCat('plain', {}); ids.plainCat = q.cat; ids.plainSub = q.sub
  await a.from('services').update({ form_fields: [{ id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }] }).eq('id', fx.teamA.serviceId)
  sheets[SHEET] = [HEAD, [A, 'vendor-a@oem.test'], [B, '']]   // store B is in the sheet but has no address
  await syncPrograms({ db: a, orgId: fx.orgId, source, force: true })
}, 300_000)

afterAll(async () => {
  const a = db()
  await a.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
  if (ruleIds.length) await a.from('business_rules').delete().in('id', ruleIds)
  if (made.length) {
    await a.from('request_automation_state').delete().in('request_id', made)
    await a.from('request_program_snapshots').delete().in('request_id', made); await a.from('request_activity').delete().in('request_id', made)
    await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('service_sub_category_tags').delete().in('sub_category_id', [ids.sub, ids.plainSub])
  await a.from('service_sub_categories').delete().in('id', [ids.sub, ids.plainSub])
  await a.from('service_categories').delete().in('id', [ids.cat, ids.plainCat])
  await a.from('vendor_programs').delete().eq('id', ids.program)
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  await a.from('stores').delete().in('id', [ids.storeA, ids.storeB])
  await fx?.cleanup()
}, 180_000)

beforeEach(() => { failMail = false })

describe('a ticket whose mail to the vendor failed', () => {
  it('is shown as missing; only an administrator or platform owner can see it or press the button; the button sends the mail ONCE', async () => {
    failMail = true
    const id = await raise('mail failed', ids.storeA)
    failMail = false
    expect((await reqRow(id)).status).toBe('open')                                  // the mail failed, so the ticket did not move
    const st = await stateRow(id)
    expect(st.started_at).toBeTruthy(); expect(st.rules_ran_at).toBeTruthy(); expect(st.finished_at).toBeTruthy()   // creation remembered how far it got
    const d = await diag(id)
    expect(step(d, 'vendor_mail').state).toBe('missing'); expect(step(d, 'vendor_mail').autoSafe).toBe(true); expect(d.kind).toBe('broken')

    // nobody but administrators and platform owners
    for (const who of [fx.requesterA, fx.agentA, fx.manager]) {
      actAs(who)
      expect(await getTicketAutomation(id)).toBeNull()
      const r = await runTicketAutomationAgain(id)
      expect(r.ok).toBe(false); expect(r.error).toMatch(/administrator or platform owner/i)
    }
    expect((await reqRow(id)).status).toBe('open')

    vi.mocked(sendEmail).mockClear()
    actAs(fx.admin)
    expect((await getTicketAutomation(id))?.kind).toBe('broken')
    const run = await runTicketAutomationAgain(id)
    expect(run.ok).toBe(true); expect(run.outcomes.find((o) => o.key === 'vendor_mail')?.after).toBe('done')
    expect((await reqRow(id)).status).toBe('in_progress')                           // the mail went, the ticket moved on, like a normal ticket
    expect(mailsFor('mail failed')).toHaveLength(1)
    expect((await notes(id)).some((n) => n.is_internal && /ran the automation of this ticket again/i.test(n.body))).toBe(true)
    expect((await diag(id)).kind).toBe('ok')

    // pressing again (or a platform owner after the administrator) repeats nothing
    actAs(fx.platformOwner)
    const again = await runTicketAutomationAgain(id)
    expect(again.ok).toBe(true); expect(again.outcomes).toEqual([])
    expect(mailsFor('mail failed')).toHaveLength(1)
  })

  it('the automatic retry tries 3 times, then gives up with a note; the button still works afterwards', async () => {
    failMail = true
    const id = await raise('always failing', ids.storeA)
    vi.mocked(sendEmail).mockClear()
    for (const minutes of [11, 30, 50, 70]) await runAutomationRetry(db(), later(minutes))   // the 4th run must do nothing more
    const st = await stateRow(id)
    expect(st.auto_attempts).toBe(3); expect(st.gave_up_at).toBeTruthy()
    expect(mailsFor('always failing')).toHaveLength(3)                               // exactly three tries, not four
    expect((await notes(id)).some((n) => n.is_internal && /tried 3 times/i.test(n.body))).toBe(true)
    expect((await diag(id)).gaveUp).toBe(true)

    failMail = false
    actAs(fx.admin)
    const run = await runTicketAutomationAgain(id)
    expect(run.ok).toBe(true); expect((await reqRow(id)).status).toBe('in_progress')
  })
})

describe('a step that cannot work yet', () => {
  it('is "blocked", not run by the button, and picked up by the automatic retry as soon as the sheet is fixed', async () => {
    const id = await raise('no address', ids.storeB)
    expect((await reqRow(id)).status).toBe('open')
    const d = await diag(id)
    expect(step(d, 'vendor_mail').state).toBe('blocked'); expect(step(d, 'vendor_mail').detail).toMatch(/no e-mail address/i); expect(d.kind).not.toBe('broken')   // nothing broken: the mail simply cannot go yet

    actAs(fx.admin)
    const run = await runTicketAutomationAgain(id)
    expect(run.ok).toBe(true); expect(run.outcomes.some((o) => o.key === 'vendor_mail')).toBe(false)   // the button does not try the mail: it cannot work yet

    await db().from('program_rows').update({ emails: ['vendor-b@oem.test'] }).eq('program_id', ids.program).eq('store_code', B)   // the sheet was fixed
    expect(step(await diag(id), 'vendor_mail').state).toBe('missing')
    vi.mocked(sendEmail).mockClear()
    await runAutomationRetry(db(), later(11))
    expect((await reqRow(id)).status).toBe('in_progress')
    expect(mailsFor('no address')).toHaveLength(1)
  })
})

describe('the Business Rules step', () => {
  it('a ticket the rules gave to nobody is a queue ticket: the retry leaves it alone, the button runs the rules again; an interrupted one the retry finishes', async () => {
    const id = await raise('queue ticket', null, ids.plainSub)
    expect((await reqRow(id)).assigned_to).toBeNull()
    // a rule is fixed / added AFTER the ticket came
    const rule = (await db().from('business_rules').insert({ org_id: fx.orgId, name: `${tag} assign`, trigger: ['created'], is_active: true, execution_order: 9300, conditions: [{ field: 'category_id', operator: 'equals', value: ids.plainCat }], actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [fx.agentA.id] } }] }).select('id').single()).data.id as string
    ruleIds.push(rule)
    const d = await diag(id)
    expect(d.kind).toBe('unassigned'); expect(step(d, 'rules').state).toBe('missing'); expect(step(d, 'rules').autoSafe).toBe(false)
    await runAutomationRetry(db(), later(11))
    expect((await reqRow(id)).assigned_to).toBeNull()                                // the retry never decides this by itself
    actAs(fx.admin)
    const run = await runTicketAutomationAgain(id)
    expect(run.ok).toBe(true); expect((await reqRow(id)).assigned_to).toBe(fx.agentA.id)

    // interrupted while being made (the rules never ran): the retry finishes it
    const id2 = await raise('interrupted', null, ids.plainSub)
    await db().from('requests').update({ assigned_to: null }).eq('id', id2)
    await db().from('request_automation_state').update({ rules_ran_at: null, finished_at: null, started_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq('request_id', id2)
    const d2 = await diag(id2)
    expect(d2.interrupted).toBe(true); expect(step(d2, 'rules').autoSafe).toBe(true); expect(d2.kind).toBe('broken')
    await runAutomationRetry(db(), later(1))
    expect((await reqRow(id2)).assigned_to).toBe(fx.agentA.id)
    expect((await diag(id2)).kind).toBe('ok')
  })
})

describe('a ticket that is already finished', () => {
  it('a resolved ticket has nothing to run', async () => {
    failMail = true
    const id = await raise('resolved one', ids.storeA)
    failMail = false
    await db().from('requests').update({ status: 'resolved' }).eq('id', id)
    const d = await diag(id)
    expect(d.eligible).toBe(false); expect(d.steps).toEqual([])
    actAs(fx.admin)
    const run = await runTicketAutomationAgain(id)
    expect(run.ok).toBe(false)
  })
})
