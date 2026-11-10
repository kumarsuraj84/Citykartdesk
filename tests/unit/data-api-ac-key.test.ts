import { describe, it, expect } from 'vitest'
import { acKeyOf, acKeysForRequests } from '@/lib/data-api/ac-key'
import { ENTITIES, entityByName, type Ctx } from '@/lib/data-api/entities'

// A tiny stand-in for the database: every table answers with the rows given, whatever filters are chained on it.
function fakeDb(tables: Record<string, unknown[]>) {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'or', 'neq', 'is', 'order', 'limit']) b[m] = () => b
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null })
    return b
  }
  return { from: (t: string) => builder(tables[t] ?? []) }
}

const AC_CAT = 'cat-ac'
const GEN_CAT = 'cat-gen'
const OTHER_CAT = 'cat-other'
const baseTables = {
  service_categories: [{ id: AC_CAT, auto_oem_kind: null, program_id: 'p-ac' }, { id: GEN_CAT, auto_oem_kind: null, program_id: 'p-gen' }],
  vendor_programs: [{ id: 'p-ac', name: 'AC' }, { id: 'p-gen', name: 'GENSET' }],
}

describe('acKeyOf', () => {
  it('is the store code in capitals, a bar, and the AC number in lower case', () => {
    expect(acKeyOf('abc', ' AC 3 ')).toBe('ABC|ac 3')
    expect(acKeyOf('ABC', 'Server Room AC')).toBe('ABC|server room ac')
  })
  it('is empty when the store or the AC number is missing', () => {
    expect(acKeyOf('', 'AC 1')).toBe('')
    expect(acKeyOf('ABC', '')).toBe('')
    expect(acKeyOf(null, null)).toBe('')
  })
})

describe('acKeysForRequests', () => {
  const rows = [
    { id: 'r1', category_id: AC_CAT, service_id: 's1', requester_id: 'u1' },
    { id: 'r2', category_id: AC_CAT, service_id: 's1', requester_id: 'u2' },
    { id: 'r3', category_id: GEN_CAT, service_id: 's1', requester_id: 'u1' },
    { id: 'r4', category_id: OTHER_CAT, service_id: 's1', requester_id: 'u1' },
  ]
  it('gives a key to the AC tickets that say which AC, from the saved AC copy, and to no other ticket', async () => {
    const db = fakeDb({ ...baseTables, request_master_snapshots: [{ request_id: 'r1', kind: 'ac', snapshot: [{ store_code: 'RBL', ckdesk_no: 'AC 2' }] }, { request_id: 'r3', kind: 'genset', snapshot: [{ store_code: 'RBL' }] }] })
    const out = await acKeysForRequests(db, 'org', rows, new Map([['u1', 'XXX'], ['u2', 'YYY']]))
    expect(out.get('r1')).toBe('RBL|ac 2')   // the store on the AC copy wins over the requester's store
    expect(out.has('r2')).toBe(false)        // an AC ticket without an AC number has no key
    expect(out.has('r3')).toBe(false)        // a genset ticket
    expect(out.has('r4')).toBe(false)        // not an AC category
  })
  it('falls back to the requester\'s store when the AC copy has no store code', async () => {
    const db = fakeDb({ ...baseTables, request_master_snapshots: [{ request_id: 'r2', kind: 'ac', snapshot: [{ ckdesk_no: 'AC 9' }] }] })
    const out = await acKeysForRequests(db, 'org', rows, new Map([['u2', 'yyy']]))
    expect(out.get('r2')).toBe('YYY|ac 9')
  })
  it('does nothing (and reads nothing more) for a page without AC tickets', async () => {
    const db = fakeDb({ ...baseTables })
    const out = await acKeysForRequests(db, 'org', [{ id: 'r4', category_id: OTHER_CAT, service_id: 's1', requester_id: 'u1' }], new Map())
    expect(out.size).toBe(0)
  })
})

describe('the data API entities for the AC heatmap', () => {
  const ctx: Ctx = { storeOfProfile: new Map(), storeCode: new Map() }
  it('a ticket shows its ac_key, or null when there is none', () => {
    const req = entityByName('requests')!
    expect(req.columns.map((c) => c.name)).toContain('ac_key')
    expect(req.map({ id: 'r1', requester_id: 'u1' }, { ...ctx, acKeyOfRequest: new Map([['r1', 'RBL|ac 2']]) }).ac_key).toBe('RBL|ac 2')
    expect(req.map({ id: 'r2', requester_id: 'u1' }, ctx).ac_key).toBeNull()
  })
  it('ac_units is a small full-read list with the Server Room flag and nothing personal', () => {
    const u = entityByName('ac_units')!
    expect(u.mode).toBe('snapshot')
    expect(u.columns.map((c) => c.name).sort()).toEqual(['brand', 'ckdesk_no', 'id', 'is_active', 'is_server_room', 'removed_at', 'store_code', 'tonnage'])
    const out = u.map({ id: 'a1', store_code: 'rbl ', ckdesk_no: 'Server Room AC', brand: 'X', tonnage: '1.5', is_active: true, removed_at: null, serial: 'SECRET-SERIAL', amc_vendor: 'V', emails: ['a@b.test'] }, ctx)
    expect(out).toMatchObject({ store_code: 'RBL', is_server_room: true, removed_at: null })
    expect(JSON.stringify(out)).not.toMatch(/SECRET-SERIAL|a@b\.test/)
    expect(u.map({ id: 'a2', store_code: 'RBL', ckdesk_no: 'AC 1', is_active: true }, ctx).is_server_room).toBe(false)
  })
  it('the Server Room AC is recognised as the AC sheet writes it ("Server Room"), and no ordinary AC is', () => {
    const u = entityByName('ac_units')!
    const flag = (no: string) => u.map({ id: 'a', store_code: 'RBL', ckdesk_no: no, is_active: true }, ctx).is_server_room
    for (const no of ['Server Room', 'server room', ' Server  Room ', 'Server Room AC', 'Server Room 2']) expect(flag(no), no).toBe(true)
    for (const no of ['AC 1', 'AC 12', 'Serverless', 'Reserve Room', 'AC Server Room 1', '']) expect(flag(no), no).toBe(false)
  })
  it('the names stay unique', () => {
    expect(new Set(ENTITIES.map((e) => e.name)).size).toBe(ENTITIES.length)
  })
})
