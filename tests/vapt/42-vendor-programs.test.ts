// Vendor Programs on the isolated audit stack (the sheet is replaced by fixed rows; mail goes nowhere):
//  - a program's sheet is copied into the database (rows, problems); a broken sheet is not applied and the last good copy stays;
//  - a ticket in a category of an ACTIVE program is mailed once to the store's vendor addresses (vendor in To, company people in CC), with the program's own words and the
//    sheet's extra columns, leaves the note "Ticket sent to the <program> OEM for servicing." and goes to In Progress; the rows it was mailed for are saved with the ticket;
//  - nothing to mail (store not in the sheet, no address) leaves the ticket Open with an internal note; a switched-off program does nothing at all;
//  - level "portal" mails but keeps the ticket Open; a reopened ticket is mailed again, marked REOPENED;
//  - the program data cannot be read by a signed-in user, and a category cannot be in a program and have an AC / Genset OEM type.
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
import { parseOemComment } from '@/lib/masters/comment-view'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
const mails = () => vi.mocked(sendEmail).mock.calls as unknown as [{ to: string[]; cc?: string[]; subject: string; html: string }][]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t42${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const code = (s: string) => `${tag}${s}`.toUpperCase()
const A = code('a'), B = code('b'), C = code('c')
const ids = { storeA: '', storeB: '', storeC: '', program: '', cat: '', sub: '' }
const made: string[] = []
const SHEET = `${tag}-sheet-ro-000000000`
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const sync = (force = true) => syncPrograms({ db: db(), orgId: fx.orgId, source, force })
const HEAD = ['Store Code', 'Mail To', 'Vendor', 'Brand Name']
const setStore = (storeId: string | null) => db().from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id)
const setProgram = (patch: Record<string, unknown>) => db().from('vendor_programs').update(patch).eq('id', ids.program)

async function raise(title: string) {
  actAs(fx.requesterA)
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', ids.sub)
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

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  const mkStore = async (c: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: c, name: `${tag} ${c}`, address: 'Old Bus Stand Road' }).select('id').single()).data.id as string
  ids.storeA = await mkStore(A); ids.storeB = await mkStore(B); ids.storeC = await mkStore(C)
  ids.program = (await a.from('vendor_programs').insert({
    org_id: fx.orgId, name: `${tag} RO Purifier`, slug: `${tag}-ro`, is_active: true, level: 'mail', row_type: 'store', spreadsheet_id: SHEET,
    mail_subject: 'RO ticket {{ticket_no}} - {{store_code}}', mail_body_html: '<p>Dear vendor</p><table><tbody><tr><th>Ticket No</th><td>{{ticket_no}}</td></tr><tr><th>Vendor</th><td>{{vendor}}</td></tr><tr><th>Brand</th><td>{{extra_brandname}}</td></tr><tr><th>Issue</th><td>{{subject}}</td></tr><tr><th>Issue Description</th><td>{{description}}</td></tr></tbody></table>',
  }).select('id').single()).data.id
  ids.cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ro`, slug: `${tag}-ro-cat`, program_id: ids.program }).select('id').single()).data.id
  ids.sub = (await a.from('service_sub_categories').insert({ category_id: ids.cat, name: `${tag} ro-sub`, slug: `${tag}-ro-sub` }).select('id').single()).data.id
  await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: ids.sub })
  await a.from('services').update({ form_fields: [{ id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }] }).eq('id', fx.teamA.serviceId)
  sheets[SHEET] = [HEAD, [A, 'svc@aqua.test, desk.lead@citykartstores.com', 'Aqua Care', 'KENT'], [C, '', 'Aqua Care', 'PUREIT']]
  await sync()
}, 300_000)

afterAll(async () => {
  const a = db()
  await setStore(null)
  if (made.length) { await a.from('request_program_snapshots').delete().in('request_id', made); await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made) }
  await a.from('service_sub_category_tags').delete().eq('sub_category_id', ids.sub)
  await a.from('service_sub_categories').delete().eq('id', ids.sub)
  await a.from('service_categories').delete().eq('id', ids.cat)
  await a.from('vendor_programs').delete().eq('id', ids.program)   // its rows and problems go with it
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  await a.from('stores').delete().in('id', [ids.storeA, ids.storeB, ids.storeC].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

describe('the program sheet is copied into the database', () => {
  it('keeps the rows with the extra columns and lists what is wrong', async () => {
    const rows = ((await db().from('program_rows').select('store_code, vendor, emails, extra').eq('program_id', ids.program)).data ?? []) as { store_code: string; vendor: string; emails: string[]; extra: Record<string, string> }[]
    expect(rows.find((r) => r.store_code === A)).toMatchObject({ vendor: 'Aqua Care', emails: ['svc@aqua.test', 'desk.lead@citykartstores.com'], extra: { 'Brand Name': 'KENT' } })
    const issues = ((await db().from('program_issues').select('code, store_code').eq('program_id', ids.program)).data ?? []) as { code: string; store_code: string | null }[]
    expect(issues.some((i) => i.code === 'no_email' && i.store_code === C)).toBe(true)
    const p = (await db().from('vendor_programs').select('last_status, row_count').eq('id', ids.program).single()).data
    expect(p).toMatchObject({ last_status: 'ok', row_count: 2 })
  })
  it('a sheet that lost a required column is not applied: the last good copy stays and the screen can show why', async () => {
    const good = sheets[SHEET]
    sheets[SHEET] = [['Store Code', 'Vendor'], [A, 'x']]
    const rep = await sync()
    expect(rep[0].status).toBe('error')
    expect(rep[0].message).toMatch(/missing the column/)
    expect(((await db().from('program_rows').select('id').eq('program_id', ids.program).is('removed_at', null)).data ?? []).length).toBe(2)
    expect((await db().from('vendor_programs').select('last_status, last_error').eq('id', ids.program).single()).data.last_status).toBe('error')
    sheets[SHEET] = good
    expect((await sync())[0].status).toBe('ok')
  })
})

describe('a ticket in a category of an active program', () => {
  it('goes to the vendor in ONE mail (vendor in To, company people in CC), with the program\'s words and the sheet\'s extra column; In Progress; snapshot saved', async () => {
    vi.mocked(sendEmail).mockClear()
    await setStore(ids.storeA)
    const r = await raise('water not cold')
    expect(r.error, JSON.stringify(r)).toBeUndefined()
    const calls = mails().filter((c) => /RO ticket/.test(String(c[0].subject)))
    expect(calls).toHaveLength(1)
    expect(calls[0][0].to).toEqual(['svc@aqua.test'])
    expect(calls[0][0].cc).toEqual(['desk.lead@citykartstores.com'])
    expect(String(calls[0][0].html)).toContain('KENT')
    expect(String(calls[0][0].html)).toContain('Aqua Care')
    const t = await ticket(r.requestId!)
    expect(t.status).toBe('in_progress')
    const note = t.comments.find((c) => !c.is_internal && /^Ticket sent to the .* OEM for servicing\./.test(c.body))
    expect(note, 'the conversation note').toBeTruthy()
    const view = parseOemComment(note!.body)!
    expect(view).not.toBeNull()
    const rows = (view.blocks.find((b) => b.kind === 'table') as { rows: { label: string; value: string }[] }).rows
    expect(rows.find((x) => x.label === 'Brand')?.value).toBe('KENT')
    const snap = (await db().from('request_program_snapshots').select('program_id, snapshot, mailed_to, mailed_cc').eq('request_id', r.requestId!).single()).data
    expect(snap.program_id).toBe(ids.program)
    expect(snap.mailed_to).toEqual(['svc@aqua.test'])
    expect(snap.snapshot[0]).toMatchObject({ store_code: A, vendor: 'Aqua Care' })
  })
  it('a store that is not in the sheet, a store with no address and a requester without a store stay Open with an internal note', async () => {
    for (const [store, what, re] of [[ids.storeB, 'not in sheet', /no active row/], [ids.storeC, 'no address', /no e-mail address/], [null, 'no store', /not linked to a store/]] as const) {
      vi.mocked(sendEmail).mockClear()
      await setStore(store)
      const r = await raise(`ticket ${what}`)
      expect(r.error, JSON.stringify(r)).toBeUndefined()
      expect(mails().filter((c) => /RO ticket/.test(String(c[0].subject))), what).toHaveLength(0)
      const t = await ticket(r.requestId!)
      expect(t.status, what).toBe('open')
      expect(t.comments.some((c) => c.is_internal && re.test(c.body)), what).toBe(true)
    }
  })
  it('a program that is switched off does nothing at all: a normal ticket, no mail, no note', async () => {
    await setProgram({ is_active: false })
    vi.mocked(sendEmail).mockClear()
    await setStore(ids.storeA)
    const r = await raise('program off')
    const t = await ticket(r.requestId!)
    expect(mails().filter((c) => /RO ticket/.test(String(c[0].subject)))).toHaveLength(0)
    expect(t.status).toBe('open')
    expect(t.comments.filter((c) => /vendor|OEM/i.test(c.body))).toHaveLength(0)
    await setProgram({ is_active: true })
  })
  it('level "portal" mails the vendor but keeps the ticket Open for the vendor\'s own technician', async () => {
    await setProgram({ level: 'portal' })
    vi.mocked(sendEmail).mockClear()
    await setStore(ids.storeA)
    const r = await raise('portal level')
    expect(mails().filter((c) => /RO ticket/.test(String(c[0].subject)))).toHaveLength(1)
    expect((await ticket(r.requestId!)).status).toBe('open')
    await setProgram({ level: 'mail' })
  })
  it('when the store reopens the resolved ticket the vendor is mailed again, marked REOPENED with the reason', async () => {
    await setStore(ids.storeA)
    const r = await raise('reopen me')
    await db().from('requests').update({ status: 'resolved', resolved_at: new Date().toISOString(), reopen_deadline_at: new Date(Date.now() + 3_600_000).toISOString() }).eq('id', r.requestId!)
    vi.mocked(sendEmail).mockClear()
    actAs(fx.requesterA)
    const res = await updateRequestStatus(r.requestId!, 'open', 'The purifier is not cooling again')
    expect(res.error, JSON.stringify(res)).toBeUndefined()
    const sent = mails().filter((c) => /REOPENED/.test(String(c[0].subject)))
    expect(sent).toHaveLength(1)
    expect(sent[0][0].to).toEqual(['svc@aqua.test'])
    expect(String(sent[0][0].html)).toContain('not cooling again')
    expect((await ticket(r.requestId!)).status).toBe('in_progress')
  })
})

describe('what a program may not do', () => {
  it('its data cannot be read by a signed-in user (server only)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = clientForToken(fx.requesterA.accessToken) as unknown as { from: (t: string) => any }
    for (const table of ['vendor_programs', 'program_rows', 'program_issues', 'request_program_snapshots']) {
      const res = await c.from(table).select('*').limit(1)
      expect(res.error || (res.data ?? []).length === 0, table).toBeTruthy()
    }
  })
  it('a category cannot be in a program and also have an AC / Genset OEM type or be the AC PMS category', async () => {
    expect((await db().from('service_categories').update({ auto_oem_kind: 'ac' }).eq('id', ids.cat)).error).toBeTruthy()
    expect((await db().from('service_categories').update({ is_pms: true }).eq('id', ids.cat)).error).toBeTruthy()
  })
  it('a mistake in the sheet never loses the rows already copied: rows that leave the sheet are kept as removed', async () => {
    const keep = sheets[SHEET]
    sheets[SHEET] = [HEAD, [A, 'svc@aqua.test, desk.lead@citykartstores.com', 'Aqua Care', 'KENT']]
    await sync()
    const rows = ((await db().from('program_rows').select('store_code, removed_at').eq('program_id', ids.program)).data ?? []) as { store_code: string; removed_at: string | null }[]
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.store_code === C)!.removed_at).not.toBeNull()
    sheets[SHEET] = keep
    await sync()
  })
})
