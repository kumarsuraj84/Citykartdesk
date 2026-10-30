// The administrator actions changed by the P5 fixes, with the database and the sign-in service replaced by recorders (nothing is contacted):
//   A-05  a reset / e-mail change ends the person's sessions; a bulk reset gives every account its OWN random password
//   A-09  the same password rule on every action that sets a new password
//   A-22  length caps          A-23  a vendor who gets another role loses the vendor link, only after a confirm
//   A-24  an address taken beyond the first 1000 accounts is found, and an unreadable list never means "free"
//   A-06  the sender identity: administrator only, checked
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
const log = { updates: [] as { table: string; values: Row }[], rpcs: [] as [string, Row][], authUpdates: [] as [string, Row][], audits: [] as Row[] }
let currentProfile: Row | null = null
let rowsByTable: Record<string, Row | null> = {}
let listByTable: Record<string, Row[]> = {}
let authUsers: { id: string; email: string }[] = []
let listUsersError = false
let rpcFails = false

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => currentProfile }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ limited: false, remaining: 9 }) }))
vi.mock('@/lib/actions/admin/audit', () => ({ logAdminAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/syslog/audit', () => ({ recordAudit: vi.fn(async (e: Row) => { log.audits.push(e) }) }))
vi.mock('@/lib/email/auth-mail', () => ({ emailPasswordResetLink: vi.fn(), emailInvitation: vi.fn() }))
vi.mock('@/lib/permissions/policies', () => ({
  loadPolicies: async () => ({}),
  requireCapability: async (p: { role: string } | null, cap: string) => (cap === 'mailbox.write' && p?.role !== 'admin' && p?.role !== 'platform_owner' ? 'Unauthorized.' : null),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, in: () => q, neq: () => q, is: () => q, order: () => q, limit: () => q,
        update: (values: Row) => { log.updates.push({ table, values }); return q },
        upsert: (values: Row) => { log.updates.push({ table, values }); return q },
        maybeSingle: async () => ({ data: rowsByTable[table] ?? null, error: null }),
        single: async () => ({ data: rowsByTable[table] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: listByTable[table] ?? [], error: null }),
      }
      return q
    },
    rpc: async (fn: string, args: Row) => { log.rpcs.push([fn, args]); return rpcFails ? { data: null, error: { message: 'no such function' } } : { data: 2, error: null } },
    auth: { admin: {
      updateUserById: async (id: string, attrs: Row) => { log.authUpdates.push([id, attrs]); return { error: null } },
      getUserById: async (id: string) => ({ data: { user: { id, email: 'old@citykart.org' } } }),
      listUsers: async ({ page, perPage }: { page: number; perPage: number }) => (listUsersError && page > 1
        ? { data: null, error: { message: 'upstream 502' } }
        : { data: { users: authUsers.slice((page - 1) * perPage, page * perPage) }, error: null }),
    } },
  }),
}))

const ORG = '00000000-0000-0000-0000-000000000001'
beforeEach(() => {
  log.updates.length = 0; log.rpcs.length = 0; log.authUpdates.length = 0; log.audits.length = 0
  currentProfile = { id: 'admin1', role: 'admin', org_id: ORG }
  rowsByTable = {}; listByTable = {}; authUsers = []; listUsersError = false; rpcFails = false
})

describe('updateUserRole and vendor accounts (A-23)', () => {
  it('a vendor technician is not changed without a confirm, and the answer says so', async () => {
    rowsByTable.profiles = { id: 'v1', role: 'user', org_id: ORG, vendor_company_id: 'co1', vendor_role: 'technician' }
    const { updateUserRole } = await import('@/lib/actions/admin/users')
    const r = await updateUserRole('v1', 'agent')
    expect(r.needsConfirm).toBe(true)
    expect(r.error).toMatch(/vendor technician.*removes their vendor access/)
    expect(log.updates).toEqual([])
  })
  it('with the confirm the role changes and the vendor columns are cleared in the same save', async () => {
    rowsByTable.profiles = { id: 'v1', role: 'user', org_id: ORG, vendor_company_id: 'co1', vendor_role: 'technician' }
    const { updateUserRole } = await import('@/lib/actions/admin/users')
    expect((await updateUserRole('v1', 'agent', { confirmRemoveVendorAccess: true })).error).toBeUndefined()
    expect(log.updates[0].values).toMatchObject({ role: 'agent', vendor_company_id: null, vendor_role: null })
    expect(log.audits[0]).toMatchObject({ action: 'user.role_changed', before: { vendor_company_id: 'co1' } })
  })
  it('an ordinary account, and a vendor staying a plain user, are unaffected', async () => {
    rowsByTable.profiles = { id: 'u1', role: 'user', org_id: ORG, vendor_company_id: null, vendor_role: null }
    const { updateUserRole } = await import('@/lib/actions/admin/users')
    expect((await updateUserRole('u1', 'agent')).error).toBeUndefined()
    expect(log.updates[0].values).not.toHaveProperty('vendor_company_id')
    rowsByTable.profiles = { id: 'v1', role: 'user', org_id: ORG, vendor_company_id: 'co1', vendor_role: 'manager' }
    log.updates.length = 0
    expect((await updateUserRole('v1', 'user')).error).toBeUndefined()
    expect(log.updates[0].values).not.toHaveProperty('vendor_company_id')
  })
})

describe('adminSetPassword (A-05, A-09)', () => {
  it('refuses a weak password before touching anything', async () => {
    rowsByTable.profiles = { id: 'u1', role: 'user', org_id: ORG }
    const { adminSetPassword } = await import('@/lib/actions/admin/users')
    expect((await adminSetPassword('u1', 'short1')).error).toMatch(/at least 10/)
    expect((await adminSetPassword('u1', 'alllowercaseletters')).error).toMatch(/too simple/)
    expect(log.authUpdates).toEqual([])
  })
  it('sets the password, forces a change and ends every session of the person', async () => {
    rowsByTable.profiles = { id: 'u1', role: 'user', org_id: ORG }
    const { adminSetPassword } = await import('@/lib/actions/admin/users')
    expect(await adminSetPassword('u1', 'Temp-Pass#2026')).toEqual({})
    expect(log.authUpdates[0][0]).toBe('u1')
    expect(log.rpcs).toEqual([['revoke_user_sessions', { p_user_id: 'u1' }]])
  })
  it('still succeeds, with a warning, when the sessions could not be ended (the migration is not applied yet)', async () => {
    rowsByTable.profiles = { id: 'u1', role: 'user', org_id: ORG }
    rpcFails = true
    const { adminSetPassword } = await import('@/lib/actions/admin/users')
    const r = await adminSetPassword('u1', 'Temp-Pass#2026')
    expect(r.error).toBeUndefined()
    expect(r.warning).toMatch(/sessions could not be ended/)
  })
})

describe('resetPasswordsBatch (A-05)', () => {
  it('gives every account its OWN random password, returns them once, and ends the sessions of each', async () => {
    listByTable.profiles = [{ id: 'a', full_name: 'Asha' }, { id: 'b', full_name: 'Bala' }, { id: 'c', full_name: 'Chitra' }]
    authUsers = [{ id: 'a', email: 'asha@citykart.org' }, { id: 'b', email: 'bala@citykart.org' }, { id: 'c', email: 'chitra@citykart.org' }]
    const { resetPasswordsBatch } = await import('@/lib/actions/admin/users')
    const r = await resetPasswordsBatch(['a', 'b', 'c'], 'Ignored#Typed123')
    expect(r.error).toBeUndefined()
    expect(r.succeeded).toBe(3)
    const passwords = r.credentials!.map((c) => c.password)
    expect(new Set(passwords).size).toBe(3)                              // never one shared password
    expect(passwords).not.toContain('Ignored#Typed123')                  // the typed argument is no longer used
    for (const p of passwords) expect(p.length).toBeGreaterThanOrEqual(12)
    expect(r.credentials!.find((c) => c.full_name === 'Asha')).toMatchObject({ email: 'asha@citykart.org' })
    expect(log.authUpdates.map(([id, a]) => [id, a.password])).toEqual(r.credentials!.map((c, i) => [['a', 'b', 'c'][i], c.password]))
    expect(log.rpcs.map(([fn, a]) => `${fn}:${a.p_user_id}`).sort()).toEqual(['revoke_user_sessions:a', 'revoke_user_sessions:b', 'revoke_user_sessions:c'])
    expect(log.updates.find((u) => u.table === 'profiles')?.values).toEqual({ must_reset_password: true })
  })
  it('still validates the batch', async () => {
    const { resetPasswordsBatch } = await import('@/lib/actions/admin/users')
    expect((await resetPasswordsBatch([])).error).toMatch(/no users/i)
    expect((await resetPasswordsBatch(Array.from({ length: 41 }, (_, i) => `u${i}`))).error).toMatch(/at most/i)
  })
})

describe('updateUserEmail (A-05, A-24)', () => {
  beforeEach(() => { rowsByTable.profiles = { id: 'u1', role: 'user', org_id: ORG, full_name: 'Uma' } })
  it('finds an address that is taken beyond the first 1000 accounts', async () => {
    authUsers = Array.from({ length: 1500 }, (_, i) => ({ id: `x${i}`, email: `person${i}@citykart.org` }))
    const { updateUserEmail } = await import('@/lib/actions/admin/users')
    expect((await updateUserEmail('u1', 'Person1400@citykart.org')).error).toBe('Another account already uses this e-mail address.')
    expect(log.authUpdates).toEqual([])
  })
  it('does NOT go ahead when the account list cannot be read to the end (it used to answer "free")', async () => {
    authUsers = Array.from({ length: 1500 }, (_, i) => ({ id: `x${i}`, email: `person${i}@citykart.org` }))
    listUsersError = true
    const { updateUserEmail } = await import('@/lib/actions/admin/users')
    const r = await updateUserEmail('u1', 'brand.new@citykart.org')
    expect(r.error).toMatch(/Could not check whether another account uses this e-mail address/)
    expect(log.authUpdates).toEqual([])
  })
  it('changes the address and ends the sessions of the person', async () => {
    const { updateUserEmail } = await import('@/lib/actions/admin/users')
    const r = await updateUserEmail('u1', 'brand.new@citykart.org')
    expect(r.error).toBeUndefined()
    expect(log.authUpdates[0]).toEqual(['u1', { email: 'brand.new@citykart.org', email_confirm: true }])
    expect(log.rpcs.map(([fn]) => fn)).toContain('revoke_user_sessions')
  })
})

describe('length caps (A-22)', () => {
  it('a name over 120 characters is refused by the profile editor', async () => {
    const { updateUserProfile } = await import('@/lib/actions/admin/users')
    expect((await updateUserProfile('u1', { full_name: 'x'.repeat(121) })).error).toMatch(/at most 120/)
    expect((await updateUserProfile('u1', { job_title: 'x'.repeat(121) })).error).toMatch(/Job title/)
    expect((await updateUserProfile('u1', { employee_id: 'x'.repeat(61) })).error).toMatch(/Employee id/)
    expect(log.updates).toEqual([])
  })
})

describe('updateEmailFromSettings (A-06)', () => {
  it('a manager may not change the sender identity; an administrator may', async () => {
    const { updateEmailFromSettings } = await import('@/lib/actions/admin/config')
    currentProfile = { id: 'm1', role: 'manager', org_id: ORG }
    expect((await updateEmailFromSettings('Citykart Desk', 'desk@citykart.org')).error).toBe('Unauthorized.')
    currentProfile = { id: 'a1', role: 'admin', org_id: ORG }
    expect((await updateEmailFromSettings('Citykart Desk', 'desk@citykart.org')).error).toBeUndefined()
    expect(log.updates.at(-1)?.values).toEqual([{ key: 'email_from_name', value: 'Citykart Desk' }, { key: 'email_from_address', value: 'desk@citykart.org' }])
  })
  it('refuses header-breaking names and malformed or over-long addresses, but still allows blank (use the mailbox default)', async () => {
    const { updateEmailFromSettings } = await import('@/lib/actions/admin/config')
    currentProfile = { id: 'a1', role: 'admin', org_id: ORG }
    for (const [n, a] of [['Desk\r\nBcc: x@y.z', 'a@b.co'], ['Desk <x>', 'a@b.co'], ['x'.repeat(81), 'a@b.co'], ['Desk', 'not-an-address'], ['Desk', 'a b@c.co'], ['Desk', `${'x'.repeat(200)}@b.co`], ['Desk', 'a@b.co>\r\nBcc: z@z.zz']]) {
      expect((await updateEmailFromSettings(n, a)).error, `${n} / ${a}`).toBeTruthy()
    }
    expect(log.updates).toEqual([])
    expect((await updateEmailFromSettings('', '')).error).toBeUndefined()
  })
})
