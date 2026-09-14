/**
 * Stage 6, Part 1 — the channel readiness diagnostic
 * (getWhatsAppChannelReadiness) and the persisted outcome of
 * testWhatsAppConnection() it reads back. Neither had any test coverage
 * before this file: proves CONFIGURED vs VERIFIED are genuinely distinct
 * (a channel with real credentials but no successful test still reports
 * metaConnectionVerified:false), that a successful test persists the
 * non-secret last_test_* fields into config and flips readiness to
 * verified, that a failed test persists last_test_ok:false/last_test_error
 * without ever flipping verified true, and that requesterMobileCoverage
 * counts active users with/without a mobile number correctly.
 *
 * testWhatsAppConnection() builds its own `new WhatsAppGraphClient(...)`
 * with NO fetchImpl argument (lib/actions/intake/whatsapp-channel.ts:231-235),
 * so — unlike processWhatsAppWebhookPayload(), which plumbs an injectable
 * fetchImpl all the way through for exactly this purpose (see
 * stage5-webhook-e2e.test.ts / stage5-outbound-failure.test.ts) — there is
 * no seam to inject a mock Graph client here. Worked around by stubbing the
 * real global `fetch` for the duration of each test and restoring it
 * immediately after (never left stubbed across tests/files).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { getAdmin, createTestUser, clientForToken, type TestUser } from '../setup/fixtures-d03'
import { setupWhatsAppChannelFixture, type WhatsAppChannelFixture } from '../setup/whatsapp-fixtures'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { testWhatsAppConnection, getWhatsAppChannelReadiness } from '@/lib/actions/intake/whatsapp-channel'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

const EXISTING_ORG_ID = '00000000-0000-0000-0000-000000000001'
const RUN_TAG = `stage6-readiness-${Date.now()}`

/** Stubs the real global fetch (see file header) so a test controls exactly
 *  what Meta's phone-number-metadata endpoint returns, then restores it.
 *  Only intercepts calls to graph.facebook.com — testWhatsAppConnection()
 *  runs under a real, RLS-scoped supabase-js client (see actAs()), which
 *  itself uses the global fetch for its own HTTP calls (auth.getUser(),
 *  PostgREST); those must reach the real Supabase instance untouched or
 *  every "acting as" call in this file would break, not just the Graph API
 *  one this stub is meant to fake. */
function stubGraphFetch(response: { status: number; body: unknown }) {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = url.toString()
    if (!u.includes('graph.facebook.com')) return original(url as never, init)
    calls.push(u)
    return new Response(JSON.stringify(response.body), { status: response.status })
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

describe('Stage 6, Part 1 — WhatsApp channel readiness diagnostic', () => {
  const admin = getAdmin()
  let adminUser: TestUser
  let wa: WhatsAppChannelFixture
  let priorIntakeAccess: boolean | null | undefined
  let restoreFetch: (() => void) | null = null

  beforeAll(async () => {
    const { data: prior } = await admin
      .from('org_module_access')
      .select('enabled')
      .eq('org_id', EXISTING_ORG_ID)
      .eq('module', 'intake')
      .maybeSingle()
    priorIntakeAccess = prior?.enabled
    await admin.from('org_module_access').upsert({ org_id: EXISTING_ORG_ID, module: 'intake', enabled: true }, { onConflict: 'org_id,module' })

    adminUser = await createTestUser('stage6-readiness-admin', 'Stage6 Readiness Admin')
    await admin.from('profiles').update({ role: 'admin' }).eq('id', adminUser.id)

    wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: EXISTING_ORG_ID, phoneNumberId: `1555${RUN_TAG.slice(-6)}` })
    actAs(adminUser)
  }, 60_000)

  afterEach(() => {
    restoreFetch?.()
    restoreFetch = null
  })

  afterAll(async () => {
    await wa.cleanup()
    await admin.auth.admin.deleteUser(adminUser.id)
    await admin
      .from('org_module_access')
      .upsert({ org_id: EXISTING_ORG_ID, module: 'intake', enabled: priorIntakeAccess ?? false }, { onConflict: 'org_id,module' })
  }, 60_000)

  it('reports CONFIGURED fields from real channel state before any connection test has ever run', async () => {
    const { readiness, error } = await getWhatsAppChannelReadiness(wa.channelId)
    expect(error).toBeUndefined()
    expect(readiness?.channelConfigured).toBe(true)
    expect(readiness?.channelActive).toBe(true) // setupWhatsAppChannelFixture creates status:'active'
    expect(readiness?.phoneNumberIdConfigured).toBe(true)
    expect(readiness?.credentialsConfigured).toBe(true) // real Vault secret stored by the fixture
    expect(readiness?.wabaIdConfigured).toBe(false) // fixture never sets waba_id

    // CONFIGURED must never be conflated with VERIFIED — no test has run yet.
    expect(readiness?.metaConnectionVerified).toBe(false)
    expect(readiness?.metaConnectionLastTestedAt).toBeNull()
    expect(readiness?.metaConnectionLastError).toBeNull()
    expect(readiness?.metaDisplayPhoneNumber).toBeNull()
    expect(readiness?.metaVerifiedName).toBeNull()
  })

  it('wabaIdConfigured reflects a real waba_id once one is present in config', async () => {
    const { data: channel } = await admin.from('intake_channels').select('config').eq('id', wa.channelId).single()
    await admin.from('intake_channels').update({ config: { ...(channel!.config as object), waba_id: `waba-${RUN_TAG}` } }).eq('id', wa.channelId)

    const { readiness } = await getWhatsAppChannelReadiness(wa.channelId)
    expect(readiness?.wabaIdConfigured).toBe(true)
  })

  it('a successful testConnection() persists last_test_* fields and flips readiness to verified with the real display/verified name', async () => {
    const mock = stubGraphFetch({ status: 200, body: { display_phone_number: '+91 98765 43210', verified_name: 'Citykart Support' } })
    restoreFetch = mock.restore

    const result = await testWhatsAppConnection(wa.channelId)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.displayPhoneNumber).toBe('+91 98765 43210')
      expect(result.verifiedName).toBe('Citykart Support')
    }
    expect(mock.calls.some((u) => u.includes('fields=display_phone_number,verified_name'))).toBe(true)

    const { readiness } = await getWhatsAppChannelReadiness(wa.channelId)
    expect(readiness?.metaConnectionVerified).toBe(true)
    expect(readiness?.metaConnectionLastTestedAt).toBeTruthy()
    expect(readiness?.metaConnectionLastError).toBeNull()
    expect(readiness?.metaDisplayPhoneNumber).toBe('+91 98765 43210')
    expect(readiness?.metaVerifiedName).toBe('Citykart Support')

    const { data: audit } = await admin
      .from('intake_audit_log')
      .select('action, metadata')
      .eq('org_id', EXISTING_ORG_ID)
      .eq('entity_id', wa.channelId)
      .eq('action', 'whatsapp_test_connection_succeeded')
    expect(audit?.length).toBeGreaterThan(0)
  })

  it('a failed testConnection() persists last_test_ok:false/last_test_error and readiness stays unverified with the error surfaced', async () => {
    // Deliberately runs after the success case above (same channel) so this
    // also proves a REGRESSION from verified -> unverified is reported
    // honestly rather than latching the earlier "verified" state.
    const mock = stubGraphFetch({ status: 401, body: { error: { message: 'Error validating access token: Session has expired.' } } })
    restoreFetch = mock.restore

    const result = await testWhatsAppConnection(wa.channelId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Error validating access token: Session has expired.')

    const { readiness } = await getWhatsAppChannelReadiness(wa.channelId)
    expect(readiness?.metaConnectionVerified).toBe(false)
    expect(readiness?.metaConnectionLastTestedAt).toBeTruthy()
    expect(readiness?.metaConnectionLastError).toBe('Error validating access token: Session has expired.')

    const { data: audit } = await admin
      .from('intake_audit_log')
      .select('action, metadata')
      .eq('org_id', EXISTING_ORG_ID)
      .eq('entity_id', wa.channelId)
      .eq('action', 'whatsapp_test_connection_failed')
    expect(audit?.length).toBeGreaterThan(0)
    expect((audit?.[0]?.metadata as { error?: string })?.error).toBe('Error validating access token: Session has expired.')

    // Stage 6 Part 1 bug found by this test, fixed in
    // testWhatsAppConnection()'s failure-path config patch
    // (lib/actions/intake/whatsapp-channel.ts): a channel that starts
    // failing must not go on reporting an earlier success's stale
    // display/verified name next to metaConnectionVerified:false — that is
    // exactly the false-green state the CONFIGURED-vs-VERIFIED diagnostic
    // exists to prevent. Both fields are now cleared alongside the error.
    expect(readiness?.metaDisplayPhoneNumber).toBeNull()
    expect(readiness?.metaVerifiedName).toBeNull()
  })

  it('requesterMobileCoverage counts active users with/without a mobile number correctly', async () => {
    const countActive = async (filter: 'with' | 'without' | 'all') => {
      const { data: activeProfiles } = await admin.from('profiles').select('id').eq('org_id', EXISTING_ORG_ID).eq('is_active', true)
      const activeIds = (activeProfiles ?? []).map((p: { id: string }) => p.id)
      if (filter === 'all') return activeIds.length
      const { data: mobileRows } = activeIds.length
        ? await admin.from('profile_mobile_numbers').select('profile_id').eq('org_id', EXISTING_ORG_ID).in('profile_id', activeIds)
        : { data: [] as { profile_id: string }[] }
      const withCount = new Set((mobileRows ?? []).map((r: { profile_id: string }) => r.profile_id)).size
      return filter === 'with' ? withCount : activeIds.length - withCount
    }
    const beforeAll_ = await countActive('all')
    const beforeWith = await countActive('with')

    const withMobile = await createTestUser('stage6-readiness-mob-with', 'Stage6 Mobile Coverage With')
    const withoutMobile = await createTestUser('stage6-readiness-mob-without', 'Stage6 Mobile Coverage Without')
    await admin.from('profiles').update({ is_active: true }).eq('id', withMobile.id)
    await admin.from('profiles').update({ is_active: true }).eq('id', withoutMobile.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: withMobile.id, org_id: EXISTING_ORG_ID, mobile_number: '9812300001' })

    try {
      const { readiness } = await getWhatsAppChannelReadiness(wa.channelId)
      expect(readiness?.requesterMobileCoverage.activeUsers).toBe(beforeAll_ + 2)
      expect(readiness?.requesterMobileCoverage.activeWithMobile).toBe(beforeWith + 1)
      expect(readiness?.requesterMobileCoverage.activeWithoutMobile).toBe(
        readiness!.requesterMobileCoverage.activeUsers - readiness!.requesterMobileCoverage.activeWithMobile
      )
    } finally {
      await admin.auth.admin.deleteUser(withMobile.id)
      await admin.auth.admin.deleteUser(withoutMobile.id)
    }
  })

  it('a profile with multiple mobile numbers is counted once, not once per number', async () => {
    const twoNumberUser = await createTestUser('stage6-readiness-mob-multi', 'Stage6 Mobile Coverage Multi')
    await admin.from('profiles').update({ is_active: true }).eq('id', twoNumberUser.id)
    await admin.from('profile_mobile_numbers').insert([
      { profile_id: twoNumberUser.id, org_id: EXISTING_ORG_ID, mobile_number: '9812300010' },
      { profile_id: twoNumberUser.id, org_id: EXISTING_ORG_ID, mobile_number: '9812300011' },
    ])

    try {
      const { readiness: before } = await getWhatsAppChannelReadiness(wa.channelId)
      // Remove one of the two numbers — the count must not change, since the
      // profile still has (at least) one number either way.
      await admin.from('profile_mobile_numbers').delete().eq('profile_id', twoNumberUser.id).eq('mobile_number', '9812300011')
      const { readiness: after } = await getWhatsAppChannelReadiness(wa.channelId)
      expect(after?.requesterMobileCoverage.activeWithMobile).toBe(before?.requesterMobileCoverage.activeWithMobile)
    } finally {
      await admin.auth.admin.deleteUser(twoNumberUser.id)
    }
  })
})
