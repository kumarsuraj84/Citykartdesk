// The "Store Details" tab of the AC Google Sheet as the Store Master, on the isolated audit stack (the sheet is replaced by fixed rows; nothing goes to Google):
//  - while the sheet has no such tab, the store card follows the AC rows (as before);
//  - with the tab, the store's own details come from the tab and only the machines' facts from the AC rows; a store only in the tab is filled too; an empty cell erases nothing;
//  - a store card is never filled from the AC rows again once the tab has been used: a tab that disappears, is unreadable or has no stores leaves the cards as they are, with a problem line;
//  - the problem list says which stores the tab does not list and which codes CK Desk does not know.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))

import { syncMasters } from '@/lib/masters/sync'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t72${String(Date.now()).slice(-6)}`
const code = (s: string) => `${tag}${s}`.toUpperCase()
const A = code('a'), B = code('b'), C = code('c'), Z = code('z')
let fx: D03Fixtures
const SHEET = `${tag}-sheet-ac-0000000000`
const usedKey = () => `masters_store_details_used:${fx.orgId}`

const AC_HEAD = ['Store Code', 'AC CKDESK SERIAL NO', 'Ticket Mail To', 'AC Brand', 'AC-AMC vendor', 'City', 'State', 'Address', 'pincode', 'Status']
const acRow = (store: string, no: number, city: string) => [store, no, 'oem@oem.test', 'DAIKIN', 'UMS', city, 'AC-ST', 'ac address', 111111, 'Active']
const TAB_HEAD = ['Store Code', 'Store Priority list', 'Festival', 'Region', 'Cluster', 'Opening date', 'City', 'State', 'Address', 'pincode']
const tabRow = (store: string, city: string, over: Partial<{ address: string; pin: string | number }> = {}) => [store, 'Top 50', 'DIWALI', 'R4', 'UP2', 40725, city, 'UP', over.address ?? 'tab address', over.pin ?? 226005]

let ac: unknown[][] = []
let tab: unknown[][] | null = null
let tabFails = false
const source: SheetsSource = {
  fetchValues: async () => ac,
  fetchTabValues: async () => { if (tabFails) throw new Error('Google is busy'); return tab },
}
const sync = () => syncMasters({ db: db(), orgId: fx.orgId, source, force: true })
const cardOf = async (c: string) => (await db().from('stores').select('city, state, address, pincode, cluster, region, priority_list, festival, open_date, ac_total, ac_brand, ac_amc_vendor').eq('org_id', fx.orgId).eq('code', c).single()).data as Record<string, unknown>
const issuesOf = async () => ((await db().from('master_issues').select('kind, code, severity, message').eq('org_id', fx.orgId).eq('kind', 'ac')).data ?? []) as { code: string; severity: string; message: string }[]
const clear = async () => {
  for (const t of ['master_issues', 'master_ac_units', 'master_sources']) await db().from(t).delete().eq('org_id', fx.orgId)
  await db().from('app_settings').delete().eq('key', usedKey())
}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  await clear()
  for (const c of [A, B, C]) await db().from('stores').insert({ org_id: fx.orgId, code: c, name: `${tag} ${c}`, address: 'old address', city: 'OLD CITY', state: 'OLD', pincode: '000000' })
  await db().from('master_sources').insert({ org_id: fx.orgId, kind: 'ac', spreadsheet_id: SHEET })
}, 300_000)

afterAll(async () => {
  await clear()
  await db().from('stores').delete().eq('org_id', fx.orgId).in('code', [A, B, C])
  await fx?.cleanup()
}, 180_000)

describe('the Store Details tab fills the store card', () => {
  it('1. no tab yet: the store card follows the AC rows, as before', async () => {
    ac = [AC_HEAD, acRow(A, 1, 'AC CITY A'), acRow(B, 1, 'AC CITY B')]
    tab = null
    const r = await sync()
    expect(r.ac.status).toBe('ok')
    expect(await cardOf(A)).toMatchObject({ city: 'AC CITY A', state: 'AC-ST', address: 'ac address', pincode: '111111', ac_total: 1, ac_brand: 'DAIKIN' })
    expect(await cardOf(B)).toMatchObject({ city: 'AC CITY B' })
    expect(await cardOf(C)).toMatchObject({ city: 'OLD CITY' })   // not in the AC sheet, nothing to read
    expect((await db().from('app_settings').select('value').eq('key', usedKey())).data ?? []).toHaveLength(0)
  })

  it('2. with the tab: the details come from the tab, the machines from the AC rows, a store only in the tab is filled, an unknown code is reported', async () => {
    ac = [AC_HEAD, acRow(A, 1, 'AC CITY A'), acRow(A, 2, 'AC CITY A'), acRow(B, 1, 'AC CITY B')]
    tab = [TAB_HEAD, tabRow(A, 'TAB CITY A'), tabRow(C, 'TAB CITY C', { pin: 4778 }), tabRow(Z, 'NOBODY')]
    const r = await sync()
    expect(r.ac.status).toBe('ok')
    expect(await cardOf(A)).toMatchObject({ city: 'TAB CITY A', state: 'UP', address: 'tab address', pincode: '226005', cluster: 'UP2', region: 'R4', priority_list: 'Top 50', festival: 'DIWALI', open_date: '2011-07-01', ac_total: 2, ac_brand: 'DAIKIN', ac_amc_vendor: 'UMS' })
    expect(await cardOf(C)).toMatchObject({ city: 'TAB CITY C', pincode: '4778', ac_total: null })
    expect(await cardOf(B)).toMatchObject({ city: 'AC CITY B', address: 'ac address' })   // B is not in the tab: its card keeps what it has
    const issues = await issuesOf()
    expect(issues.find((i) => i.code === 'unknown_store' && i.message.includes('Store Details tab'))?.message).toContain(Z)
    expect(issues.find((i) => i.code === 'store_without_details')?.message).toContain(B)
    expect(issues.some((i) => i.code === 'bad_pincode')).toBe(true)
    expect((await db().from('app_settings').select('value').eq('key', usedKey()).single()).data?.value).toBe('1')
  })

  it('3. a change in the tab alone is applied (the sheet content is not "unchanged"), and an empty cell erases nothing', async () => {
    tab = [TAB_HEAD, tabRow(A, 'TAB CITY A2', { address: '' }), tabRow(C, 'TAB CITY C')]
    await sync()
    expect(await cardOf(A)).toMatchObject({ city: 'TAB CITY A2', address: 'tab address' })
  })

  it('4. the tab disappears: the cards keep their values and are NOT filled from the AC rows again', async () => {
    tab = null
    ac = [AC_HEAD, acRow(A, 1, 'AC CITY CHANGED'), acRow(B, 1, 'AC CITY CHANGED')]
    const r = await sync()
    expect(r.ac.status).toBe('ok')
    expect(await cardOf(A)).toMatchObject({ city: 'TAB CITY A2' })
    expect(await cardOf(B)).toMatchObject({ city: 'AC CITY B' })
    expect((await issuesOf()).some((i) => i.code === 'store_details_tab_missing' && i.severity === 'error')).toBe(true)
  })

  it('5. a tab that cannot be read, or has headings but no stores, changes no card and says so', async () => {
    tabFails = true
    await sync()
    expect(await cardOf(A)).toMatchObject({ city: 'TAB CITY A2' })
    expect((await issuesOf()).some((i) => i.code === 'store_details_unreadable')).toBe(true)
    tabFails = false
    tab = [TAB_HEAD]
    await sync()
    expect(await cardOf(A)).toMatchObject({ city: 'TAB CITY A2' })
    expect((await issuesOf()).some((i) => i.code === 'store_details_not_applied')).toBe(true)
  })

  it('6. the tab is back: it is the master again', async () => {
    tab = [TAB_HEAD, tabRow(A, 'TAB CITY A3'), tabRow(B, 'TAB CITY B')]
    await sync()
    expect(await cardOf(A)).toMatchObject({ city: 'TAB CITY A3' })
    expect(await cardOf(B)).toMatchObject({ city: 'TAB CITY B' })
    expect((await issuesOf()).some((i) => i.code === 'store_details_tab_missing')).toBe(false)
  })
})
