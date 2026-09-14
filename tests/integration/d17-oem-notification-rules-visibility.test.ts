/**
 * D-17 — oems_select and notification_rules_select RLS policies had no role
 * gate at all (org_id = current_org_id() only): any authenticated org
 * member, including a plain 'user'/requester, could read the full OEM
 * vendor email list/templates and the org's internal notification_rules
 * configuration directly. Neither has a plausible end-user read case (both
 * are admin/vendor configuration; every write to both was already
 * admin/manager/platform_owner-only). Fixed via migration
 * 20240101000132_oem_notification_rules_select_role_gate.sql.
 *
 * stores_select is deliberately left untouched (a requester's own store
 * address is used for request-form auto-fill, so unlike oems/
 * notification_rules there's a plausible legitimate end-user read case) —
 * classified BUSINESS DECISION REQUIRED, not fixed in this pass. This test
 * asserts that unchanged behavior explicitly, so a future change here is a
 * deliberate decision, not an accidental regression either way.
 *
 * Reuses the D-03 fixture set purely for its ready-made multi-role identities.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

function clientFor(accessToken: string) {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } }
  )
}

describe('D-17: oems/notification_rules are admin-tier-only; stores is unchanged', () => {
  let fx: D03Fixtures
  let oemId: string
  let storeId: string

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    const admin = getAdmin()
    const { data: oem } = await admin.from('oems').insert({ org_id: fx.orgId, name: 'D-17 Test OEM', emails: ['vendor@example.test'] }).select('id').single()
    oemId = oem!.id
    const { data: store } = await admin.from('stores').insert({ org_id: fx.orgId, code: `D17-${Date.now()}`, name: 'D-17 Test Store' }).select('id').single()
    storeId = store!.id
  }, 60_000)

  afterAll(async () => {
    const admin = getAdmin()
    await admin.from('oems').delete().eq('id', oemId)
    await admin.from('stores').delete().eq('id', storeId)
    await fx.cleanup()
  }, 60_000)

  it('a plain requester cannot read oems', async () => {
    const { data, error } = await clientFor(fx.requesterA.accessToken).from('oems').select('id').eq('id', oemId).maybeSingle()
    expect(data).toBeNull()
    expect(error).toBeNull() // RLS denial is a silent empty result, not a query error
  })

  it('an agent cannot read oems', async () => {
    const { data } = await clientFor(fx.agentA.accessToken).from('oems').select('id').eq('id', oemId).maybeSingle()
    expect(data).toBeNull()
  })

  it('an admin can read oems', async () => {
    const { data } = await clientFor(fx.admin.accessToken).from('oems').select('id').eq('id', oemId).maybeSingle()
    expect(data?.id).toBe(oemId)
  })

  it('a plain requester cannot read notification_rules', async () => {
    const admin = getAdmin()
    await admin.from('notification_rules').upsert({ org_id: fx.orgId, event_type: 'request_resolved', email: true, in_app: true, push: true })
    const { data } = await clientFor(fx.requesterA.accessToken).from('notification_rules').select('event_type').eq('org_id', fx.orgId).maybeSingle()
    expect(data).toBeNull()
  })

  it('a manager can read notification_rules', async () => {
    const { data } = await clientFor(fx.manager.accessToken).from('notification_rules').select('event_type').eq('org_id', fx.orgId).limit(1)
    expect(data).not.toBeNull()
  })

  it('(unchanged) a plain requester can still read stores', async () => {
    const { data } = await clientFor(fx.requesterA.accessToken).from('stores').select('id').eq('id', storeId).maybeSingle()
    expect(data?.id).toBe(storeId)
  })
})
