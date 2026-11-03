import { describe, it, expect, vi } from 'vitest'
import { parseAcSheet, parseStoreDetailsSheet } from '@/lib/masters/parse'
import { noAcStoresIssue, storesWithoutAcRows, storePatchFromAcRows, storePatchFromDetails, updateStoreMaster } from '@/lib/masters/sync'
import { googleSheetsSource } from '@/lib/masters/google'
import { csvDirSource } from '@/lib/masters/demo'
import type { StoreDetailRow } from '@/lib/masters/types'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/intake/oauth', () => ({ providerConfig: () => ({ clientId: 'id', clientSecret: 'secret', tokenUrl: 'https://token.test/t' }) }))
vi.mock('@/lib/http/fetch-timeout', () => ({
  fetchWithTimeout: vi.fn(async (url: string) => {
    const json = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body })
    if (url.startsWith('https://token.test')) return json({ access_token: 'tok', expires_in: 3600 })
    if (url.includes('fields=sheets.properties.title')) return json({ sheets: [{ properties: { title: 'Sheet1' } }, { properties: { title: 'Store  Details' } }] })
    if (url.includes('/values/')) return json({ values: [['Store Code'], [decodeURIComponent(url.split('/values/')[1].split('?')[0])]] })
    return { ok: false, status: 500, statusText: 'bad', json: async () => ({}) }
  }),
}))

// The Store Details tab of the AC sheet is the Store Master: it fills the store card (address, pincode, city, state, region, cluster, priority list, festival, opening date);
// the AC rows of the first tab still give the machines' facts (AC total, brand, AMC brand, AMC vendor, Zenatix).

const HEAD = ['Store Code', 'Store Priority list', 'Festival', 'Region', 'Cluster', 'Opening date', 'City', 'State', 'Address', 'pincode']
const row = (code: string, over: Partial<Record<string, unknown>> = {}) => {
  const d: Record<string, unknown> = { code, prio: 'Top 50', fest: 'DIWALI|HOLI', region: 'R4', cluster: 'UP2', open: 40725, city: 'LUCKNOW', state: 'UP', address: '551K, Alambagh', pin: 226005, ...over }
  return [d.code, d.prio, d.fest, d.region, d.cluster, d.open, d.city, d.state, d.address, d.pin]
}

describe('reading the Store Details tab', () => {
  it('reads one row per store, with the date number turned into a date', () => {
    const r = parseStoreDetailsSheet([HEAD, row('lam'), row('ALC', { open: '15/10/2011', city: 'ALLAHABAD' })])
    expect(r.fatal).toBeUndefined()
    expect(r.issues).toEqual([])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ storeCode: 'LAM', priority: 'Top 50', festival: 'DIWALI|HOLI', region: 'R4', cluster: 'UP2', openingDate: '2011-07-01', city: 'LUCKNOW', state: 'UP', address: '551K, Alambagh', pincode: '226005', sheetRow: 2 })
    expect(r.rows[1].openingDate).toBe('2011-10-15')
  })

  it('finds the columns by their heading, in any order', () => {
    const r = parseStoreDetailsSheet([['pincode', 'City', 'store code'], [211001, 'ALLAHABAD', 'alc']])
    expect(r.rows).toEqual([expect.objectContaining({ storeCode: 'ALC', pincode: '211001', city: 'ALLAHABAD', state: '', openingDate: null })])
  })

  it('is refused (nothing applied) when the tab is empty, has no Store Code, or has no detail column', () => {
    expect(parseStoreDetailsSheet([]).fatal).toMatch(/empty/)
    expect(parseStoreDetailsSheet([['City', 'State'], ['X', 'UP']]).fatal).toMatch(/Store Code/)
    expect(parseStoreDetailsSheet([['Store Code'], ['LAM']]).fatal).toMatch(/no detail columns/)
    expect(parseStoreDetailsSheet([['Store Code', 'City', 'City'], ['LAM', 'a', 'b']]).fatal).toMatch(/more than one column/)
  })

  it('uses the first row of a store written twice, and says so', () => {
    const r = parseStoreDetailsSheet([HEAD, row('LAM', { city: 'FIRST' }), row('LAM', { city: 'SECOND' })])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].city).toBe('FIRST')
    expect(r.issues).toEqual([expect.objectContaining({ code: 'duplicate_store_details', severity: 'warning', storeCode: 'LAM', sheetRow: 3 })])
  })

  it('tells the team about a row without a store code, a pincode that is not 6 digits, and an opening date it cannot read (still reading the row)', () => {
    const r = parseStoreDetailsSheet([HEAD, row('', { city: 'NOBODY' }), row('MDB', { pin: 4778 }), row('XYZ', { open: '31/02/2026' })])
    const codes = r.issues.map((i) => i.code).sort()
    expect(codes).toEqual(['bad_opening_date', 'bad_pincode', 'blank_store'])
    expect(r.rows.map((x) => x.storeCode)).toEqual(['MDB', 'XYZ'])
    expect(r.rows[0].pincode).toBe('4778')
    expect(r.rows[1].openingDate).toBeNull()
  })

  it('groups the State "ALL" into ONE line (not one per store)', () => {
    const r = parseStoreDetailsSheet([HEAD, row('A1', { state: 'ALL' }), row('A2', { state: 'all' }), row('A3', { state: 'UP' })])
    const s = r.issues.filter((i) => i.code === 'suspect_state')
    expect(s).toHaveLength(1)
    expect(s[0].message).toMatch(/^2 store\(s\) have the State "ALL"/)
    expect(s[0].message).toContain('A1, A2')
    expect(r.rows).toHaveLength(3)   // still read: the sheet is the master
  })
})

describe('what goes on the store card', () => {
  const ac = parseAcSheet([
    ['Store Code', 'AC CKDESK SERIAL NO', 'Ticket Mail To', 'AC Brand', 'AC-AMC Brand', 'AC-AMC vendor', 'Zenatix (yes/No)', 'City', 'Address', 'pincode', 'Status'],
    ['LAM', 1, 'oem@oem.test', 'DAIKIN', 'DAIKIN', 'UMS', 'YES', 'OLD CITY', 'old address', 111111, 'Active'],
    ['LAM', 2, 'oem@oem.test', 'DAIKIN', 'DAIKIN', 'UMS', 'YES', 'OLD CITY', 'old address', 111111, 'Active'],
    ['LAM', 3, 'oem@oem.test', 'VOLTAS', 'VOLTAS', 'XYZ', 'NO', 'OLD CITY', 'old address', 111111, 'Inactive'],
  ]).rows

  it('the AC rows give everything while there is no Store Details tab (as before)', () => {
    const p = storePatchFromAcRows(ac)
    expect(p).toMatchObject({ ac_total: 2, city: 'OLD CITY', address: 'old address', pincode: '111111', ac_brand: 'DAIKIN', ac_amc_vendor: 'UMS', zenatix: true })
  })

  it('with the tab, the AC rows give only the machines', () => {
    const p = storePatchFromAcRows(ac, true)
    expect(p).toEqual({ ac_total: 2, ac_brand: 'DAIKIN', ac_amc_brand: 'DAIKIN', ac_amc_vendor: 'UMS', zenatix: true })
  })

  it('a tab row gives only the cells that have a value', () => {
    const d: StoreDetailRow = { sheetRow: 2, storeCode: 'LAM', priority: '', festival: 'DIWALI', region: '', cluster: 'UP2', openingDate: null, city: 'LUCKNOW', state: '', address: '', pincode: '226005' }
    expect(storePatchFromDetails(d)).toEqual({ festival: 'DIWALI', cluster: 'UP2', city: 'LUCKNOW', pincode: '226005' })
  })
})

// a tiny stand-in for the stores table: select().eq().in() and update().eq().eq()
function fakeStores(stores: Record<string, unknown>[]) {
  const updates: { id: unknown; patch: Record<string, unknown> }[] = []
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ in: (_c: string, codes: string[]) => Promise.resolve({ data: stores.filter((s) => codes.includes(String(s.code))), error: null }) }) }),
      update: (patch: Record<string, unknown>) => ({ eq: (_c: string, id: unknown) => ({ eq: () => { updates.push({ id, patch }); return Promise.resolve({ error: null }) } }) }),
    }),
  }
  return { db, updates }
}
const card = (code: string, over: Record<string, unknown> = {}) => ({ id: `id-${code}`, code, ac_total: 0, address: 'card address', city: 'CARD CITY', state: 'CARD ST', pincode: '000000', cluster: 'C0', region: 'R0', priority_list: 'ROS', festival: 'F0', ac_brand: null, ac_amc_brand: null, ac_amc_vendor: null, open_date: '2000-01-01', zenatix: null, ...over })
const acRowsFor = (...codes: string[]) => parseAcSheet([
  ['Store Code', 'AC CKDESK SERIAL NO', 'Ticket Mail To', 'AC Brand', 'AC-AMC vendor', 'City', 'State', 'Status'],
  ...codes.map((c) => [c, 1, 'oem@oem.test', 'DAIKIN', 'UMS', 'AC-SHEET CITY', 'AC-SHEET ST', 'Active']),
]).rows
const detail = (code: string, over: Partial<StoreDetailRow> = {}): StoreDetailRow => ({ sheetRow: 2, storeCode: code, priority: 'Top 50', festival: 'DIWALI', region: 'R4', cluster: 'UP2', openingDate: '2011-07-01', city: 'TAB CITY', state: 'UP', address: 'tab address', pincode: '226005', ...over })

describe('updating the store cards', () => {
  it('with the tab: the store details come from the tab, the machines from the AC rows', async () => {
    const { db, updates } = fakeStores([card('LAM')])
    await updateStoreMaster(db, 'org', acRowsFor('LAM'), [detail('LAM')], true)
    expect(updates).toHaveLength(1)
    expect(updates[0].patch).toMatchObject({ city: 'TAB CITY', state: 'UP', address: 'tab address', pincode: '226005', cluster: 'UP2', region: 'R4', priority_list: 'Top 50', festival: 'DIWALI', open_date: '2011-07-01', ac_total: 1, ac_brand: 'DAIKIN', ac_amc_vendor: 'UMS' })
    expect(JSON.stringify(updates[0].patch)).not.toContain('AC-SHEET')
  })

  it('a store that is only in the tab still gets its details, and its AC total is left alone', async () => {
    const { db, updates } = fakeStores([card('GWL', { ac_total: 5 })])
    await updateStoreMaster(db, 'org', acRowsFor('LAM'), [detail('GWL')], true)
    expect(updates).toHaveLength(1)
    expect(updates[0].patch).not.toHaveProperty('ac_total')
    expect(updates[0].patch).toMatchObject({ city: 'TAB CITY' })
  })

  it('an empty cell in the tab never erases what the card has', async () => {
    const { db, updates } = fakeStores([card('LAM')])
    await updateStoreMaster(db, 'org', [], [detail('LAM', { city: '', pincode: '', openingDate: null })], true)
    expect(updates[0].patch).not.toHaveProperty('city')
    expect(updates[0].patch).not.toHaveProperty('pincode')
    expect(updates[0].patch).not.toHaveProperty('open_date')
    expect(updates[0].patch).toMatchObject({ state: 'UP' })
  })

  it('nothing is written when the card already matches', async () => {
    const { db, updates } = fakeStores([card('LAM', { address: 'tab address', city: 'TAB CITY', state: 'UP', pincode: '226005', cluster: 'UP2', region: 'R4', priority_list: 'Top 50', festival: 'DIWALI', open_date: '2011-07-01' })])
    await updateStoreMaster(db, 'org', [], [detail('LAM')], true)
    expect(updates).toEqual([])
  })

  it('with no tab (never had one) the AC rows fill the details as before; with a tab that could not be used the details are left alone', async () => {
    const before = fakeStores([card('LAM')])
    await updateStoreMaster(before.db, 'org', acRowsFor('LAM'), null, false)
    expect(before.updates[0].patch).toMatchObject({ city: 'AC-SHEET CITY', state: 'AC-SHEET ST', ac_total: 1 })
    const held = fakeStores([card('LAM')])
    await updateStoreMaster(held.db, 'org', acRowsFor('LAM'), null, true)
    expect(held.updates[0].patch).toEqual({ ac_total: 1, ac_brand: 'DAIKIN', ac_amc_vendor: 'UMS' })
  })
})

describe('a store with no AC row in the sheet counts as having no AC', () => {
  const stores = [
    { id: 1, code: 'LAM', is_active: true, ac_total: 10 },   // has AC rows: the sheet keeps it right
    { id: 2, code: 'bkn', is_active: true, ac_total: 11 },   // no AC row, old total
    { id: 3, code: 'CTP', is_active: true, ac_total: 8 },
    { id: 4, code: 'DKH', is_active: true, ac_total: null }, // no AC row, no total
    { id: 5, code: 'ZZZ', is_active: true, ac_total: 0 },    // no AC row, already 0
    { id: 6, code: 'OLD', is_active: false, ac_total: 5 },   // closed store, no AC row
  ]
  it('finds the stores with no AC row (capitals do not matter) and what their total is now', () => {
    const list = storesWithoutAcRows(stores, new Set(['LAM']))
    expect(list.map((s) => s.code)).toEqual(['BKN', 'CTP', 'DKH', 'ZZZ', 'OLD'])
    expect(list.map((s) => s.total)).toEqual([11, 8, null, 0, 5])
    expect(list.filter((s) => s.total !== 0).map((s) => s.id)).toEqual([2, 3, 4, 6])   // the ones whose total is set to 0
  })
  it('tells the team which ACTIVE stores are counted as having no AC', () => {
    const i = noAcStoresIssue(storesWithoutAcRows(stores, new Set(['LAM'])))
    expect(i).toMatchObject({ kind: 'ac', severity: 'warning', code: 'store_without_ac_rows', storeCode: 'BKN' })
    expect(i?.message).toMatch(/^4 active store\(s\) have no AC row/)
    expect(i?.message).toContain('BKN, CTP, DKH, ZZZ')
    expect(i?.message).not.toContain('OLD')
  })
  it('says nothing when every active store has AC rows', () => {
    expect(noAcStoresIssue(storesWithoutAcRows(stores, new Set(['LAM', 'BKN', 'CTP', 'DKH', 'ZZZ'])))).toBeNull()
  })
})

describe('finding the Store Details tab in the sheet', () => {
  it('Google: the tab is found whatever its capitals or spaces, and a sheet without it gives null', async () => {
    const src = googleSheetsSource('refresh-token')
    const found = await src.fetchTabValues!('sheet-id-aaaaaaaaaaaaaaaaaaaa', 'Store Details')
    expect(found?.[1]?.[0]).toBe("'Store  Details'")   // asked for by the tab's real title
    expect(await src.fetchTabValues!('sheet-id-aaaaaaaaaaaaaaaaaaaa', 'Nothing Here')).toBeNull()
  })

  it('demo files: demo-ac-store-details.csv is the tab, no file means no tab', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ckdesk-demo-'))
    writeFileSync(path.join(dir, 'demo-ac-store-details.csv'), 'Store Code,City\nLAM,LUCKNOW\n')
    const src = csvDirSource(dir)
    expect(await src.fetchTabValues!('demo-ac', 'Store Details')).toEqual([['Store Code', 'City'], ['LAM', 'LUCKNOW']])
    expect(await src.fetchTabValues!('demo-genset', 'Store Details')).toBeNull()
  })
})
