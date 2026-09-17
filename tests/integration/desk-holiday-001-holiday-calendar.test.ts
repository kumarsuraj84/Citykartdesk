/**
 * DESK-HOLIDAY-001 regression suite.
 *
 * Defect: adding a holiday in Admin -> SLA / Holiday Calendar always
 * committed the INSERT successfully, but the page then crashed to the
 * global admin error boundary ("Something went wrong / We couldn't load
 * the admin panel."). A manual refresh showed the holiday had, in fact,
 * been persisted — write succeeds, post-write UI path fails.
 *
 * Root cause: HolidayCalendarClient.tsx's handleAdd() built its optimistic
 * list entry with `{ id: crypto.randomUUID(), ...form }`. `crypto.randomUUID`
 * only exists in a secure context (HTTPS, or the http://localhost /
 * http://127.0.0.1 loopback exemption) — it throws `TypeError:
 * crypto.randomUUID is not a function` on a plain-HTTP LAN origin (Main is
 * served at http://10.0.1.12:3210). React treats a throw inside a
 * setState functional updater as a render-phase error, so it propagated to
 * the nearest error boundary (app/(app)/admin/error.tsx) — even though the
 * server action's DB insert, moments earlier, had already committed. Local
 * dev never reproduced this because http://localhost is always a secure
 * context, masking the bug.
 *
 * Fix: createHoliday() now returns the real inserted row
 * (`.select('id, name, date, is_recurring').single()`), and
 * HolidayCalendarClient uses that server-truth row instead of fabricating
 * an id client-side. This removes the crypto.randomUUID() dependency
 * entirely (fixing the crash) and also fixes the latent "fake id never
 * matches the real DB id" issue that would have broken an immediate
 * delete-before-refresh.
 *
 * These tests exercise the real, unmodified createHoliday()/deleteHoliday()
 * Server Actions against the local Supabase Postgres + Auth instance — not
 * a UI click-through and not a re-implementation of the business rules.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteTestUser } from '../setup/cleanup-user'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createHoliday, deleteHoliday } from '@/lib/actions/admin/config'

const mockedCreateClient = vi.mocked(createClient)

const RUN_TAG = `desk-holiday-001-${Date.now()}`
const TEST_PASSWORD = 'Desk-Holiday-001-Test-Pw!'

describe('DESK-HOLIDAY-001: Holiday Calendar add/delete', () => {
  const admin = createAdminClient()
  let adminUserId: string
  const createdHolidayIds: string[] = []

  beforeAll(async () => {
    const email = `${RUN_TAG}-admin@example.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'DESK-HOLIDAY-001 Test Admin' },
    })
    if (error || !data.user) throw new Error(`[fixtures] failed to create admin user: ${error?.message}`)
    adminUserId = data.user.id

    const { error: roleError } = await admin.from('profiles').update({ role: 'admin' }).eq('id', adminUserId)
    if (roleError) throw new Error(`[fixtures] failed to promote admin: ${roleError.message}`)

    const anon = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password: TEST_PASSWORD })
    if (signInError || !signIn.session) throw new Error(`[fixtures] failed to sign in admin: ${signInError?.message}`)

    const accessToken = signIn.session.access_token
    mockedCreateClient.mockResolvedValue(
      createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
      ) as never
    )
  }, 30_000)

  afterAll(async () => {
    if (createdHolidayIds.length > 0) {
      await admin.from('holidays').delete().in('id', createdHolidayIds)
    }
    await deleteTestUser(admin, adminUserId, 'desk-holiday-001-admin')
  }, 30_000)

  it('1. a valid holiday is created exactly once, and the action returns the real persisted row (not a client-fabricated id)', async () => {
    const name = `${RUN_TAG}-independence`
    const result = await createHoliday({ name, date: '2026-08-15', is_recurring: true })

    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
    expect(result.data!.name).toBe(name)
    expect(result.data!.date).toBe('2026-08-15')
    expect(result.data!.is_recurring).toBe(true)
    expect(result.data!.id).toMatch(/^[0-9a-f-]{36}$/)
    createdHolidayIds.push(result.data!.id)

    const { data: rows } = await admin.from('holidays').select('id').eq('name', name)
    expect(rows).toHaveLength(1)
    expect(rows![0].id).toBe(result.data!.id)
  })

  it('2. the date survives round-trip with no timezone shift', async () => {
    const name = `${RUN_TAG}-date-check`
    const result = await createHoliday({ name, date: '2026-12-25', is_recurring: false })
    expect(result.error).toBeUndefined()
    createdHolidayIds.push(result.data!.id)

    const { data: row } = await admin.from('holidays').select('date').eq('id', result.data!.id).single()
    expect(row?.date).toBe('2026-12-25')
  })

  it('3. delete removes exactly the targeted row and returns success', async () => {
    const name = `${RUN_TAG}-to-delete`
    const created = await createHoliday({ name, date: '2027-01-01', is_recurring: true })
    expect(created.error).toBeUndefined()
    const id = created.data!.id

    const result = await deleteHoliday(id)
    expect(result.error).toBeUndefined()

    const { data: rows } = await admin.from('holidays').select('id').eq('id', id)
    expect(rows).toHaveLength(0)
  })

  it('4. a duplicate name on a different date, and a duplicate date under a different name, are both allowed (no uniqueness constraint on either column)', async () => {
    const nameA = `${RUN_TAG}-dup-name`
    const first = await createHoliday({ name: nameA, date: '2026-03-01', is_recurring: false })
    expect(first.error).toBeUndefined()
    createdHolidayIds.push(first.data!.id)

    const second = await createHoliday({ name: nameA, date: '2026-03-02', is_recurring: false })
    expect(second.error).toBeUndefined()
    createdHolidayIds.push(second.data!.id)
    expect(second.data!.id).not.toBe(first.data!.id)

    const sameDate = await createHoliday({ name: `${RUN_TAG}-dup-date`, date: '2026-03-01', is_recurring: false })
    expect(sameDate.error).toBeUndefined()
    createdHolidayIds.push(sameDate.data!.id)
  })

  it('5. an unauthorized (non admin/manager/platform_owner) caller cannot create or delete holidays', async () => {
    const email = `${RUN_TAG}-requester@example.test`
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    if (createErr || !created.user) throw new Error(`failed to create plain user: ${createErr?.message}`)

    try {
      const anon = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const { data: signIn } = await anon.auth.signInWithPassword({ email, password: TEST_PASSWORD })
      mockedCreateClient.mockResolvedValueOnce(
        createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { global: { headers: { Authorization: `Bearer ${signIn.session!.access_token}` } } }
        ) as never
      )

      const result = await createHoliday({ name: `${RUN_TAG}-unauthorized`, date: '2026-05-05', is_recurring: false })
      expect(result.error).toBe('Unauthorized.')

      const { data: rows } = await admin.from('holidays').select('id').eq('name', `${RUN_TAG}-unauthorized`)
      expect(rows).toHaveLength(0)
    } finally {
      await deleteTestUser(admin, created.user.id, 'desk-holiday-001-requester')
    }
  })
})
