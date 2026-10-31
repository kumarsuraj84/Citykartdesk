// Genset on the Vendor Program mechanism, side by side with the old Genset setting, on the isolated audit stack (mail goes nowhere):
//  - the SAME genset rows give the SAME mail through both ways: the same recipients (the OEM in To, company people in CC), every genset of the store written the same way,
//    the same note in the conversation, the ticket In Progress;
//  - categories move from the old setting to the program in ONE step that also switches the program on (never a category without its mail), only when the program is ready,
//    and they can be moved back from the built-in Genset screen.
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
import { createRequest } from '@/lib/actions/requests'
import { syncPrograms } from '@/lib/programs/sync'
import { moveCategoriesToProgram, saveBuiltInCategories } from '@/lib/actions/admin/programs'
import { parseOemComment } from '@/lib/masters/comment-view'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t44${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const mails = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0]) as unknown as { to: string[]; cc?: string[]; subject: string; html: string }[]
const code = (s: string) => `${tag}${s}`.toUpperCase()
const A = code('a'), B = code('b')                 // A has two gensets, B has one
const ids = { storeA: '', storeB: '', program: '', catOld: '', catNew: '', catMove: '', subOld: '', subNew: '', subMove: '' }
const made: string[] = []
const SHEET = `${tag}-sheet-genset-00000`
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const EMAILS_A = ['oem.one@powerco.test', 'oem.two@powerco.test', 'desk.lead@citykartstores.com']
const EMAILS_B = ['svc@gensetindia.test', 'raushan.kumar@citykartstores.com']
const HEAD = ['Store Code', 'Genset Brand', 'Genset KVA', 'Genset Serial No', 'CPCB Group', 'Ticket Mail To']
const DETAILS = '{{extra_gensetbrand}} {{extra_gensetkva}} KVA, serial {{serial}}, {{extra_cpcbgroup}}'
const LINE_A1 = 'MAHINDRA 125 KVA, serial NDJZB11872, CPCB-II'
const LINE_A2 = 'CUMMINS 160 KVA, serial CJGS19093340, CPCB-IV'
const LINE_B1 = 'EICHER 40 KVA, serial E412CDPG442953G, CPCB-II'
const setStore = (storeId: string | null) => db().from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id)

async function raise(sub: string, title: string) {
  actAs(fx.requesterA)
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', sub)
  f.set('form_data', JSON.stringify({ subject: `${tag} ${title}` }))
  const r = await createRequest(f)
  if (r.requestId) made.push(r.requestId)
  return r
}
async function ticket(id: string) {
  const t = (await db().from('requests').select('id, status').eq('id', id).single()).data as { id: string; status: string }
  const comments = ((await db().from('request_comments').select('body, is_internal').eq('request_id', id)).data ?? []) as { body: string; is_internal: boolean }[]
  return { ...t, comments }
}
const mailsFor = (title: string) => mails().filter((m) => m.html.includes(`${tag} ${title}`))

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  const mkStore = async (c: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: c, name: `${tag} ${c}`, address: 'Old Bus Stand Road' }).select('id').single()).data.id as string
  ids.storeA = await mkStore(A); ids.storeB = await mkStore(B)
  // the OLD setting: the genset rows in the master table, the category sends to the Genset OEM
  await a.from('master_gensets').insert([
    { org_id: fx.orgId, store_code: A, brand: 'MAHINDRA', kva: '125', serial: 'NDJZB11872', cpcb_group: 'CPCB-II', emails: EMAILS_A, sheet_row: 2 },
    { org_id: fx.orgId, store_code: A, brand: 'CUMMINS', kva: '160', serial: 'CJGS19093340', cpcb_group: 'CPCB-IV', emails: EMAILS_A, sheet_row: 3 },
    { org_id: fx.orgId, store_code: B, brand: 'EICHER', kva: '40', serial: 'E412CDPG442953G', cpcb_group: 'CPCB-II', emails: EMAILS_B, sheet_row: 4 },
  ])
  // the NEW way: a program "Genset" on the same rows (the same sheet shape, read by the program engine)
  ids.program = (await a.from('vendor_programs').insert({
    org_id: fx.orgId, name: 'Genset', slug: `${tag}-genset`, is_active: false, level: 'mail', row_type: 'store', spreadsheet_id: SHEET, details_template: DETAILS,
    mail_subject: 'New Genset Issue Ticket - {{ticket_no}} - {{store_code}}',
    mail_body_html: '<p>Dear Team,</p><table><tbody><tr><th>Ticket No</th><td>{{ticket_no}}</td></tr><tr><th>Store Code</th><td>{{store_code}}</td></tr><tr><th>Genset Details</th><td>{{details}}</td></tr><tr><th>Issue</th><td>{{subject}}</td></tr></tbody></table>',
  }).select('id').single()).data.id
  const mkCat = async (n: string, extra: Record<string, unknown>) => {
    const cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ${n}`, slug: `${tag}-${n}-cat`, ...extra }).select('id').single()).data.id as string
    const sub = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} ${n}-sub`, slug: `${tag}-${n}-sub` }).select('id').single()).data.id as string
    await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: sub })
    return { cat, sub }
  }
  const old = await mkCat('old', { auto_oem_kind: 'genset' }); ids.catOld = old.cat; ids.subOld = old.sub
  const nw = await mkCat('new', { program_id: ids.program }); ids.catNew = nw.cat; ids.subNew = nw.sub
  const mv = await mkCat('move', { auto_oem_kind: 'genset' }); ids.catMove = mv.cat; ids.subMove = mv.sub
  await a.from('services').update({ form_fields: [{ id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }] }).eq('id', fx.teamA.serviceId)
  sheets[SHEET] = [HEAD,
    [A, 'MAHINDRA', 125, 'NDJZB11872', 'CPCB-II', EMAILS_A.join(', ')],
    [A, 'CUMMINS', 160, 'CJGS19093340', 'CPCB-IV', EMAILS_A.join(', ')],
    [B, 'EICHER', 40, 'E412CDPG442953G', 'CPCB-II', EMAILS_B.join(', ')],
  ]
  await syncPrograms({ db: a, orgId: fx.orgId, source, force: true })
}, 300_000)

afterAll(async () => {
  const a = db()
  await setStore(null)
  if (made.length) { await a.from('request_program_snapshots').delete().in('request_id', made); await a.from('request_master_snapshots').delete().in('request_id', made); await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made) }
  const subs = [ids.subOld, ids.subNew, ids.subMove].filter(Boolean)
  await a.from('service_sub_category_tags').delete().in('sub_category_id', subs)
  await a.from('service_sub_categories').delete().in('id', subs)
  await a.from('service_categories').delete().in('id', [ids.catOld, ids.catNew, ids.catMove].filter(Boolean))
  await a.from('vendor_programs').delete().eq('id', ids.program)
  await a.from('master_gensets').delete().eq('org_id', fx.orgId).in('store_code', [A, B])
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  await a.from('stores').delete().in('id', [ids.storeA, ids.storeB].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

describe('the same genset rows give the same mail through the old setting and through the program', () => {
  it('a store with two gensets: the same recipients, both gensets written the same way, the same note, In Progress', async () => {
    await a_on()
    await setStore(ids.storeA)
    const oldT = await raise(ids.subOld, 'old way A')
    const newT = await raise(ids.subNew, 'new way A')
    const [mo] = mailsFor('old way A'), [mn] = mailsFor('new way A')
    expect(mo, 'the old way mails').toBeTruthy(); expect(mn, 'the program mails').toBeTruthy()
    expect([...mn.to].sort()).toEqual([...mo.to].sort())                  // the OEM addresses in To
    expect([...(mn.cc ?? [])].sort()).toEqual([...(mo.cc ?? [])].sort())  // the company people in CC
    expect(mo.to).toEqual(['oem.one@powerco.test', 'oem.two@powerco.test']); expect(mo.cc).toEqual(['desk.lead@citykartstores.com'])
    for (const m of [mo, mn]) { expect(m.html).toContain(LINE_A1); expect(m.html).toContain(LINE_A2) }
    const [to, tn] = [await ticket(oldT.requestId!), await ticket(newT.requestId!)]
    expect(to.status).toBe('in_progress'); expect(tn.status).toBe('in_progress')
    const heading = (t: { comments: { body: string }[] }) => t.comments.map((c) => parseOemComment(c.body)).find(Boolean)?.heading
    expect(heading(tn)).toBe('Ticket sent to the Genset OEM for servicing.')
    expect(heading(tn)).toBe(heading(to))                                 // the same note in the conversation
  })

  it('a store with one genset, and a store that is not in the sheet (stays Open with a note, in both ways)', async () => {
    await setStore(ids.storeB)
    await raise(ids.subOld, 'old way B'); await raise(ids.subNew, 'new way B')
    const [mo] = mailsFor('old way B'), [mn] = mailsFor('new way B')
    expect(mn.to).toEqual(mo.to); expect(mn.cc).toEqual(mo.cc)
    expect(mo.html).toContain(LINE_B1); expect(mn.html).toContain(LINE_B1)
    await setStore(null)
    const orphan = await db().from('stores').insert({ org_id: fx.orgId, code: code('c'), name: `${tag} none`, address: 'x' }).select('id').single()
    try {
      await setStore(orphan.data.id)
      const [o, n] = [await raise(ids.subOld, 'old none'), await raise(ids.subNew, 'new none')]
      for (const r of [o, n]) { const t = await ticket(r.requestId!); expect(t.status).toBe('open'); expect(t.comments.some((c) => c.is_internal && /Genset/.test(c.body))).toBe(true) }
    } finally { await setStore(null); await db().from('stores').delete().eq('id', orphan.data.id) }
  })
})

// the program is switched on by the move itself; before that it must be ready (sheet read, rows, mail wording) - checked by the move
async function a_on() { await db().from('vendor_programs').update({ is_active: true }).eq('id', ids.program) }

describe('moving categories from the old setting to the program, and back', () => {
  it('is refused while the program is not ready, then moves in ONE step and switches the program on; new tickets use the program', async () => {
    await db().from('vendor_programs').update({ is_active: false, last_status: null }).eq('id', ids.program)
    actAs(fx.admin)
    const notReady = await moveCategoriesToProgram(ids.program, [ids.catMove])
    expect(notReady.error).toMatch(/Not ready/)
    expect((await db().from('service_categories').select('auto_oem_kind, program_id').eq('id', ids.catMove).single()).data).toEqual({ auto_oem_kind: 'genset', program_id: null })   // nothing moved
    await syncPrograms({ db: db(), orgId: fx.orgId, source, force: true })
    expect((await moveCategoriesToProgram(ids.program, [])).error).toBeTruthy()
    expect((await moveCategoriesToProgram(ids.program, [ids.catNew])).error).toMatch(/nothing to move|cannot be moved/)   // a category that is already in the program
    expect((await moveCategoriesToProgram(ids.program, [ids.catMove])).error).toBeUndefined()
    expect((await db().from('service_categories').select('auto_oem_kind, program_id').eq('id', ids.catMove).single()).data).toEqual({ auto_oem_kind: null, program_id: ids.program })
    expect((await db().from('vendor_programs').select('is_active').eq('id', ids.program).single()).data.is_active).toBe(true)
    await setStore(ids.storeA)
    const r = await raise(ids.subMove, 'moved')
    expect((await ticket(r.requestId!)).status).toBe('in_progress')
    expect(mailsFor('moved')[0].html).toContain(LINE_A2)
    expect((await db().from('request_program_snapshots').select('program_id').eq('request_id', r.requestId!).single()).data.program_id).toBe(ids.program)
  })

  it('cannot be moved back to the retired old Genset setting (neither from the built-in Genset screen nor from Admin > Categories); new tickets keep using the program', async () => {
    actAs(fx.admin)
    const back = await saveBuiltInCategories('genset', [ids.catOld, ids.catMove])
    expect(back.error).toMatch(/retired/)
    expect((await db().from('service_categories').select('auto_oem_kind, program_id').eq('id', ids.catMove).single()).data).toEqual({ auto_oem_kind: null, program_id: ids.program })
    const { setCategoryOemKind } = await import('@/lib/actions/admin/categories')
    expect((await setCategoryOemKind(ids.catMove, 'genset')).error).toMatch(/retired|Vendor Program/)
    await setStore(ids.storeA)
    const r = await raise(ids.subMove, 'still the program')
    expect((await ticket(r.requestId!)).status).toBe('in_progress')
    expect((await db().from('request_program_snapshots').select('program_id').eq('request_id', r.requestId!).single()).data.program_id).toBe(ids.program)
  })
})
