// PMS (preventive maintenance) tickets of a Vendor Program, on the isolated audit stack (mail goes nowhere). The PMS sheet is OPTIONAL per program:
//  - the PMS sheet (Store Code + PMS Date) is copied; a date CK Desk cannot read and an unknown store are reported, the rest is kept;
//  - from 09:00 India time on the PMS date ONE ticket is made for the store (never before, never for a past or future date), in the program's PMS category, mailed ONCE to the
//    program's vendor, and a second run makes no second ticket and no second mail; a store with no login is reported and tried again, not lost;
//  - a program with no PMS sheet, or switched off, does nothing at all; removing the PMS sheet removes its dates and problems and nothing else;
//  - the main sheet copy never wipes the PMS problems, and the old built-in AC PMS does not pick a program's PMS category.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { syncPrograms } from '@/lib/programs/sync'
import { createDueProgramPmsTickets } from '@/lib/programs/pms'
import { findPmsSetup } from '@/lib/pms/tickets'
import { istNow, addDays } from '@/lib/pms/window'
import { saveProgramPmsSheet } from '@/lib/actions/admin/programs'
import type { SheetsSource } from '@/lib/masters/google'
import type { ProgramRecord } from '@/lib/programs/types'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t48${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const code = (s: string) => `${tag}${s}`.toUpperCase()
const A = code('a'), B = code('b'), GHOST = code('z')
const ids = { storeA: '', storeB: '', program: '', other: '', cat: '', sub: '' }
const made: string[] = []
const MAIN = `${tag}-main-sheet-00000`, PMS = `${tag}-pms-sheet-000000`
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const today = istNow(new Date()).date
const yesterday = addDays(today, -1), tomorrow = addDays(today, 1)
const at = (hh: number, mm: number) => new Date(`${today}T00:00:00+05:30`.replace('T00:00', `T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`))
const program = async () => (await db().from('vendor_programs').select('*').eq('id', ids.program).single()).data as ProgramRecord
const logRows = async () => ((await db().from('program_pms_log').select('store_code, status, request_id, note').eq('program_id', ids.program)).data ?? []) as { store_code: string; status: string; request_id: string | null; note: string | null }[]
const issues = async () => ((await db().from('program_issues').select('code, store_code, message').eq('program_id', ids.program)).data ?? []) as { code: string; store_code: string | null; message: string }[]
const pmsMails = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0] as unknown as { to: string[]; subject: string; html: string }).filter((m) => m.subject.startsWith('New ticket') && m.html.includes(`${tag}`))

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  const mkStore = async (c: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: c, name: `${tag} ${c}`, address: 'Main Road' }).select('id').single()).data.id as string
  ids.storeA = await mkStore(A); ids.storeB = await mkStore(B)
  await a.from('profiles').update({ store_id: ids.storeA }).eq('id', fx.requesterA.id)      // store A has a login; store B has none
  const mkProgram = async (name: string, extra: Record<string, unknown>) => (await a.from('vendor_programs').insert({
    org_id: fx.orgId, name, slug: `${tag}-${name.replace(/\W/g, '').toLowerCase()}`, level: 'mail', row_type: 'store', is_active: true,
    mail_subject: 'New ticket {{ticket_no}}', mail_body_html: `<p>${tag} Ticket {{ticket_no}}: {{subject}}</p>`, ...extra,
  }).select('id').single()).data.id as string
  ids.program = await mkProgram('Pms program', { spreadsheet_id: MAIN, pms_spreadsheet_id: PMS })
  ids.other = await mkProgram('No pms program', { spreadsheet_id: `${tag}-other-sheet-0000` })   // a program WITHOUT a PMS sheet
  const cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} pms cat`, slug: `${tag}-pms-cat`, program_id: ids.program, is_pms: true }).select('id').single()).data.id as string
  ids.cat = cat
  ids.sub = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} pms sub`, slug: `${tag}-pms-sub` }).select('id').single()).data.id as string
  await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: ids.sub })
  await a.from('services').update({ form_fields: [{ id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }, { id: 'details', type: 'textarea', label: 'Description', required: false, order: 2 }] }).eq('id', fx.teamA.serviceId)
  sheets[MAIN] = [['Store Code', 'Ticket Mail To'], [A, 'vendor-a@oem.test'], [B, 'vendor-b@oem.test']]
  sheets[PMS] = [['Store Code', 'PMS Date'],
    [A, today], [B, today], [A, yesterday], [A, tomorrow], [GHOST, today], [B, 'not a date'],
  ]
  sheets[`${tag}-other-sheet-0000`] = [['Store Code', 'Ticket Mail To'], [A, 'other@oem.test']]
}, 300_000)

afterAll(async () => {
  const a = db()
  await a.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
  if (made.length) {
    await a.from('request_automation_state').delete().in('request_id', made)
    await a.from('request_program_snapshots').delete().in('request_id', made); await a.from('request_activity').delete().in('request_id', made)
    await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('program_pms_log').delete().eq('program_id', ids.program)
  await a.from('service_sub_category_tags').delete().eq('sub_category_id', ids.sub)
  await a.from('service_sub_categories').delete().eq('id', ids.sub)
  await a.from('service_categories').delete().eq('id', ids.cat)
  await a.from('vendor_programs').delete().in('id', [ids.program, ids.other])
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  await a.from('stores').delete().in('id', [ids.storeA, ids.storeB])
  await fx?.cleanup()
}, 180_000)

describe('copying the PMS sheet', () => {
  it('copies the dates, reports a date it cannot read and an unknown store, and only for the program that has a PMS sheet', async () => {
    const report = await syncPrograms({ db: db(), orgId: fx.orgId, source, force: true })
    const mine = report.find((r) => r.programId === ids.program)!
    expect(mine.pms?.status).toBe('ok'); expect(mine.pms?.rows).toBe(5)
    expect(report.find((r) => r.programId === ids.other)!.pms).toBeUndefined()      // no PMS sheet: nothing is read, nothing reported
    const dates = ((await db().from('program_pms_dates').select('store_code, pms_date').eq('program_id', ids.program)).data ?? []) as { store_code: string; pms_date: string }[]
    expect(dates).toHaveLength(5)
    expect((await db().from('program_pms_dates').select('store_code').eq('program_id', ids.other)).data).toEqual([])
    const iss = await issues()
    expect(iss.some((i) => i.code === 'pms_bad_date')).toBe(true)
    expect(iss.some((i) => i.code === 'pms_unknown_store' && i.store_code === GHOST)).toBe(true)
    // the main sheet copy does not wipe them
    await syncPrograms({ db: db(), orgId: fx.orgId, source, force: true, programId: ids.program })
    expect((await issues()).some((i) => i.code === 'pms_bad_date')).toBe(true)
  })
})

describe('making the PMS tickets', () => {
  it('nothing before 09:00; at 09:00 or later ONE ticket for the store of today, mailed once to the vendor; a store with no login is reported', async () => {
    const early = await createDueProgramPmsTickets(db(), fx.orgId, await program(), at(7, 30))
    expect(early.created).toBe(0)
    expect(await logRows()).toEqual([])

    vi.mocked(sendEmail).mockClear()
    const run = await createDueProgramPmsTickets(db(), fx.orgId, await program(), at(10, 30))
    expect(run.created).toBe(1); expect(run.skipped).toBe(2)                          // store A made; store B has no login and the ghost store is not in the store master; yesterday / tomorrow are not made
    const log = await logRows()
    const a = log.find((l) => l.store_code === A)!, b = log.find((l) => l.store_code === B)!
    expect(a.status).toBe('created'); expect(b.status).toBe('skipped'); expect(b.note).toMatch(/no active login/i)
    expect(log).toHaveLength(3)
    expect(log.find((l) => l.store_code === GHOST)?.status).toBe('skipped')
    made.push(a.request_id!)
    const t = (await db().from('requests').select('title, status, category_id, requester_id').eq('id', a.request_id!).single()).data
    expect(t.title).toContain('Pms program PMS'); expect(t.category_id).toBe(ids.cat); expect(t.requester_id).toBe(fx.requesterA.id)
    expect(t.status).toBe('in_progress')                                              // mailed to the vendor, like any ticket of the program
    const mails = pmsMails()
    expect(mails).toHaveLength(1); expect(mails[0].to).toEqual(['vendor-a@oem.test'])
    expect((await issues()).some((i) => i.code === 'pms_no_ticket' && i.store_code === B)).toBe(true)
  })

  it('a second run makes no second ticket and no second mail; the store with no login is tried again and still reported', async () => {
    vi.mocked(sendEmail).mockClear()
    const run = await createDueProgramPmsTickets(db(), fx.orgId, await program(), at(15, 5))
    expect(run.created).toBe(0); expect(run.alreadyDone).toBeGreaterThanOrEqual(1)
    expect(pmsMails()).toHaveLength(0)
    expect((await db().from('requests').select('id').eq('category_id', ids.cat)).data).toHaveLength(1)
    // a login appears for store B: the same date is made at the next run
    const extra = (await (await import('../setup/fixtures-d03')).createTestUser('pms-b-login', 'PMS B Login'))
    await db().from('profiles').update({ store_id: ids.storeB }).eq('id', extra.id)
    const later = await createDueProgramPmsTickets(db(), fx.orgId, await program(), at(15, 20))
    expect(later.created).toBe(1)
    const bRow = (await logRows()).find((l) => l.store_code === B)!
    expect(bRow.status).toBe('created'); made.push(bRow.request_id!)
    expect((await issues()).some((i) => i.code === 'pms_no_ticket' && i.store_code === B)).toBe(false)      // B is made now; the ghost store stays reported
    await db().from('profiles').update({ store_id: null }).eq('id', extra.id)
  })
})

describe('programs without PMS, and the old AC PMS', () => {
  it('a program with no PMS sheet, or switched off, does nothing', async () => {
    const other = (await db().from('vendor_programs').select('*').eq('id', ids.other).single()).data as ProgramRecord
    expect((await createDueProgramPmsTickets(db(), fx.orgId, other, at(10, 30))).created).toBe(0)
    await db().from('vendor_programs').update({ is_active: false }).eq('id', ids.program)
    await db().from('program_pms_log').delete().eq('program_id', ids.program)
    expect((await createDueProgramPmsTickets(db(), fx.orgId, await program(), at(10, 30))).created).toBe(0)
    expect(await logRows()).toEqual([])
    await db().from('vendor_programs').update({ is_active: true }).eq('id', ids.program)
  })

  it('the old built-in AC PMS does not pick a program\'s PMS category', async () => {
    const old = await findPmsSetup(db(), fx.orgId, null)
    if ('setup' in old) expect(old.setup.categoryId).not.toBe(ids.cat)
    const mine = await findPmsSetup(db(), fx.orgId, ids.program)
    expect('setup' in mine && mine.setup.categoryId).toBe(ids.cat)
  })

  it('removing the PMS sheet (administrator) removes its dates and problems and nothing else', async () => {
    vi.mocked(createClient).mockResolvedValue(clientForToken(fx.admin.accessToken) as never)
    await db().from('profiles').update({ org_id: fx.orgId }).eq('id', fx.admin.id)
    expect((await saveProgramPmsSheet(ids.program, '', '')).error).toBeUndefined()
    expect((await db().from('program_pms_dates').select('store_code').eq('program_id', ids.program)).data).toEqual([])
    expect((await issues()).filter((i) => i.code.startsWith('pms_'))).toEqual([])
    expect((await program()).pms_spreadsheet_id).toBeNull()
    expect((await db().from('program_rows').select('id').eq('program_id', ids.program)).data!.length).toBeGreaterThan(0)    // the main sheet copy is untouched
  })
})
