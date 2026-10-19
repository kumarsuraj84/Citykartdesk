/**
 * Upload of the Store Master sheet into Stores: check first (nothing changes), then apply. Real database.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import ExcelJS from 'exceljs'
import { getAdmin } from '../setup/fixtures-d03'

const ORG = '00000000-0000-0000-0000-000000000001'
const role = { current: 'admin' }
vi.mock('@/lib/queries/profiles', () => ({
  getCurrentProfile: vi.fn(async () => ({ id: '00000000-0000-0000-0000-0000000000aa', role: role.current, org_id: ORG })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { previewStoreMaster, applyStoreMaster } from '@/lib/actions/admin/storeMaster'

vi.setConfig({ testTimeout: 60_000 })

const admin = getAdmin()
const CODES = ['ZT1', 'ZT2', 'ZT3']

async function sheet(rows: unknown[][], head = ['STORE', 'AC TOTAL', 'AC BRAND', 'ZENATIX', 'OPEN DATE', 'CLUSTER', 'FESTIVAL'], addMissing = false): Promise<FormData> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow(head)
  rows.forEach((r) => ws.addRow(r))
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer
  const fd = new FormData()
  fd.set('file', new File([buf], 'STORE MASTER.xlsx'))
  fd.set('addMissing', String(addMissing))
  return fd
}
const store = async (code: string) => (await admin.from('stores').select('*').eq('org_id', ORG).eq('code', code).maybeSingle()).data

describe('Store Master upload', () => {
  beforeAll(async () => {
    await admin.from('stores').delete().eq('org_id', ORG).in('code', [...CODES, 'ZT9'])
    await admin.from('stores').insert([
      { org_id: ORG, code: 'ZT1', name: 'Test One', address: 'Keep this address', city: 'Old city' },
      { org_id: ORG, code: 'ZT2', name: 'Test Two', cluster: 'KEEP-ME' },
      { org_id: ORG, code: 'ZT3', name: 'Test Three' },
    ])
  })
  afterAll(async () => { await admin.from('stores').delete().eq('org_id', ORG).in('code', [...CODES, 'ZT9']) })
  beforeEach(() => { role.current = 'admin' })

  it('checking a file changes nothing and says what would happen', async () => {
    const fd = await sheet([
      ['zt1', 9, 'HITACHI', 'No', new Date('2011-07-01T00:00:00Z'), 'UP2', 'DIWALI'],
      ['ZT2', 4, 'DAIKIN', 'YES', 'Pending', '', 'PUJA'],
      ['ZT9', 3, 'LG', 'No', new Date('2020-01-01T00:00:00Z'), 'CH1', ''],
    ])
    const res = await previewStoreMaster(fd)
    expect(res.error).toBeUndefined()
    expect(res.data).toMatchObject({ stores: 3, willChange: 2, unchanged: 0, missing: ['ZT9'] })
    expect(res.data!.columns).toEqual(['AC TOTAL', 'AC BRAND', 'ZENATIX', 'OPEN DATE', 'CLUSTER', 'FESTIVAL'])
    expect(res.data!.notes.join(' ')).toMatch(/1 cell says "Pending"/)
    expect((await store('ZT1'))!.ac_total).toBeNull() // nothing saved yet
    expect(await store('ZT9')).toBeNull()
  })

  it('applying updates the stores in the file, keeps what is not in the file, and never blanks a value with an empty cell', async () => {
    const fd = await sheet([
      ['zt1', 9, 'HITACHI', 'No', new Date('2011-07-01T00:00:00Z'), 'UP2', 'DIWALI'],
      ['ZT2', 4, 'DAIKIN', 'YES', 'Pending', '', 'PUJA'],
    ])
    const res = await applyStoreMaster(fd)
    expect(res.error).toBeUndefined()
    expect(res.data).toMatchObject({ updated: 2, created: 0, unchanged: 0 })

    const one = (await store('ZT1'))!
    expect(one).toMatchObject({ ac_total: 9, ac_brand: 'HITACHI', zenatix: false, open_date: '2011-07-01', cluster: 'UP2', festival: 'DIWALI' })
    expect(one.address).toBe('Keep this address') // not in the file: untouched
    expect(one.city).toBe('Old city')
    const two = (await store('ZT2'))!
    expect(two).toMatchObject({ ac_total: 4, zenatix: true, open_date: null })
    expect(two.cluster).toBe('KEEP-ME') // empty cell: not wiped
    expect((await store('ZT3'))!.ac_total).toBeNull() // not in the file
  })

  it('uploading the same file again finds nothing to change', async () => {
    const rows = [['ZT1', 9, 'HITACHI', 'No', new Date('2011-07-01T00:00:00Z'), 'UP2', 'DIWALI']]
    const res = await previewStoreMaster(await sheet(rows))
    expect(res.data).toMatchObject({ willChange: 0, unchanged: 1 })
    expect((await applyStoreMaster(await sheet(rows))).data).toMatchObject({ updated: 0, unchanged: 1 })
  })

  it('a store that is not in CK Desk is added only when asked, and can then be renamed', async () => {
    const rows = [['ZT9', 3, 'LG', 'No', new Date('2020-01-01T00:00:00Z'), 'CH1', '']]
    const skipped = await applyStoreMaster(await sheet(rows))
    expect(skipped.data).toMatchObject({ created: 0, skipped: 1 })
    expect(await store('ZT9')).toBeNull()

    const added = await applyStoreMaster(await sheet(rows, undefined, true))
    expect(added.data).toMatchObject({ created: 1 })
    expect(await store('ZT9')).toMatchObject({ code: 'ZT9', name: 'ZT9', ac_total: 3, cluster: 'CH1', is_active: true })
  })

  it('refuses people who are not admins or managers, and files it cannot read', async () => {
    role.current = 'agent'
    expect((await previewStoreMaster(await sheet([['ZT1', 1, '', '', '', '', '']]))).error).toMatch(/Admin or manager/)
    expect((await applyStoreMaster(await sheet([['ZT1', 1, '', '', '', '', '']]))).error).toMatch(/Admin or manager/)
    role.current = 'admin'
    const fd = new FormData()
    expect((await previewStoreMaster(fd)).error).toMatch(/Choose a file/)
    const unknown = await sheet([['ZT1', 'x']], ['STORE', 'COLOUR'])
    expect((await previewStoreMaster(unknown)).error).toMatch(/None of the columns were recognised/)
  })

  it('reports a bad row without stopping the others', async () => {
    const res = await applyStoreMaster(await sheet([['ZT1', 'lots', 'X', 'No', '', '', ''], ['ZT3', 5, 'LG', 'No', '', '', '']]))
    expect(res.data).toMatchObject({ updated: 1 })
    expect(res.data!.problems.join(' ')).toMatch(/Row 2 \(ZT1\): AC TOTAL "lots" must be a whole number/)
    expect((await store('ZT3'))!.ac_total).toBe(5)
    expect((await store('ZT1'))!.ac_total).toBe(9)
  })
})
