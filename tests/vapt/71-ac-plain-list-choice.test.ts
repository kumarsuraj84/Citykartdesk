// Ticket CKSD-000713 (live, 2 Nov 2026): the AC form's "AC Serial Number" was a plain list of choices (not linked to the store's AC sheet), the requester chose "1", and the OEM mail listed
// EVERY AC of the store. On the isolated audit stack (mail goes nowhere): with such a form the AC chosen is read from the label of the option, and only that AC is mailed.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
// eslint-disable-next-line @typescript-eslint/no-unused-vars
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (_p: { to: string | string[]; cc?: string | string[]; subject: string; html: string; text?: string }) => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { createRequest } from '@/lib/actions/requests'
import { syncPrograms } from '@/lib/programs/sync'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t71${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const mails = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0]) as unknown as { to: string[]; cc?: string[]; subject: string; html: string }[]
const A = `${tag}a`.toUpperCase()
const ids = { storeA: '', program: '', cat: '', sub: '' }
const made: string[] = []
const SHEET = `${tag}-sheet-ac-0000000000`
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const HEAD = ['Store Code', 'AC CKDESK SERIAL NO', 'AC Serial No', 'AC Floor', 'AC Type', 'AC Tonnage', 'AC Brand', 'AC-AMC Vendor', 'AC-AMC Brand', 'Region', 'State', 'Cluster', 'Ticket Mail To']
const DETAILS = '{{machine_no}} - {{extra_acfloor}}, {{extra_actype}} {{extra_actonnage}} - {{extra_acbrand}} - serial {{serial}}'
// the form as it is on live: a plain list; the saved value is the OPTION ID, the number is its label
const PLAIN_AC = { id: 'acserial', type: 'select', label: 'AC Serial Number', required: false, order: 2, options: [{ value: 'opt_1', label: '1' }, { value: 'opt_2', label: '2' }, { value: 'opt_9', label: '9' }, { value: 'opt_srv', label: 'Server Room AC' }] }
const SUBJECT_FIELD = { id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }
const setStore = (storeId: string | null) => db().from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id)

async function raise(title: string, choice?: string) {
  actAs(fx.requesterA)
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', ids.sub)
  f.set('form_data', JSON.stringify({ subject: `${tag} ${title}`, ...(choice !== undefined ? { acserial: choice } : {}) }))
  const r = await createRequest(f)
  if (r.requestId) made.push(r.requestId)
  return r
}
const mailFor = (title: string) => mails().filter((m) => m.html.includes(`${tag} ${title}`))

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  ids.storeA = (await a.from('stores').insert({ org_id: fx.orgId, code: A, name: `${tag} A`, address: 'Old Bus Stand Road' }).select('id').single()).data.id
  ids.program = (await a.from('vendor_programs').insert({
    org_id: fx.orgId, name: 'AC', slug: `${tag}-ac`, is_active: true, level: 'mail', row_type: 'machine', spreadsheet_id: SHEET, details_template: DETAILS, columns: { vendor: 'AC-AMC Vendor' },
    mail_subject: 'New AC Issue Ticket - {{ticket_no}} - {{store_code}}',
    mail_body_html: '<p>Dear Team,</p><table><tbody><tr><th>Ticket No</th><td>{{ticket_no}}</td></tr><tr><th>AC Number</th><td>{{machine_no}}</td></tr><tr><th>AC Details</th><td>{{details}}</td></tr><tr><th>Issue</th><td>{{subject}}</td></tr></tbody></table>',
  }).select('id').single()).data.id
  ids.cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} cat`, slug: `${tag}-cat`, program_id: ids.program }).select('id').single()).data.id
  ids.sub = (await a.from('service_sub_categories').insert({ category_id: ids.cat, name: `${tag} sub`, slug: `${tag}-sub` }).select('id').single()).data.id
  await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: ids.sub })
  await a.from('services').update({ form_fields: [SUBJECT_FIELD, PLAIN_AC] }).eq('id', fx.teamA.serviceId)
  sheets[SHEET] = [HEAD,
    [A, '1', 'S-100', 'GF_Ground Floor', 'Split', '2 TR', 'DAIKIN', 'BLUESTAR', 'STAR COOLING', 'R5', 'UTTAR PRADESH', 'UP5', 'oem.one@bluestar.test'],
    [A, '2', 'S-200', 'FF_First Floor', 'Ductable', '5.5 TR', 'BLUESTAR', 'BLUESTAR', 'STAR COOLING', 'R5', 'UTTAR PRADESH', 'UP5', 'oem.two@bluestar.test'],
    [A, 'Server Room', 'S-300', 'SF_Second Floor', 'Split', '1 TR', 'VOLTAS', 'VOLTAS', 'STAR COOLING', 'R5', 'UTTAR PRADESH', 'UP5', 'oem.three@voltas.test'],
  ]
  await syncPrograms({ db: a, orgId: fx.orgId, source, force: true })
  await setStore(ids.storeA)
}, 300_000)

afterAll(async () => {
  const a = db()
  await setStore(null)
  if (made.length) {
    await a.from('request_program_snapshots').delete().in('request_id', made); await a.from('request_master_snapshots').delete().in('request_id', made)
    await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('service_sub_category_tags').delete().eq('sub_category_id', ids.sub)
  await a.from('service_sub_categories').delete().eq('id', ids.sub)
  await a.from('service_categories').delete().eq('id', ids.cat)
  await a.from('program_rows').delete().eq('program_id', ids.program)
  await a.from('vendor_programs').delete().eq('id', ids.program)
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  await a.from('stores').delete().eq('id', ids.storeA)
  await fx?.cleanup()
}, 180_000)

describe('an AC form with a plain list of choices (not linked to the AC sheet)', () => {
  it('the AC the requester chose is the only AC mailed, and only its OEM is written to', async () => {
    const r = await raise('chose two', 'opt_2')
    expect(r.error).toBeUndefined()
    const [m] = mailFor('chose two')
    expect(m, 'the OEM was mailed').toBeTruthy()
    expect(m.to).toEqual(['oem.two@bluestar.test'])
    expect(m.html).toContain('serial S-200')
    for (const other of ['S-100', 'S-300', 'oem.one', 'oem.three']) expect(m.html + m.to.join()).not.toContain(other)
    const snap = (await db().from('request_program_snapshots').select('snapshot').eq('request_id', r.requestId!).single()).data.snapshot
    expect(snap).toHaveLength(1)                                                 // only the chosen AC is kept with the ticket
  })

  it('"Server Room AC" of the list is the machine "Server Room" of the sheet', async () => {
    const r = await raise('chose server room', 'opt_srv')
    const [m] = mailFor('chose server room')
    expect(m.to).toEqual(['oem.three@voltas.test'])
    expect(m.html).toContain('serial S-300')
    expect(m.html).not.toContain('S-100')
    expect((await db().from('request_program_snapshots').select('snapshot').eq('request_id', r.requestId!).single()).data.snapshot).toHaveLength(1)
  })

  it('a number the store does not have (9): the ticket is still made and every AC of the store is mailed, as before', async () => {
    const r = await raise('chose nine', 'opt_9')
    expect(r.error).toBeUndefined()
    const [m] = mailFor('chose nine')
    expect([...m.to].sort()).toEqual(['oem.one@bluestar.test', 'oem.three@voltas.test', 'oem.two@bluestar.test'])
    for (const s of ['S-100', 'S-200', 'S-300']) expect(m.html).toContain(s)
  })

  it('no AC chosen: every AC of the store is mailed, as before', async () => {
    await raise('chose none')
    const [m] = mailFor('chose none')
    for (const s of ['S-100', 'S-200', 'S-300']) expect(m.html).toContain(s)
  })
})
