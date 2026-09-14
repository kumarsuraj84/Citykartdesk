// Stage 2 (WhatsApp readiness) — the sole identity resolver a future
// WhatsApp webhook will call to turn an inbound sender number into a
// Citykart DESK user. Server-only. Does NOT implement the WhatsApp channel
// itself (no webhook, no Meta API call) — only the lookup a later stage's
// webhook handler will call once a message arrives.
//
// Architectural boundary (deliberate, see the Stage 2 report): this
// resolver requires an explicit `orgId` and never performs a global
// mobile-number-only lookup. The same 10-digit number MAY legitimately
// belong to different people in different orgs (this app is multi-tenant —
// see profiles.org_id and the idx_profiles_org_mobile_number_unique
// constraint, which is per-org, not global). A future WhatsApp webhook must
// resolve `orgId` FIRST — from the Intake Channel the inbound message
// arrived on (see intake_channels, already able to carry a per-org
// WhatsApp channel row today) or equivalent per-number/per-channel
// configuration — and only then call this resolver with that org_id. This
// module intentionally does not, and must not, offer a phone-only overload
// that could paper over that step.
//
// The User Master (`profiles`) remains the single source of truth — there
// is no second "WhatsApp users" table to keep in sync. Changing
// profiles.mobile_number immediately changes what this resolver returns for
// both the old and the new number, with nothing else to update.

import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeMobileNumber } from './mobile'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type WhatsAppResolveFailureReason =
  | 'invalid_phone'
  | 'not_registered'
  | 'inactive'
  | 'whatsapp_disabled'

/** Deliberately limited — only what a future requester-identification step
 *  needs, not the full profiles row (no email, no manager_id, etc.). */
export type WhatsAppIdentity = {
  profileId: string
  orgId: string
  fullName: string
  employeeId: string | null
  role: string
  storeId: string | null
  departmentId: string | null
  locationId: string | null
}

export type WhatsAppResolveResult =
  | { ok: true; profile: WhatsAppIdentity }
  | { ok: false; reason: WhatsAppResolveFailureReason }

/**
 * Resolves an inbound WhatsApp sender number to exactly one Citykart DESK
 * user, scoped to the given organisation.
 *
 * Eligibility (all required, checked in this order so the structured
 * failure reason tells the caller exactly what's wrong, without ever
 * revealing whether a *different* org has a matching number — see the
 * Security Review section of the Stage 2 report):
 *   1. the input normalizes to a valid Indian mobile number
 *   2. a profile in `orgId` has that exact profiles.mobile_number
 *   3. that profile is_active
 *   4. that profile has whatsapp_enabled
 *
 * `client` defaults to the service-role admin client — the shape a future
 * webhook handler (no browser session) will actually call this with. Every
 * query is explicitly scoped by `org_id` regardless of which client is
 * passed; this function never relies on RLS for tenant isolation (the admin
 * client bypasses RLS entirely, and even an RLS-scoped client's policies are
 * not this function's contract to depend on).
 */
export async function resolveUserByWhatsAppNumber(params: {
  orgId: string
  phoneNumber: string
  client?: AnyClient
}): Promise<WhatsAppResolveResult> {
  const { orgId, phoneNumber, client } = params
  const db = client ?? createAdminClient()

  const normalized = normalizeMobileNumber(phoneNumber)
  if (!normalized.ok) return { ok: false, reason: 'invalid_phone' }

  const { data: profile } = await db
    .from('profiles')
    .select('id, org_id, full_name, employee_id, role, store_id, department_id, location_id, is_active, whatsapp_enabled')
    .eq('org_id', orgId)
    .eq('mobile_number', normalized.normalized)
    .maybeSingle()

  if (!profile) return { ok: false, reason: 'not_registered' }
  if (!profile.is_active) return { ok: false, reason: 'inactive' }
  if (!profile.whatsapp_enabled) return { ok: false, reason: 'whatsapp_disabled' }

  return {
    ok: true,
    profile: {
      profileId: profile.id,
      orgId: profile.org_id,
      fullName: profile.full_name,
      employeeId: profile.employee_id,
      role: profile.role,
      storeId: profile.store_id,
      departmentId: profile.department_id,
      locationId: profile.location_id,
    },
  }
}
