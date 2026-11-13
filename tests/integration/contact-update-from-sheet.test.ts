/**
 * Update employee codes & mobile numbers from a sheet (lib/actions/admin/users.ts: updateUserContactsFromSheet).
 * Real local Supabase, throw-away test users only. The sheet is the truth for those two fields only:
 * a value is written, an empty cell clears it, nothing else of the person changes, nothing is written until apply=true.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, clientForToken, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateUserContactsFromSheet } from '@/lib/actions/admin/users'

const mockedCreateClient = vi.mocked(createClient)
const actAs = (u: TestUser) => mockedCreateClient.mockResolvedValue(clientForToken(u.accessToken) as never)

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const SEED = String(Date.now() % 1_000_000).padStart(6, '0')
let seq = 0
const mobile = () => `9${SEED}${String(++seq).padStart(3, '0')}`

describe('updateUserContactsFromSheet', () => {
  const admin = getAdmin()
  let boss: TestUser, plain: TestUser, fill: TestUser, change: TestUser, clear: TestUser, other: TestUser
  const created: string[] = []
  const nFill = mobile(), nChange = mobile(), nNew = mobile(), nClear = mobile(), nOther = mobile()

  async function mk(label: string, name: string, role: string) {
    const u = await createTestUser(label, name)
    created.push(u.id)
    await admin.from('profiles').update({ role, org_id: ORG_ID, full_name: name }).eq('id', u.id)
    return u
  }
  const prof = async (id: string) => (await admin.from('profiles').select('full_name, role, employee_id, department_id, location_id, store_id, manager_id').eq('id', id).single()).data!
  const numbers = async (id: string) => ((await admin.from('profile_mobile_numbers').select('mobile_number').eq('profile_id', id)).data ?? []).map((r: { mobile_number: string }) => r.mobile_number).sort()

  beforeAll(async () => {
    boss = await mk('cu-admin', 'CU Admin', 'admin')
    plain = await mk('cu-plain', 'CU Plain', 'user')
    fill = await mk('cu-fill', 'CU Fill', 'user')
    change = await mk('cu-change', 'CU Change', 'user')
    clear = await mk('cu-clear', 'CU Clear', 'user')
    other = await mk('cu-other', 'CU Other', 'user')
    await admin.from('profiles').update({ employee_id: 'OLD-CHANGE' }).eq('id', change.id)
    await admin.from('profiles').update({ employee_id: 'OLD-CLEAR' }).eq('id', clear.id)
    await admin.from('profile_mobile_numbers').insert([
      { profile_id: change.id, org_id: ORG_ID, mobile_number: nChange },
      { profile_id: clear.id, org_id: ORG_ID, mobile_number: nClear },
      { profile_id: other.id, org_id: ORG_ID, mobile_number: nOther },
    ])
  }, 120_000)

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id)
  }, 60_000)

  const sheet = () => [
    { email: fill.email, employee_id: 'NEW-FILL', mobile_number: nFill },
    { email: change.email, employee_id: 'NEW-CHANGE', mobile_number: nNew },
    { email: clear.email, employee_id: '', mobile_number: '' },
    { email: 'nobody-here@example.test', employee_id: 'X1', mobile_number: mobile() },
    { email: other.email, employee_id: 'OTHER-1', mobile_number: nChange }, // a number that belongs to somebody else (until "change" gets a new one)
  ]
  const opts = (apply: boolean) => ({ apply, hasEmployeeColumn: true, hasMobileColumn: true })

  it('only an administrator may use it', async () => {
    actAs(plain)
    const r = await updateUserContactsFromSheet(sheet(), opts(false))
    expect(r.error).toBe('Unauthorized.')
  })

  it('the check (apply=false) shows the plan and writes NOTHING', async () => {
    actAs(boss)
    const r = await updateUserContactsFromSheet(sheet(), opts(false))
    expect(r.error).toBeUndefined()
    expect(r.data?.applied).toBe(false)
    expect(r.data?.counts).toMatchObject({ employeeSet: 3, employeeCleared: 1, mobileSet: 2, mobileCleared: 1, notFound: 1 })
    expect((await prof(fill.id)).employee_id).toBeNull()
    expect(await numbers(fill.id)).toEqual([])
    expect((await prof(clear.id)).employee_id).toBe('OLD-CLEAR')
    expect(await numbers(clear.id)).toEqual([nClear])
  })

  it('apply=true: fills, replaces and clears — and touches nothing else of the person', async () => {
    const before = { fill: await prof(fill.id), change: await prof(change.id), clear: await prof(clear.id) }
    actAs(boss)
    const r = await updateUserContactsFromSheet(sheet(), opts(true))
    expect(r.error).toBeUndefined()
    expect(r.data?.failed ?? []).toEqual([])

    expect((await prof(fill.id)).employee_id).toBe('NEW-FILL')
    expect(await numbers(fill.id)).toEqual([nFill])
    expect((await prof(change.id)).employee_id).toBe('NEW-CHANGE')
    expect(await numbers(change.id)).toEqual([nNew])
    expect((await prof(clear.id)).employee_id).toBeNull()
    expect(await numbers(clear.id)).toEqual([])

    // not one other field changed
    for (const [k, id] of [['fill', fill.id], ['change', change.id], ['clear', clear.id]] as const) {
      const after = await prof(id)
      expect({ ...after, employee_id: null }).toEqual({ ...before[k], employee_id: null })
    }
    // the person whose row asked for somebody else's number kept their own
    expect(await numbers(other.id)).toEqual([nOther])
  })

  it('running the same sheet again changes nothing more', async () => {
    actAs(boss)
    const r = await updateUserContactsFromSheet(sheet(), opts(false))
    // the only thing left is the row that was blocked the first time: "change" gave up that number, so it is free now
    expect(r.data?.changes).toEqual([{ email: other.email, field: 'mobile_number', before: nOther, after: nChange }])
  })

  it('a column that is not in the file is never touched (employee codes stay when the file has only mobiles)', async () => {
    actAs(boss)
    const r = await updateUserContactsFromSheet([{ email: fill.email, mobile_number: '' }], { apply: true, hasEmployeeColumn: false, hasMobileColumn: true })
    expect(r.error).toBeUndefined()
    expect(await numbers(fill.id)).toEqual([])
    expect((await prof(fill.id)).employee_id).toBe('NEW-FILL')
  })
})
