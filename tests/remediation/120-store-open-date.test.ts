// Saving a store with an open date (the Stores screen's Save button) used to answer "Open date must be a valid date." for every date, because the
// pattern in the check had lost its backslashes. Runs the real create / update actions against the audit database as an administrator.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createStore, updateStore } from '@/lib/actions/admin/org'

vi.setConfig({ testTimeout: 90_000 })
const db = getAdmin()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = db as any
let fx: D03Fixtures
const code = `OD${Date.now().toString(36).toUpperCase().slice(-6)}`
let storeId = ''

beforeAll(async () => { fx = await setupD03Fixtures(); vi.mocked(createClient).mockResolvedValue(clientForToken(fx.admin.accessToken) as never) }, 120_000)
afterAll(async () => { if (storeId) await anyDb.from('stores').delete().eq('id', storeId); await fx?.cleanup() }, 120_000)

describe('saving a store with an open date', () => {
  it('creates a store with an open date, and the date is stored', async () => {
    const r = await createStore({ code, name: 'Open date test', open_date: '2026-10-07', city: 'Sahebganj' })
    expect(r.error).toBeUndefined()
    storeId = r.data!.id
    expect((await anyDb.from('stores').select('open_date').eq('id', storeId).single()).data.open_date).toBe('2026-10-07')
  })
  it('changes the open date and other fields on an existing store (the Save in the screenshot)', async () => {
    expect((await updateStore(storeId, { open_date: '2026-10-08', city: 'Sahebganj', ac_total: 13, cluster: 'JH1', region: 'R2' })).error).toBeUndefined()
    const row = (await anyDb.from('stores').select('open_date, ac_total, cluster, region').eq('id', storeId).single()).data
    expect(row).toMatchObject({ open_date: '2026-10-08', ac_total: 13, cluster: 'JH1', region: 'R2' })
  })
  it('clears the open date when the box is emptied', async () => {
    expect((await updateStore(storeId, { open_date: '' })).error).toBeUndefined()
    expect((await anyDb.from('stores').select('open_date').eq('id', storeId).single()).data.open_date).toBeNull()
  })
  it('still refuses a date that does not exist or is not a date', async () => {
    for (const bad of ['2026-02-30', 'tomorrow', '07-10-2026']) expect((await updateStore(storeId, { open_date: bad })).error, bad).toBe('Open date must be a valid date.')
  })
})
