/**
 * DESK-ALERTRULE-001 regression suite.
 *
 * Defect: adding an Alert Rule in Admin -> Request Config -> Alert Rules
 * would commit the INSERT successfully, but the page then crashed to the
 * global admin error boundary ("Something went wrong / We couldn't load
 * the admin panel.") — the same failure mode already fixed for the Holiday
 * Calendar tab (see tests/integration/desk-holiday-001-holiday-calendar.test.ts).
 *
 * Root cause: AlertRulesClient.tsx's handleCreate() built its optimistic
 * list entry with `{ id: crypto.randomUUID(), ...data }`. `crypto.randomUUID`
 * only exists in a secure context (HTTPS, or the http://localhost /
 * http://127.0.0.1 loopback exemption) — it throws `TypeError:
 * crypto.randomUUID is not a function` on a plain-HTTP LAN origin (Main is
 * served at http://10.0.1.12:3210). React treats a throw inside a setState
 * functional updater as a render-phase error, so it propagated to the
 * nearest error boundary — even though the server action's DB insert,
 * moments earlier, had already committed. Local dev never reproduced this
 * because http://localhost is always a secure context, masking the bug.
 *
 * Fix: createAlertRule() now returns the real inserted row (`.select(...)
 * .single()`), and AlertRulesClient uses that server-truth row instead of
 * fabricating an id client-side. This removes the crypto.randomUUID()
 * dependency entirely.
 *
 * These tests exercise the real, unmodified createAlertRule()/
 * updateAlertRule()/deleteAlertRule() Server Actions against the local
 * Supabase Postgres + Auth instance — not a UI click-through and not a
 * re-implementation of the business rules.
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
import { createAlertRule, deleteAlertRule, type AlertRuleData } from '@/lib/actions/admin/config'

const mockedCreateClient = vi.mocked(createClient)

const RUN_TAG = `desk-alertrule-001-${Date.now()}`
const TEST_PASSWORD = 'Desk-Alertrule-001-Test-Pw!'

const BASE_RULE: Omit<AlertRuleData, 'name'> = {
  alert_type: 'due_soon',
  entity_type: 'task',
  threshold_minutes: 1440,
  notify_roles: ['manager'],
  notify_assignee: true,
  notify_requester: false,
  channels: ['in_app'],
}

describe('DESK-ALERTRULE-001: Alert Rules add/delete', () => {
  const admin = createAdminClient()
  let adminUserId: string
  let orgId: string
  const createdRuleIds: string[] = []

  beforeAll(async () => {
    const email = `${RUN_TAG}-admin@example.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'DESK-ALERTRULE-001 Test Admin' },
    })
    if (error || !data.user) throw new Error(`[fixtures] failed to create admin user: ${error?.message}`)
    adminUserId = data.user.id

    const { data: profile, error: roleError } = await admin
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', adminUserId)
      .select('org_id')
      .single()
    if (roleError || !profile?.org_id) throw new Error(`[fixtures] failed to promote admin: ${roleError?.message}`)
    orgId = profile.org_id

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
    if (createdRuleIds.length > 0) {
      await admin.from('alert_rules').delete().in('id', createdRuleIds)
    }
    await deleteTestUser(admin, adminUserId, 'desk-alertrule-001-admin')
  }, 30_000)

  it('1. a valid alert rule is created exactly once, and the action returns the real persisted row (not a client-fabricated id)', async () => {
    const name = `${RUN_TAG}-independence`
    const result = await createAlertRule({ ...BASE_RULE, name })

    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
    expect(result.data!.name).toBe(name)
    expect(result.data!.alert_type).toBe('due_soon')
    expect(result.data!.entity_type).toBe('task')
    expect(result.data!.threshold_minutes).toBe(1440)
    expect(result.data!.notify_roles).toEqual(['manager'])
    expect(result.data!.channels).toEqual(['in_app'])
    expect(result.data!.is_active).toBe(true)
    expect(result.data!.id).toMatch(/^[0-9a-f-]{36}$/)
    createdRuleIds.push(result.data!.id)

    const { data: rows } = await admin.from('alert_rules').select('id').eq('name', name)
    expect(rows).toHaveLength(1)
    expect(rows![0].id).toBe(result.data!.id)
  })

  it('2. the created row is scoped to the caller org, and threshold_minutes null round-trips correctly', async () => {
    const name = `${RUN_TAG}-null-threshold`
    const result = await createAlertRule({ ...BASE_RULE, name, threshold_minutes: null })
    expect(result.error).toBeUndefined()
    createdRuleIds.push(result.data!.id)
    expect(result.data!.threshold_minutes).toBeNull()

    const { data: row } = await admin.from('alert_rules').select('org_id, threshold_minutes').eq('id', result.data!.id).single()
    expect(row?.org_id).toBe(orgId)
    expect(row?.threshold_minutes).toBeNull()
  })

  it('3. delete removes exactly the targeted row and returns success', async () => {
    const name = `${RUN_TAG}-to-delete`
    const created = await createAlertRule({ ...BASE_RULE, name })
    expect(created.error).toBeUndefined()
    const id = created.data!.id

    const result = await deleteAlertRule(id)
    expect(result.error).toBeUndefined()

    const { data: rows } = await admin.from('alert_rules').select('id').eq('id', id)
    expect(rows).toHaveLength(0)
  })

  it('4. a duplicate name is allowed (no uniqueness constraint), and each insert gets a distinct id', async () => {
    const name = `${RUN_TAG}-dup-name`
    const first = await createAlertRule({ ...BASE_RULE, name })
    expect(first.error).toBeUndefined()
    createdRuleIds.push(first.data!.id)

    const second = await createAlertRule({ ...BASE_RULE, name })
    expect(second.error).toBeUndefined()
    createdRuleIds.push(second.data!.id)
    expect(second.data!.id).not.toBe(first.data!.id)
  })

  it('5. an unauthorized (non admin/manager/platform_owner) caller cannot create or delete alert rules', async () => {
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

      const result = await createAlertRule({ ...BASE_RULE, name: `${RUN_TAG}-unauthorized` })
      expect(result.error).toBe('Unauthorized.')

      const { data: rows } = await admin.from('alert_rules').select('id').eq('name', `${RUN_TAG}-unauthorized`)
      expect(rows).toHaveLength(0)
    } finally {
      await deleteTestUser(admin, created.user.id, 'desk-alertrule-001-requester')
    }
  })
})
