// PMS tickets, audit hardening (C-04 / C-17 / C-18 / D-05), on the isolated audit stack (mail goes nowhere). Modelled on 48-program-pms.test.ts. NOT run by the author of the change.
//  - a run that died after the ticket was made but before the log row was written does not make a SECOND ticket (nor a second mail): the existing ticket is found and the row settled;
//  - a date that could not be made stays in the problem list after its day (7 days) with the words "has passed"; a past date nobody even tried is listed too; it is still never made;
//  - the PMS tickets are made whether or not Google Sheets is connected, and the administrators are told ONCE a day when some could not be made;
//  - dates never tried come before dates that already failed (so failing stores cannot use up the limit of one run).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { sendEmail } from '@/lib/email/send'
import { syncPrograms } from '@/lib/programs/sync'
import { createDueProgramPmsTickets } from '@/lib/programs/pms'
import { makeDuePmsTicketsForOrg } from '@/lib/masters/run'
import { istNow, addDays } from '@/lib/pms/window'
import type { SheetsSource } from '@/lib/masters/google'
import type { ProgramRecord } from '@/lib/programs/types'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t60${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const code = (s: string) => `${tag}${s}`.toUpperCase()
const A = code('a'), B = code('b')
const ids = { storeA: '', storeB: '', program: '', cat: '', sub: '' }
const made: string[] = []
const MAIN = `${tag}-main-sheet-00000`, PMS = `${tag}-pms-sheet-000000`
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const today = istNow(new Date()).date
const yesterday = addDays(today, -1), threeDaysAgo = addDays(today, -3)
const at = (hh: number, mm: number) => new Date(`${today}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`)
const program = async () => (await db().from('vendor_programs').select('*').eq('id', ids.program).single()).data as ProgramRecord
const logRows = async () => ((await db().from('program_pms_log').select('store_code, pms_date, status, request_id, note').eq('program_id', ids.program)).data ?? []) as { store_code: string; pms_date: string; status: string; request_id: string | null; note: string | null }[]
const issues = async () => ((await db().from('program_issues').select('code, store_code, message').eq('program_id', ids.program)).data ?? []) as { code: string; store_code: string | null; message: string }[]
const tickets = async () => ((await db().from('requests').select('id').eq('category_id', ids.cat)).data ?? []) as { id: string }[]

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  const mkStore = async (c: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: c, name: `${tag} ${c}`, address: 'Main Road' }).select('id').single()).data.id as string
  ids.storeA = await mkStore(A); ids.storeB = await mkStore(B)
  await a.from('profiles').update({ store_id: ids.storeA }).eq('id', fx.requesterA.id)      // store A has a login; store B has none
  ids.program = (await a.from('vendor_programs').insert({
    org_id: fx.orgId, name: 'Resilience program', slug: `${tag}-res`, level: 'mail', row_type: 'store', is_active: true, spreadsheet_id: MAIN, pms_spreadsheet_id: PMS,
    mail_subject: 'New ticket {{ticket_no}}', mail_body_html: `<p>${tag} Ticket {{ticket_no}}: {{subject}}</p>`,
  }).select('id').single()).data.id as string
  const cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} pms cat`, slug: `${tag}-pms-cat`, program_id: ids.program, is_pms: true }).select('id').single()).data.id as string
  ids.cat = cat
  ids.sub = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} pms sub`, slug: `${tag}-pms-sub` }).select('id').single()).data.id as string
  await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: ids.sub })
  await a.from('services').update({ form_fields: [{ id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }] }).eq('id', fx.teamA.serviceId)
  sheets[MAIN] = [['Store Code', 'Ticket Mail To'], [A, 'vendor-a@oem.test'], [B, 'vendor-b@oem.test']]
  sheets[PMS] = [['Store Code', 'PMS Date'], [A, today], [B, today], [A, yesterday], [A, threeDaysAgo]]
  await syncPrograms({ db: a, orgId: fx.orgId, source, force: true })
}, 300_000)

afterAll(async () => {
  const a = db()
  await a.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
  await a.from('app_settings').delete().like('key', `pms_alert:${fx.orgId}:%`)
  const all = [...made, ...(await tickets()).map((t) => t.id)]
  if (all.length) {
    await a.from('request_automation_state').delete().in('request_id', all)
    await a.from('request_program_snapshots').delete().in('request_id', all); await a.from('request_activity').delete().in('request_id', all)
    await a.from('request_comments').delete().in('request_id', all); await a.from('requests').delete().in('id', all)
  }
  await a.from('program_pms_log').delete().eq('program_id', ids.program)
  await a.from('service_sub_category_tags').delete().eq('sub_category_id', ids.sub)
  await a.from('service_sub_categories').delete().eq('id', ids.sub)
  await a.from('service_categories').delete().eq('id', ids.cat)
  await a.from('vendor_programs').delete().eq('id', ids.program)
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  await a.from('stores').delete().in('id', [ids.storeA, ids.storeB])
  await fx?.cleanup()
}, 180_000)

describe('a run that died half way (D-05)', () => {
  it('does not make a second ticket or a second mail: the ticket that exists is found and the log row is settled with it', async () => {
    const first = await createDueProgramPmsTickets(db(), fx.orgId, await program(), at(10, 30))
    expect(first.created).toBe(1)
    const a = (await logRows()).find((l) => l.store_code === A && l.pms_date === today)!
    expect(a.status).toBe('created'); made.push(a.request_id!)
    // the process died after the ticket existed but before the log row said so: the row is stuck on "creating"
    await db().from('program_pms_log').update({ status: 'creating', request_id: null, updated_at: new Date(Date.now() - 30 * 60_000).toISOString() }).eq('program_id', ids.program).eq('store_code', A).eq('pms_date', today)
    vi.mocked(sendEmail).mockClear()
    const again = await createDueProgramPmsTickets(db(), fx.orgId, await program(), at(15, 5))
    expect(again.created).toBe(0)
    expect(await tickets()).toHaveLength(1)                                           // still ONE ticket
    expect(vi.mocked(sendEmail).mock.calls.filter((c) => String((c[0] as { subject: string }).subject).startsWith('New ticket'))).toHaveLength(0)   // and no second mail
    const row = (await logRows()).find((l) => l.store_code === A && l.pms_date === today)!
    expect(row.status).toBe('created'); expect(row.request_id).toBe(a.request_id)
  })
})

describe('a date that could not be made stays visible (C-17)', () => {
  it('a failed or skipped date stays in the problem list after its day; a past date nobody tried is listed too; none of them is made', async () => {
    await db().from('program_pms_log').insert({ org_id: fx.orgId, program_id: ids.program, store_code: A, pms_date: yesterday, status: 'failed', note: 'The ticket could not be created.' })
    await createDueProgramPmsTickets(db(), fx.orgId, await program(), at(19, 5))
    const iss = (await issues()).filter((i) => i.code === 'pms_no_ticket')
    expect(iss.some((i) => i.store_code === A && /has passed/.test(i.message) && /could not be created/.test(i.message))).toBe(true)      // the failed yesterday
    expect(iss.some((i) => i.store_code === A && /nothing was recorded/.test(i.message))).toBe(true)                                        // three days ago: never even tried
    expect(iss.some((i) => i.store_code === B)).toBe(true)                                                                                   // today: no login
    expect((await logRows()).filter((l) => l.pms_date < today && l.status === 'created')).toEqual([])                                       // a past date is never made
  })
})

describe('the PMS tickets do not depend on Google (C-04)', () => {
  it('are made with no Google connection at all, and the administrators are told once a day about the dates that could not be made', async () => {
    await db().from('master_google_connection').delete().eq('org_id', fx.orgId)
    await db().from('program_pms_log').delete().eq('program_id', ids.program).eq('pms_date', today)
    vi.mocked(sendEmail).mockClear()
    const r1 = await makeDuePmsTicketsForOrg(db(), fx.orgId, at(11, 0))
    expect(r1.problems).toBeGreaterThan(0)                                              // store B has no login
    expect((await tickets()).length).toBe(1)                                            // store A's ticket exists although there is no Google connection
    const told = () => vi.mocked(sendEmail).mock.calls.filter((c) => /could not make some PMS tickets/.test(String((c[0] as { subject: string }).subject)))
    const n = told().length
    await makeDuePmsTicketsForOrg(db(), fx.orgId, at(15, 0))
    expect(told().length).toBe(n)                                                       // a second run the same day tells nobody again
  })
})
