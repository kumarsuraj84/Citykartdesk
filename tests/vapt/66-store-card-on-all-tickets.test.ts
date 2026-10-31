// The store card (stores table) is the main store master: its standard details are available to the tickets of EVERY service, with or without a Vendor Program, on the isolated
// audit stack (mail goes nowhere):
//  - a Vendor Program's mail and the old AC mail can print the store's city, state, region, cluster, priority list, festival and opening date, and the address with its pincode;
//  - the address written on the ticket form is the address with the pincode (once);
//  - a Business Rule on the store's region / city / priority list / months since opening works for a ticket that has no program and no AC at all.
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

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t66${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const mails = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0]) as unknown as { to: string[]; cc?: string[]; subject: string; html: string }[]
const mailsFor = (title: string) => mails().filter((m) => m.html.includes(`${tag} ${title}`))
const STORE = `${tag}s`.toUpperCase()
const ids = { store: '', program: '', catProg: '', catOld: '', catPlain: '', subProg: '', subOld: '', subPlain: '' }
const made: string[] = []
const ruleIds: string[] = []
const SUBJECT_FIELD = { id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }
const ADDRESS_FIELD = { id: 'addr', type: 'store_address', label: 'Store Address', required: false, order: 2 }
const WORDING = '<p>Dear Team,</p><table><tbody><tr><th>Ticket</th><td>{{subject}}</td></tr><tr><th>Where</th><td>{{store_address}} | {{store_city}} | {{store_state}}</td></tr>'
  + '<tr><th>Store</th><td>region {{store_region}} | cluster {{store_cluster}} | priority {{store_priority}} | festival {{store_festival}} | opened {{store_open_date}}</td></tr></tbody></table>'
const STORE_FACTS = ['Hotel Meghdoot Complex - 768201', 'Jharsuguda', 'Odisha', 'region East', 'cluster OD-1', 'priority P2', 'festival Durga Puja', 'opened 12 Mar 2024']

async function raise(sub: string, title: string) {
  actAs(fx.requesterA)
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', sub)
  f.set('form_data', JSON.stringify({ subject: `${tag} ${title}` }))
  const r = await createRequest(f)
  if (r.requestId) made.push(r.requestId)
  return r
}
const ticket = async (id: string) => (await db().from('requests').select('id, status, assigned_to, form_data').eq('id', id).single()).data as { id: string; status: string; assigned_to: string | null; form_data: Record<string, string> }

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  ids.store = (await a.from('stores').insert({
    org_id: fx.orgId, code: STORE, name: `${tag} store`, address: 'Hotel Meghdoot Complex', pincode: '768201', city: 'Jharsuguda', state: 'Odisha', region: 'East', cluster: 'OD-1',
    priority_list: 'P2', festival: 'Durga Puja', open_date: '2024-03-12',
  }).select('id').single()).data.id
  await a.from('profiles').update({ store_id: ids.store }).eq('id', fx.requesterA.id)
  const now = new Date().toISOString()
  // a program (one row per store, mail level) whose mail uses the store's details
  ids.program = (await a.from('vendor_programs').insert({
    org_id: fx.orgId, name: 'Aqua', slug: `${tag}-aqua`, is_active: true, level: 'mail', row_type: 'store', spreadsheet_id: `${tag}-sheet-0000000000`,
    mail_subject: 'New {{program}} Ticket - {{ticket_no}} - {{store_code}}', mail_body_html: WORDING,
  }).select('id').single()).data.id
  await a.from('program_rows').insert({ org_id: fx.orgId, program_id: ids.program, store_code: STORE, vendor: 'Aqua Care', emails: ['aqua@vendor.test'], po_emails: [], approver_emails: [], extra: {}, is_active: true, sheet_row: 2, previous_serials: [], first_seen_at: now, last_seen_at: now })
  // the old AC setting: one AC row, and the saved AC mail wording uses the store's details too
  await a.from('master_ac_units').insert({ org_id: fx.orgId, store_code: STORE, ckdesk_no: '1', serial: 'S-1', floor: 'GF', ac_type: 'Split', tonnage: '2 TR', brand: 'DAIKIN', amc_vendor: 'BLUESTAR', amc_brand: 'STAR COOLING', emails: ['oem@bluestar.test'], is_active: true, sheet_row: 2 })
  await a.from('master_mail_templates').upsert({ org_id: fx.orgId, kind: 'ac', subject: 'New AC Issue Ticket - {{ticket_no}} - {{store_code}}', body_html: WORDING }, { onConflict: 'org_id,kind' })
  const mkCat = async (n: string, extra: Record<string, unknown>) => {
    const cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ${n}`, slug: `${tag}-${n}-cat`, ...extra }).select('id').single()).data.id as string
    const sub = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} ${n}-sub`, slug: `${tag}-${n}-sub` }).select('id').single()).data.id as string
    await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: sub })
    return { cat, sub }
  }
  const prog = await mkCat('prog', { program_id: ids.program }); ids.catProg = prog.cat; ids.subProg = prog.sub
  const old = await mkCat('old', { auto_oem_kind: 'ac' }); ids.catOld = old.cat; ids.subOld = old.sub
  const plain = await mkCat('plain', {}); ids.catPlain = plain.cat; ids.subPlain = plain.sub
  await a.from('services').update({ form_fields: [SUBJECT_FIELD, ADDRESS_FIELD] }).eq('id', fx.teamA.serviceId)
}, 300_000)

afterAll(async () => {
  const a = db()
  await a.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
  if (ruleIds.length) await a.from('business_rules').delete().in('id', ruleIds)
  if (made.length) {
    for (const t of ['request_program_snapshots', 'request_master_snapshots', 'request_activity', 'request_comments']) await a.from(t).delete().in('request_id', made)
    await a.from('requests').delete().in('id', made)
  }
  const subs = [ids.subProg, ids.subOld, ids.subPlain].filter(Boolean)
  await a.from('service_sub_category_tags').delete().in('sub_category_id', subs)
  await a.from('service_sub_categories').delete().in('id', subs)
  await a.from('service_categories').delete().in('id', [ids.catProg, ids.catOld, ids.catPlain].filter(Boolean))
  await a.from('program_rows').delete().eq('program_id', ids.program)
  await a.from('vendor_programs').delete().eq('id', ids.program)
  await a.from('master_mail_templates').delete().eq('org_id', fx.orgId).eq('kind', 'ac')
  await a.from('master_ac_units').delete().eq('org_id', fx.orgId).eq('store_code', STORE)
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  await a.from('stores').delete().eq('id', ids.store)
  await fx?.cleanup()
}, 180_000)

describe('the mails print the store card', () => {
  it('a Vendor Program mail has the store details and the address with its pincode', async () => {
    const t = await raise(ids.subProg, 'program mail')
    expect(t.error).toBeUndefined()
    const [m] = mailsFor('program mail')
    expect(m, 'the program mails').toBeTruthy()
    for (const fact of STORE_FACTS) expect(m.html, fact).toContain(fact)
  })
  it('the old AC mail has them too', async () => {
    const t = await raise(ids.subOld, 'old ac mail')
    expect(t.error).toBeUndefined()
    const [m] = mailsFor('old ac mail')
    expect(m, 'the old AC setting mails').toBeTruthy()
    for (const fact of STORE_FACTS) expect(m.html, fact).toContain(fact)
  })
})

describe('the address on the ticket', () => {
  it('is the store address with the pincode, once', async () => {
    const t = await raise(ids.subPlain, 'address check')
    expect((await ticket(t.requestId!)).form_data.addr).toBe('Hotel Meghdoot Complex - 768201')
  })
  it('does not repeat a pincode that the address already has', async () => {
    await db().from('stores').update({ address: 'Hotel Meghdoot Complex, Odisha- 768201' }).eq('id', ids.store)
    try {
      const t = await raise(ids.subPlain, 'address twice')
      expect((await ticket(t.requestId!)).form_data.addr).toBe('Hotel Meghdoot Complex, Odisha- 768201')
    } finally { await db().from('stores').update({ address: 'Hotel Meghdoot Complex' }).eq('id', ids.store) }
  })
})

describe('a Business Rule on the store card works for a ticket with no program and no AC', () => {
  async function rule(marker: string, conditions: unknown[]) {
    const r = (await db().from('business_rules').insert({
      org_id: fx.orgId, name: `${tag} ${marker}`, trigger: ['created'], is_active: true, execution_order: 9500, conditions_logic: 'AND',
      conditions: [{ field: 'title', operator: 'contains', value: `${tag} ${marker}` }, ...conditions.map((c) => ({ logic: 'AND', ...(c as object) }))],
      actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [fx.agentA.id] } }],
    }).select('id').single()).data.id as string
    ruleIds.push(r)
  }
  it('region, city, priority list and months since opening all match the store card: the ticket goes to the technician of the rule', async () => {
    await rule('card rule', [
      { field: 'store_region', operator: 'equals', value: 'East' }, { field: 'store_city', operator: 'equals', value: 'Jharsuguda' },
      { field: 'store_priority', operator: 'equals', value: 'P2' }, { field: 'store_open_months', operator: 'gt', value: '12' },
    ])
    const t = await raise(ids.subPlain, 'card rule')
    expect((await ticket(t.requestId!)).assigned_to).toBe(fx.agentA.id)
  })
  it('a rule for another region does not touch the ticket', async () => {
    await rule('other region', [{ field: 'store_region', operator: 'equals', value: 'North' }])
    const t = await raise(ids.subPlain, 'other region')
    expect((await ticket(t.requestId!)).assigned_to).not.toBe(fx.agentA.id)
  })
  it('"opened less than 9 months ago" does not match a store that opened in 2024', async () => {
    await rule('new store only', [{ field: 'store_open_months', operator: 'lt', value: '9' }])
    const t = await raise(ids.subPlain, 'new store only')
    expect((await ticket(t.requestId!)).assigned_to).not.toBe(fx.agentA.id)
  })
})
