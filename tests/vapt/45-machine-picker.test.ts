// The machine list of a Vendor Program with one row per machine (what AC needs), on the isolated audit stack (mail goes nowhere):
//  - the form gets, for a category of the program, the store's machines (none for a store without any; nothing for a category that is not in the program);
//  - the machine chosen must be one of the store's active machines, and is compulsory when the store has some (checked on the server);
//  - the mail names ONLY the chosen machine and goes to ITS addresses (when it has none, to the store's other machines'); the ticket keeps only that row;
//  - a reopened ticket goes back to the same machine, even if the sheet has changed meanwhile.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (_p: { to: string | string[]; cc?: string | string[]; subject: string; html: string; text?: string }) => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { createRequest, updateRequestStatus } from '@/lib/actions/requests'
import { syncPrograms } from '@/lib/programs/sync'
import { loadMachineOptionsForStore } from '@/lib/programs/machines'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t45${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const mails = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0]) as unknown as { to: string[]; cc?: string[]; subject: string; html: string }[]
const code = (s: string) => `${tag}${s}`.toUpperCase()
const A = code('a'), B = code('b'), C = code('c')
const ids = { storeA: '', storeB: '', storeC: '', program: '', cat: '', otherCat: '', sub: '', otherSub: '' }
const made: string[] = []
const SHEET = `${tag}-sheet-machines-000`
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const HEAD = ['Store Code', 'AC CKDESK SERIAL NO', 'AC Serial No', 'AC Floor', 'AC Brand', 'Ticket Mail To']
const DETAILS = '{{machine_no}} - {{extra_acfloor}} - {{extra_acbrand}} - serial {{serial}}'
const sync = () => syncPrograms({ db: db(), orgId: fx.orgId, source, force: true })
const setStore = (storeId: string | null) => db().from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id)

async function raise(title: string, machine?: string, sub = ids.sub) {
  actAs(fx.requesterA)
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', sub)
  f.set('form_data', JSON.stringify({ subject: `${tag} ${title}`, ...(machine !== undefined ? { machine } : {}) }))
  const r = await createRequest(f)
  if (r.requestId) made.push(r.requestId)
  return r
}
const row = async (id: string) => (await db().from('requests').select('status').eq('id', id).single()).data as { status: string }
const mailsFor = (title: string) => mails().filter((m) => m.html.includes(`${tag} ${title}`))

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  const mkStore = async (c: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: c, name: `${tag} ${c}`, address: 'Old Bus Stand Road' }).select('id').single()).data.id as string
  ids.storeA = await mkStore(A); ids.storeB = await mkStore(B); ids.storeC = await mkStore(C)
  ids.program = (await a.from('vendor_programs').insert({
    org_id: fx.orgId, name: 'AC', slug: `${tag}-ac`, is_active: true, level: 'mail', row_type: 'machine', spreadsheet_id: SHEET, details_template: DETAILS,
    mail_subject: 'New AC Ticket - {{ticket_no}} - {{store_code}}',
    mail_body_html: '<p>Dear Team,</p><table><tbody><tr><th>Ticket No</th><td>{{ticket_no}}</td></tr><tr><th>AC Details</th><td>{{details}}</td></tr><tr><th>Issue</th><td>{{subject}}</td></tr></tbody></table>',
  }).select('id').single()).data.id
  const mkCat = async (n: string, extra: Record<string, unknown>) => {
    const cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ${n}`, slug: `${tag}-${n}-cat`, ...extra }).select('id').single()).data.id as string
    const sub = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} ${n}-sub`, slug: `${tag}-${n}-sub` }).select('id').single()).data.id as string
    await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: sub })
    return { cat, sub }
  }
  const p = await mkCat('prog', { program_id: ids.program }); ids.cat = p.cat; ids.sub = p.sub
  const o = await mkCat('other', {}); ids.otherCat = o.cat; ids.otherSub = o.sub
  await a.from('services').update({ form_fields: [
    { id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 },
    { id: 'machine', type: 'select', label: 'Machine', required: false, order: 2, options_source: 'program_machines', options: [] },
  ] }).eq('id', fx.teamA.serviceId)
  sheets[SHEET] = [HEAD,
    [A, '1', 'S-100', 'GF', 'DAIKIN', 'a1@oem.test, desk@citykartstores.com'],
    [A, '2', 'S-200', 'FF', 'VOLTAS', 'a2@oem.test'],
    [B, '3', 'S-300', 'GF', 'LG', ''],                  // this machine has no address
    [B, '4', 'S-400', 'FF', 'LG', 'b4@oem.test'],
  ]
  await sync()
}, 300_000)

afterAll(async () => {
  const a = db()
  await setStore(null)
  if (made.length) { await a.from('request_program_snapshots').delete().in('request_id', made); await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made) }
  const subs = [ids.sub, ids.otherSub].filter(Boolean)
  await a.from('service_sub_category_tags').delete().in('sub_category_id', subs)
  await a.from('service_sub_categories').delete().in('id', subs)
  await a.from('service_categories').delete().in('id', [ids.cat, ids.otherCat].filter(Boolean))
  await a.from('vendor_programs').delete().eq('id', ids.program)
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  await a.from('stores').delete().in('id', [ids.storeA, ids.storeB, ids.storeC].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

describe('the machine list for the ticket form', () => {
  it('lists the store\'s machines for a category of the program, none for a store without any, and nothing for another category', async () => {
    const a = await loadMachineOptionsForStore(db(), fx.orgId, A)
    expect(a[ids.cat].map((o) => o.value)).toEqual(['1', '2'])
    expect(a[ids.cat].map((o) => o.label)).toEqual(['1', '2'])              // ONLY the machine number: no floor, brand or serial for the requester
    expect((await loadMachineOptionsForStore(db(), fx.orgId, C))[ids.cat]).toEqual([])
    expect(a[ids.otherCat]).toBeUndefined()                                  // not a category of the program: the form hides the box
  })
})

describe('the machine chosen by the requester', () => {
  it('the mail names ONLY the chosen machine and goes to ITS addresses; the ticket keeps only that row', async () => {
    await setStore(ids.storeA)
    const r = await raise('pick two', '2')
    expect((await row(r.requestId!)).status).toBe('in_progress')
    const [m] = mailsFor('pick two')
    expect(m.to).toEqual(['a2@oem.test']); expect(m.cc ?? []).toEqual([])
    expect(m.html).toContain('2 - FF - VOLTAS - serial S-200')
    expect(m.html).not.toContain('S-100')                                    // machine 1 is not mentioned
    const snap = (await db().from('request_program_snapshots').select('snapshot').eq('request_id', r.requestId!).single()).data.snapshot as { machine_no: string }[]
    expect(snap.map((x) => x.machine_no)).toEqual(['2'])
    const first = await raise('pick one', 'daikin-not-a-machine')
    expect(first.error).toMatch(/not an active machine/)                    // checked on the server
    const r1 = await raise('pick one ok', '1')
    expect(mailsFor('pick one ok')[0].to).toEqual(['a1@oem.test']); expect(mailsFor('pick one ok')[0].cc).toEqual(['desk@citykartstores.com'])
    expect(r1.requestId).toBeTruthy()
  })

  it('is compulsory when the store has machines; a machine with no address uses the store\'s other machines\' addresses; a store with none is not asked', async () => {
    await setStore(ids.storeA)
    expect((await raise('no choice')).error).toMatch(/choose the machine/i)
    await setStore(ids.storeB)
    await raise('no address', '3')
    expect(mailsFor('no address')[0].to).toEqual(['b4@oem.test'])            // machine 3 has no address: the other machine's are used
    expect(mailsFor('no address')[0].html).toContain('3 - GF - LG - serial S-300')
    await setStore(ids.storeC)
    const none = await raise('store without machine')
    expect(none.error).toBeUndefined()                                       // nothing to choose: not asked
    expect((await row(none.requestId!)).status).toBe('open')                 // and the usual note (store not in the sheet), as before
  })

  it('a category that is not in the program has no machine rule; a reopened ticket goes back to the SAME machine even if the sheet changed', async () => {
    await setStore(ids.storeA)
    const other = await raise('other category', undefined, ids.otherSub)
    expect(other.error).toBeUndefined()
    const r = await raise('reopen machine', '2')
    sheets[SHEET] = [HEAD, [A, '1', 'S-100', 'GF', 'DAIKIN', 'a1@oem.test'], [A, '2', 'S-200', 'FF', 'VOLTAS', 'changed@oem.test']]
    await sync()
    await db().from('requests').update({ status: 'resolved', resolved_at: new Date().toISOString(), reopen_deadline_at: new Date(Date.now() + 3_600_000).toISOString() }).eq('id', r.requestId!)
    vi.mocked(sendEmail).mockClear()
    actAs(fx.requesterA)
    expect((await updateRequestStatus(r.requestId!, 'open', 'Still not cooling')).error).toBeUndefined()
    const sent = mails().filter((m) => /REOPENED/.test(m.subject))
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toEqual(['a2@oem.test'])                              // the machine and the address of the first time
    expect(sent[0].html).toContain('S-200'); expect(sent[0].html).not.toContain('S-100')
  })
})
