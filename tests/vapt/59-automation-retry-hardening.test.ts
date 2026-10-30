// Ticket automation, audit hardening (migration 194), on the isolated audit stack (mail goes nowhere). Modelled on 47-ticket-automation-rerun.test.ts. NOT run by the author of
// the change: it needs the isolated stack with migrations 190 and 194.
//  - C-03: a ticket remembers which automatic steps it was EXPECTED to have when it was made; the 15-minute retry never mails a vendor for a step that was not expected then
//    (a category moved into a program later), while the administrator's button still can;
//  - C-02: the button and the retry share ONE claim: a run in progress stops a second one, a stale claim is taken over, two clicks at once send ONE mail;
//  - C-02: a mail that was started and never finished is "may or may not have gone out": the retry leaves it, the button runs it once;
//  - C-01: a ticket the retry has nothing more to do for is "settled" and is not examined again; every examined ticket is stamped, so older tickets cannot starve newer ones;
//  - C-23: "Run automation again" gives the ticket out again (assign actions only) and writes its public messages as the requester, not as the administrator.
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
import { runTicketAutomationAgain } from '@/lib/actions/automation'
import { diagnoseTickets } from '@/lib/automation/diagnose'
import { runAutomationRetry } from '@/lib/automation/rerun'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t59${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const A = `${tag}a`.toUpperCase()
const ids = { storeA: '', program: '', cat: '', sub: '', plainCat: '', plainSub: '' }
const made: string[] = []
const ruleIds: string[] = []
const SHEET = `${tag}-sheet-automation-0`
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000)
const mailsFor = (title: string) => vi.mocked(sendEmail).mock.calls.map((c) => c[0] as unknown as { html: string; subject: string }).filter((m) => m.subject.startsWith('New ticket') && m.html.includes(`${tag} ${title}`))

async function raise(title: string, sub = ids.sub) {
  await db().from('profiles').update({ store_id: ids.storeA }).eq('id', fx.requesterA.id)
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
const comments = async (id: string) => ((await db().from('request_comments').select('body, is_internal, author_id').eq('request_id', id)).data ?? []) as { body: string; is_internal: boolean; author_id: string }[]

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  ids.storeA = (await a.from('stores').insert({ org_id: fx.orgId, code: A, name: `${tag} A`, address: 'Main Road' }).select('id').single()).data.id as string
  ids.program = (await a.from('vendor_programs').insert({
    org_id: fx.orgId, name: 'Hardening program', slug: `${tag}-hard`, is_active: true, level: 'mail', row_type: 'store', spreadsheet_id: SHEET,
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
  sheets[SHEET] = [['Store Code', 'Ticket Mail To'], [A, 'vendor-a@oem.test']]
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
  await a.from('stores').delete().eq('id', ids.storeA)
  await fx?.cleanup()
}, 180_000)

beforeEach(() => { failMail = false })

describe('what a ticket is expected to do is written when it is made (C-03)', () => {
  it('a ticket of a program category expects the mail; a plain ticket does not', async () => {
    const prog = await raise('expects mail')
    const plain = await raise('expects nothing', ids.plainSub)
    expect((await stateRow(prog)).expected_steps).toEqual({ rules: true, vendor_mail: true, cvm: false })
    expect((await stateRow(plain)).expected_steps).toEqual({ rules: true, vendor_mail: false, cvm: false })
  })

  it('a category moved into a program AFTER the ticket was made is not mailed by the retry, but the administrator can still run it', async () => {
    const id = await raise('came before go-live', ids.plainSub)
    await db().from('service_categories').update({ program_id: ids.program }).eq('id', ids.plainCat)   // the program goes live for this category now
    try {
      const d = await diag(id)
      expect(step(d, 'vendor_mail')).toMatchObject({ state: 'missing', autoSafe: false, wasExpected: false })
      vi.mocked(sendEmail).mockClear()
      await runAutomationRetry(db(), later(11))
      expect(mailsFor('came before go-live')).toHaveLength(0)                         // the cron mailed nobody for a ticket that pre-dates go-live
      actAs(fx.admin)
      const run = await runTicketAutomationAgain(id)
      expect(run.ok).toBe(true); expect(run.outcomes.find((o) => o.key === 'vendor_mail')?.after).toBe('done')
      expect(mailsFor('came before go-live')).toHaveLength(1)                         // a person decided, so it went
    } finally {
      await db().from('service_categories').update({ program_id: null }).eq('id', ids.plainCat)
    }
  })

  it('a ticket with no record of its expected steps is never retried by itself', async () => {
    failMail = true
    const id = await raise('no record')
    failMail = false
    await db().from('request_automation_state').update({ expected_steps: null }).eq('request_id', id)
    expect(step(await diag(id), 'vendor_mail').autoSafe).toBe(false)
    vi.mocked(sendEmail).mockClear()
    await runAutomationRetry(db(), later(11))
    expect(mailsFor('no record')).toHaveLength(0)
  })
})

describe('one claim for the button and the retry (C-02)', () => {
  it('two clicks at once send ONE mail', async () => {
    failMail = true
    const id = await raise('double click')
    failMail = false
    vi.mocked(sendEmail).mockClear()
    actAs(fx.admin)
    const [r1, r2] = await Promise.all([runTicketAutomationAgain(id), runTicketAutomationAgain(id)])
    expect([r1, r2].filter((r) => r.outcomes.some((o) => o.key === 'vendor_mail' && o.after === 'done'))).toHaveLength(1)
    expect(mailsFor('double click')).toHaveLength(1)
    expect((await stateRow(id)).running_since).toBeNull()                            // the claim is released at the end
  })

  it('a run in progress stops a second one; a claim older than 10 minutes belongs to a run that died and is taken over', async () => {
    failMail = true
    const id = await raise('claimed')
    failMail = false
    actAs(fx.admin)
    await db().from('request_automation_state').update({ running_since: new Date().toISOString() }).eq('request_id', id)
    vi.mocked(sendEmail).mockClear()
    const blocked = await runTicketAutomationAgain(id)
    expect(blocked.ok).toBe(false); expect(blocked.error).toMatch(/being run at this moment/i)
    expect(mailsFor('claimed')).toHaveLength(0)
    await db().from('request_automation_state').update({ running_since: new Date(Date.now() - 11 * 60_000).toISOString() }).eq('request_id', id)
    const taken = await runTicketAutomationAgain(id)
    expect(taken.ok).toBe(true); expect(mailsFor('claimed')).toHaveLength(1)
  })

  it('a mail that was started and never finished is left to a person: the retry does nothing, the button runs it once', async () => {
    failMail = true
    const id = await raise('half sent')
    failMail = false
    await db().from('request_automation_state').update({ mail_started_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq('request_id', id)
    const d = await diag(id)
    expect(step(d, 'vendor_mail')).toMatchObject({ state: 'missing', autoSafe: false })
    expect(step(d, 'vendor_mail').detail).toMatch(/may or may not have gone out/)
    vi.mocked(sendEmail).mockClear()
    await runAutomationRetry(db(), later(11))
    expect(mailsFor('half sent')).toHaveLength(0)
    actAs(fx.admin)
    const run = await runTicketAutomationAgain(id)
    expect(run.ok).toBe(true); expect(mailsFor('half sent')).toHaveLength(1)
  })

  it('the proof that a mail went out is the saved copy of the mailed rows, not text anybody can type', async () => {
    failMail = true
    const id = await raise('forged')
    failMail = false
    await db().from('request_comments').insert({ request_id: id, author_id: fx.requesterA.id, is_internal: false, body: 'Ticket sent to the Fake OEM for servicing. (typed by hand)' })
    // an old ticket is still judged by the message (the fallback); a ticket with a snapshot is judged by the snapshot
    const snap = (await db().from('request_program_snapshots').select('mailed_to, mailed_cc').eq('request_id', id).maybeSingle()).data
    expect([...(snap?.mailed_to ?? []), ...(snap?.mailed_cc ?? [])]).toEqual([])    // the failed mail left the recipients empty
  })
})

describe('the retry settles what it cannot help (C-01)', () => {
  it('a healthy ticket is stamped and settled and not touched again; a ticket waiting for its sheet stays under the retry and is mailed when the sheet is fixed', async () => {
    const ok = await raise('healthy')
    await db().from('program_rows').update({ emails: [] }).eq('program_id', ids.program).eq('store_code', A)   // no address any more: the next ticket's mail cannot go
    const stuck = await raise('blocked one')
    for (const id of [ok, stuck]) await db().from('request_automation_state').update({ started_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq('request_id', id)
    await runAutomationRetry(db(), later(1))
    const stOk = await stateRow(ok)
    expect(stOk.auto_checked_at).toBeTruthy()
    expect(stOk.settled_at).toBeTruthy()                                             // nothing the retry may do: not examined again
    const stStuck = await stateRow(stuck)
    expect(stStuck.auto_checked_at).toBeTruthy()
    expect(stStuck.settled_at).toBeNull()                                            // waiting for the sheet: still under the retry
    await db().from('program_rows').update({ emails: ['vendor-a@oem.test'] }).eq('program_id', ids.program).eq('store_code', A)   // the sheet was fixed
    vi.mocked(sendEmail).mockClear()
    await runAutomationRetry(db(), later(20))
    expect(mailsFor('blocked one')).toHaveLength(1)                                   // picked up as soon as the sheet was right
    expect(mailsFor('healthy')).toHaveLength(0)                                      // the settled one was not touched
  })
})

describe('Run automation again gives the ticket out again without repeating the other rule actions (C-23)', () => {
  it('only the assign action runs; the public messages are written by the requester, the note names the administrator', async () => {
    const id = await raise('rules again', ids.plainSub)
    const rule = (await db().from('business_rules').insert({
      org_id: fx.orgId, name: `${tag} assign+priority`, trigger: ['created'], is_active: true, execution_order: 9400,
      conditions: [{ field: 'category_id', operator: 'equals', value: ids.plainCat }],
      actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [fx.agentA.id] } }, { type: 'set_priority', params: { priority: 'urgent' } }],
    }).select('id').single()).data.id as string
    ruleIds.push(rule)
    await db().from('requests').update({ priority: 'low', assigned_to: null }).eq('id', id)   // an agent changed the priority after the ticket came
    actAs(fx.admin)
    const run = await runTicketAutomationAgain(id)
    expect(run.ok).toBe(true)
    expect((await reqRow(id)).assigned_to).toBe(fx.agentA.id)
    expect((await db().from('requests').select('priority').eq('id', id).single()).data.priority).toBe('low')   // the priority rule was NOT run again
    const note = (await comments(id)).find((c) => c.is_internal && /ran the automation of this ticket again/i.test(c.body))
    expect(note?.author_id).toBe(fx.admin.id)
    expect((await comments(id)).filter((c) => !c.is_internal).every((c) => c.author_id !== fx.admin.id)).toBe(true)
  })
})
