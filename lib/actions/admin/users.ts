'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { rateLimit } from '@/lib/rate-limit'
import { assertRefsInOrg } from './orgScopeGuard'
import { normalizeMobileNumber } from '@/lib/users/mobile'
import type { UserRole } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: any }

// ── Mobile number helpers (Stage 2) ─────────────────────────────────────────
// Shared by updateUserProfile/inviteUser/bulkCreateUsers below — the only
// three places a profile's mobile_number is ever written. Every write path
// normalizes via lib/users/mobile.ts (never trusts a pre-normalized value
// from the client) and re-checks org-scoped uniqueness in application code
// for a clear error message; idx_profiles_org_mobile_number_unique remains
// the final race-condition guard (see the 23505 handling at each call site).

/** Returns a clear error if `normalizedMobile` already belongs to a
 *  different profile in this org, else null. `excludeUserId` lets an
 *  existing user's edit compare against everyone EXCEPT themselves, so
 *  re-saving their own unchanged number never false-positives. */
async function checkMobileNotTaken(
  admin: AnyClient,
  orgId: string,
  normalizedMobile: string,
  excludeUserId?: string
): Promise<string | null> {
  let query = admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('mobile_number', normalizedMobile)
  if (excludeUserId) query = query.neq('id', excludeUserId)
  const { count } = await query
  if ((count ?? 0) > 0) return 'This mobile number is already registered to another user in this organization.'
  return null
}

// A tenant admin could otherwise grant themselves (or anyone) `platform_owner`
// — a cross-tenant, cross-org role — by simply calling updateUserRole with
// that value, since createAdminClient() bypasses RLS entirely and nothing
// previously checked WHICH role was being assigned, only that the caller had
// *some* elevated role. Only an existing platform_owner may grant admin or
// platform_owner; a plain admin may only assign the ordinary in-org roles.
function assertCanAssignRole(callerRole: UserRole, targetRole: UserRole): string | null {
  if ((targetRole === 'admin' || targetRole === 'platform_owner') && callerRole !== 'platform_owner') {
    return `Only a platform owner can assign the "${targetRole}" role.`
  }
  return null
}

export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin','platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  const roleError = assertCanAssignRole(profile.role, role)
  if (roleError) return { error: roleError }

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .eq('org_id', profile.org_id)

  if (error) return { error: error.message }
  revalidatePath('/admin/users')
  return {}
}

export async function toggleUserActive(
  userId: string,
  isActive: boolean
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin','platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .eq('org_id', profile.org_id)

  if (error) return { error: error.message }
  revalidatePath('/admin/users')
  return {}
}

export async function updateUserProfile(
  userId: string,
  fields: {
    full_name?: string
    job_title?: string | null
    employee_id?: string | null
    department_id?: string | null
    location_id?: string | null
    store_id?: string | null
    cost_center_id?: string | null
    function_id?: string | null
    designation_id?: string | null
    manager_id?: string | null
    /** Raw, human-entered value (e.g. "9876543210" or "+91 98765 43210") —
     *  never a pre-normalized one. `null`/empty clears the number entirely
     *  (mobile_number → NULL), matching the "remove mobile" requirement. */
    mobile_number?: string | null
    whatsapp_enabled?: boolean
  }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient() as unknown as AnyClient

  // createAdminClient() bypasses RLS — without this, nothing stops these ids
  // from pointing at another org's rows. See orgScopeGuard.ts.
  const refError = await assertRefsInOrg(admin, profile.org_id, [
    ...(fields.department_id ? [{ table: 'departments', id: fields.department_id, label: 'department' }] : []),
    ...(fields.location_id ? [{ table: 'locations', id: fields.location_id, label: 'location' }] : []),
    ...(fields.store_id ? [{ table: 'stores', id: fields.store_id, label: 'store' }] : []),
    ...(fields.cost_center_id ? [{ table: 'cost_centers', id: fields.cost_center_id, label: 'cost center' }] : []),
    ...(fields.function_id ? [{ table: 'job_functions', id: fields.function_id, label: 'function' }] : []),
    ...(fields.designation_id ? [{ table: 'designations', id: fields.designation_id, label: 'designation' }] : []),
    ...(fields.manager_id ? [{ table: 'profiles', id: fields.manager_id, label: 'manager' }] : []),
  ])
  if (refError) return { error: refError }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.full_name !== undefined) update.full_name = fields.full_name.trim()
  if ('job_title' in fields) update.job_title = fields.job_title?.trim() || null
  if ('employee_id' in fields) update.employee_id = fields.employee_id?.trim() || null
  if ('department_id' in fields) update.department_id = fields.department_id || null
  if ('location_id' in fields) update.location_id = fields.location_id || null
  if ('store_id' in fields) update.store_id = fields.store_id || null
  if ('cost_center_id' in fields) update.cost_center_id = fields.cost_center_id || null
  if ('function_id' in fields) update.function_id = fields.function_id || null
  if ('designation_id' in fields) update.designation_id = fields.designation_id || null
  if ('manager_id' in fields) update.manager_id = fields.manager_id || null

  // mobile_number is normalized and stored together — there is never a
  // state where the raw input and the stored (normalized) value disagree,
  // because only the normalized value is ever stored. Clearing (empty/null)
  // sets mobile_number → NULL in this same update, atomically with every
  // other field — no separate "clear mobile" action/step exists.
  if ('mobile_number' in fields) {
    const raw = fields.mobile_number?.trim()
    if (!raw) {
      update.mobile_number = null
    } else {
      const normalized = normalizeMobileNumber(raw)
      if (!normalized.ok) return { error: normalized.error }
      const dupError = await checkMobileNotTaken(admin, profile.org_id, normalized.normalized, userId)
      if (dupError) return { error: dupError }
      update.mobile_number = normalized.normalized
    }
  }
  if (fields.whatsapp_enabled !== undefined) update.whatsapp_enabled = fields.whatsapp_enabled

  const { error } = await admin.from('profiles').update(update).eq('id', userId).eq('org_id', profile.org_id)
  if (error) {
    // 23505 = idx_profiles_org_mobile_number_unique caught a race the
    // checkMobileNotTaken() pre-check above missed (two concurrent saves).
    if (error.code === '23505') return { error: 'This mobile number is already registered to another user in this organization.' }
    return { error: error.message }
  }
  revalidatePath('/admin/users')
  return {}
}

export async function setUserTeams(
  userId: string,
  teamIds: string[]
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient() as unknown as AnyClient

  // Target user and every team assigned must belong to the caller's own org.
  const { data: targetUser } = await admin.from('profiles').select('org_id').eq('id', userId).maybeSingle()
  if (!targetUser || targetUser.org_id !== profile.org_id) return { error: 'User not found.' }
  if (teamIds.length > 0) {
    const { count } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('org_id', profile.org_id).in('id', teamIds)
    if ((count ?? 0) !== teamIds.length) return { error: 'One or more teams were not found.' }
  }

  // Replace all team memberships for this user
  const { error: delErr } = await admin.from('team_members').delete().eq('user_id', userId).eq('org_id', profile.org_id)
  if (delErr) return { error: delErr.message }

  if (teamIds.length > 0) {
    const rows = teamIds.map(tid => ({ team_id: tid, user_id: userId, org_id: profile.org_id, is_lead: false }))
    const { error: insErr } = await admin.from('team_members').insert(rows)
    if (insErr) return { error: insErr.message }
  }

  revalidatePath('/admin/users')
  return {}
}

export async function inviteUser(fields: {
  email: string
  full_name: string
  role: UserRole
  department_id?: string | null
  location_id?: string | null
  store_id?: string | null
  manager_id?: string | null
  job_title?: string | null
  team_id?: string | null
  /** Raw, human-entered value — see updateUserProfile()'s matching doc comment. */
  mobile_number?: string | null
  whatsapp_enabled?: boolean
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin','platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!fields.email.trim()) return { error: 'Email is required.' }
  if (!fields.full_name.trim()) return { error: 'Name is required.' }
  const roleError = assertCanAssignRole(profile.role, fields.role)
  if (roleError) return { error: roleError }

  // A compromised admin session could otherwise script this into an
  // email-bombing vector against arbitrary addresses — same rationale as
  // adminSendPasswordReset's limit below.
  const { limited } = await rateLimit(`admin-invite-user:${profile.id}`, 10, 60_000)
  if (limited) return { error: 'Too many invites sent. Please wait a minute.' }

  const admin = createAdminClient() as unknown as AnyClient

  // createAdminClient() bypasses RLS — without this, nothing stops these ids
  // from pointing at another org's rows. Checked before creating the auth
  // user so a bad reference doesn't leave behind an orphaned auth account.
  if (profile.org_id) {
    const refError = await assertRefsInOrg(admin, profile.org_id, [
      ...(fields.department_id ? [{ table: 'departments', id: fields.department_id, label: 'department' }] : []),
      ...(fields.location_id ? [{ table: 'locations', id: fields.location_id, label: 'location' }] : []),
      ...(fields.store_id ? [{ table: 'stores', id: fields.store_id, label: 'store' }] : []),
      ...(fields.manager_id ? [{ table: 'profiles', id: fields.manager_id, label: 'manager' }] : []),
    ])
    if (refError) return { error: refError }
  }

  // Same normalize-validate-dedupe sequence as updateUserProfile(), run
  // before creating the auth account so a bad/duplicate mobile number never
  // leaves behind an orphaned auth user (matching the org-ref-check
  // rationale immediately above).
  let normalizedMobile: string | null = null
  const rawMobile = fields.mobile_number?.trim()
  if (rawMobile) {
    const normalized = normalizeMobileNumber(rawMobile)
    if (!normalized.ok) return { error: normalized.error }
    if (profile.org_id) {
      const dupError = await checkMobileNotTaken(admin, profile.org_id, normalized.normalized)
      if (dupError) return { error: dupError }
    }
    normalizedMobile = normalized.normalized
  }

  // Seat limit check
  if (profile.org_id) {
    const { data: org } = await admin
      .from('organizations')
      .select('seat_limit')
      .eq('id', profile.org_id)
      .maybeSingle()

    if (org?.seat_limit) {
      const { count } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', profile.org_id)
        .eq('is_active', true)

      if ((count ?? 0) >= org.seat_limit) {
        return { error: `Seat limit reached (${org.seat_limit}). Upgrade your plan to invite more users.` }
      }
    }
  }

  // Create auth user + send an invite email with a set-password link
  const { data: authData, error: authErr } = await admin.auth.admin.inviteUserByEmail(
    fields.email.trim().toLowerCase(),
    {
      data: { full_name: fields.full_name.trim() },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password&type=invite`,
    }
  )
  if (authErr) return { error: authErr.message }

  const uid = authData?.user?.id
  if (!uid) return { error: 'Failed to create user.' }

  // Update the auto-created profile row with role + org fields
  const profileUpdate: Record<string, unknown> = {
    role: fields.role,
    full_name: fields.full_name.trim(),
    org_id: profile.org_id,
    updated_at: new Date().toISOString(),
  }
  if (fields.department_id) profileUpdate.department_id = fields.department_id
  if (fields.location_id) profileUpdate.location_id = fields.location_id
  if (fields.store_id) profileUpdate.store_id = fields.store_id
  if (fields.manager_id) profileUpdate.manager_id = fields.manager_id
  if (fields.job_title) profileUpdate.job_title = fields.job_title.trim()
  if (normalizedMobile) profileUpdate.mobile_number = normalizedMobile
  if (fields.whatsapp_enabled !== undefined) profileUpdate.whatsapp_enabled = fields.whatsapp_enabled

  const { error: profileErr } = await admin.from('profiles').update(profileUpdate).eq('id', uid)
  if (profileErr) {
    if (profileErr.code === '23505') return { error: 'This mobile number is already registered to another user in this organization.' }
    return { error: profileErr.message }
  }

  // team_members.org_id is NOT NULL with no DB default — must be set explicitly
  // (matches addTeamMember's fix for the same constraint) or this insert throws
  // and silently leaves the new user with no team, invite result unaffected
  // since the error was previously never even checked.
  if (fields.team_id && profile.org_id) {
    const { error: teamErr } = await admin.from('team_members').insert({ team_id: fields.team_id, user_id: uid, org_id: profile.org_id, is_lead: false })
    if (teamErr) return { error: `User invited, but team assignment failed: ${teamErr.message}` }
  }

  revalidatePath('/admin/users')
  return {}
}

// ── bulkCreateUsers ───────────────────────────────────────────────────────────
// Unlike inviteUser (email-invite, user sets their own password), a bulk
// import creates the account with a password right away — an admin can't
// realistically wait on 50 invite emails — so every bulk-created user is
// flagged must_reset_password so they're forced onto their own password
// before touching the portal.

export type UserImportRow = {
  full_name?: string
  email?: string
  role?: string
  password?: string
  department?: string
  location?: string
  store?: string
  job_title?: string
  employee_id?: string
  manager_email?: string
  mobile_number?: string
  whatsapp_enabled?: string
}

const VALID_IMPORT_ROLES: UserRole[] = ['user', 'agent', 'manager', 'admin', 'platform_owner']
const DEFAULT_BULK_PASSWORD = 'Welcome@123'

/** Same safe, explicit boolean parsing every other import column would want
 *  — only a small known set of strings is accepted; anything else is an
 *  error, never silently coerced (e.g. "maybe" is not falsy-truthy). Empty/
 *  omitted is distinct from "false": it means "leave the column unset",
 *  which for whatsapp_enabled means the schema default (true) applies. */
function parseImportWhatsAppEnabled(raw: string | undefined): { ok: true; value: boolean | undefined } | { ok: false } {
  const trimmed = raw?.trim()
  if (!trimmed) return { ok: true, value: undefined }
  const lower = trimmed.toLowerCase()
  if (['true', 'yes', '1'].includes(lower)) return { ok: true, value: true }
  if (['false', 'no', '0'].includes(lower)) return { ok: true, value: false }
  return { ok: false }
}

export async function bulkCreateUsers(
  rows: UserImportRow[]
): Promise<{ error?: string; data?: { imported: number; errors: string[] } }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  if (rows.length === 0) return { error: 'No rows to import.' }

  const admin = createAdminClient() as unknown as AnyClient
  const orgId = profile.org_id

  const { data: org } = await admin.from('organizations').select('seat_limit').eq('id', orgId).maybeSingle()
  let remainingSeats = Infinity
  if (org?.seat_limit) {
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_active', true)
    remainingSeats = Math.max(0, org.seat_limit - (count ?? 0))
  }

  const [{ data: departmentsData }, { data: locationsData }, { data: storesData }, { data: orgProfiles }, { data: authList }] = await Promise.all([
    admin.from('departments').select('id, name').eq('org_id', orgId),
    admin.from('locations').select('id, name').eq('org_id', orgId),
    admin.from('stores').select('id, code').eq('org_id', orgId),
    admin.from('profiles').select('id, mobile_number').eq('org_id', orgId),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])
  const deptByName = new Map<string, string>(
    (departmentsData ?? []).map((d: { id: string; name: string }) => [d.name.trim().toLowerCase(), d.id])
  )
  const locationByName = new Map<string, string>(
    (locationsData ?? []).map((l: { id: string; name: string }) => [l.name.trim().toLowerCase(), l.id])
  )
  const storeByCode = new Map<string, string>(
    (storesData ?? []).map((s: { id: string; code: string }) => [s.code.trim().toUpperCase(), s.id])
  )
  const orgProfileIds = new Set((orgProfiles ?? []).map((p: { id: string }) => p.id))
  const emailToProfileId = new Map<string, string>(
    ((authList?.users ?? []) as { id: string; email?: string }[])
      .filter((u) => u.email && orgProfileIds.has(u.id))
      .map((u) => [u.email!.trim().toLowerCase(), u.id])
  )
  // Every mobile number already registered to an EXISTING profile in this
  // org — bulkCreateUsers() is create-only (an existing email is always
  // skipped, never updated, see the email-dedupe check below), so unlike
  // updateUserProfile() there is no "does this row's mobile belong to the
  // very profile being edited" self-conflict case to account for here: every
  // row that reaches account creation is, by construction, a brand-new
  // profile.
  const existingMobileNumbers = new Set<string>(
    (orgProfiles ?? [])
      .map((p: { mobile_number: string | null }) => p.mobile_number)
      .filter((m: string | null): m is string => !!m)
  )

  // Pre-pass: normalize every row's mobile number and detect in-CSV
  // duplicates BEFORE any auth account is created — compares NORMALIZED
  // values ("9876543210" and "+919876543210" must collide), and, when two
  // rows collide, blocks BOTH (not just the second) with a message naming
  // both row numbers, matching the department/store/etc. row-level error
  // style already used below.
  const mobileForRow = new Map<number, string>()
  const mobileErrorForRow = new Map<number, string>()
  {
    const firstRowForMobile = new Map<string, number>()
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i].mobile_number?.trim()
      if (!raw) continue
      const normalized = normalizeMobileNumber(raw)
      if (!normalized.ok) { mobileErrorForRow.set(i, normalized.error); continue }
      const firstIdx = firstRowForMobile.get(normalized.normalized)
      if (firstIdx !== undefined) {
        // Each row's own error names the OTHER row (not itself) — the
        // caller prefixes every entry with its own "Row N:" label already
        // (see the errors.push() call site below), so baking "Row N" into
        // this message too would double it up.
        mobileErrorForRow.set(firstIdx, `same mobile number as Row ${i + 2}.`)
        mobileErrorForRow.set(i, `same mobile number as Row ${firstIdx + 2}.`)
        mobileForRow.delete(firstIdx)
      } else {
        firstRowForMobile.set(normalized.normalized, i)
        mobileForRow.set(i, normalized.normalized)
      }
    }
  }

  const errors: string[] = []
  let imported = 0

  for (let i = 0; i < rows.length; i++) {
    const rowLabel = `Row ${i + 2}`
    const row = rows[i]
    const fullName = row.full_name?.trim()
    const email = row.email?.trim().toLowerCase()

    if (!fullName) { errors.push(`${rowLabel}: name is required, skipped.`); continue }
    if (!email) { errors.push(`${rowLabel}: email is required, skipped.`); continue }
    if (emailToProfileId.has(email)) { errors.push(`${rowLabel}: "${email}" already has an account, skipped.`); continue }
    if (imported >= remainingSeats) { errors.push(`${rowLabel}: seat limit reached, skipped.`); continue }

    let role: UserRole = 'user'
    if (row.role?.trim()) {
      const candidate = row.role.trim().toLowerCase() as UserRole
      if (!VALID_IMPORT_ROLES.includes(candidate)) {
        errors.push(`${rowLabel}: role "${row.role}" is invalid, skipped.`)
        continue
      }
      const roleError = assertCanAssignRole(profile.role, candidate)
      if (roleError) { errors.push(`${rowLabel}: ${roleError}`); continue }
      role = candidate
    }

    let departmentId: string | null = null
    if (row.department?.trim()) {
      const found = deptByName.get(row.department.trim().toLowerCase())
      if (!found) { errors.push(`${rowLabel}: department "${row.department}" not found, skipped.`); continue }
      departmentId = found
    }

    let locationId: string | null = null
    if (row.location?.trim()) {
      const found = locationByName.get(row.location.trim().toLowerCase())
      if (!found) { errors.push(`${rowLabel}: location "${row.location}" not found, skipped.`); continue }
      locationId = found
    }

    let storeId: string | null = null
    if (row.store?.trim()) {
      const found = storeByCode.get(row.store.trim().toUpperCase())
      if (!found) { errors.push(`${rowLabel}: store "${row.store}" not found, skipped.`); continue }
      storeId = found
    }

    let managerId: string | null = null
    if (row.manager_email?.trim()) {
      const found = emailToProfileId.get(row.manager_email.trim().toLowerCase())
      if (!found) { errors.push(`${rowLabel}: manager "${row.manager_email}" not found, skipped.`); continue }
      managerId = found
    }

    // Empty mobile_number is allowed (this import has no other requirement
    // forcing it) — only a present-but-invalid or duplicate value blocks the
    // row. mobileErrorForRow covers both "malformed" and "collides with
    // another row in this same file"; existingMobileNumbers covers
    // "collides with an already-registered profile in this org".
    if (mobileErrorForRow.has(i)) { errors.push(`${rowLabel}: ${mobileErrorForRow.get(i)}`); continue }
    const mobileNumber = mobileForRow.get(i) ?? null
    if (mobileNumber && existingMobileNumbers.has(mobileNumber)) {
      errors.push(`${rowLabel}: this mobile number is already assigned to another user, skipped.`)
      continue
    }

    const whatsappParsed = parseImportWhatsAppEnabled(row.whatsapp_enabled)
    if (!whatsappParsed.ok) {
      errors.push(`${rowLabel}: whatsapp_enabled "${row.whatsapp_enabled}" is invalid — use true/false, yes/no, or 1/0.`)
      continue
    }

    const password = row.password?.trim() || DEFAULT_BULK_PASSWORD
    if (password.length < 8) { errors.push(`${rowLabel}: password must be at least 8 characters, skipped.`); continue }

    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (authErr || !authData?.user?.id) {
      errors.push(`${rowLabel}: failed to create account for "${email}" (${authErr?.message ?? 'unknown error'}), skipped.`)
      continue
    }
    const uid = authData.user.id

    const profileUpdate: Record<string, unknown> = {
      role,
      full_name: fullName,
      org_id: orgId,
      must_reset_password: true,
      updated_at: new Date().toISOString(),
    }
    if (departmentId) profileUpdate.department_id = departmentId
    if (locationId) profileUpdate.location_id = locationId
    if (storeId) profileUpdate.store_id = storeId
    if (managerId) profileUpdate.manager_id = managerId
    if (row.job_title?.trim()) profileUpdate.job_title = row.job_title.trim()
    if (row.employee_id?.trim()) profileUpdate.employee_id = row.employee_id.trim()
    if (mobileNumber) profileUpdate.mobile_number = mobileNumber
    if (whatsappParsed.value !== undefined) profileUpdate.whatsapp_enabled = whatsappParsed.value

    const { error: profileErr } = await admin.from('profiles').update(profileUpdate).eq('id', uid)
    if (profileErr) {
      // 23505 = idx_profiles_org_mobile_number_unique — the pre-pass +
      // existingMobileNumbers checks above cover every case derivable from
      // data already read at the start of this call, but a second admin
      // importing a colliding number in a concurrent request is still
      // possible; this is that race's final backstop.
      const reason = profileErr.code === '23505'
        ? 'this mobile number is already assigned to another user'
        : profileErr.message
      errors.push(`${rowLabel}: account created for "${email}" but profile setup failed (${reason}).`)
      continue
    }

    // Available as a manager for any later row in this same batch.
    emailToProfileId.set(email, uid)
    if (mobileNumber) existingMobileNumbers.add(mobileNumber)
    imported++
  }

  revalidatePath('/admin/users')
  return { data: { imported, errors } }
}

// ── adminSendPasswordReset ──────────────────────────────────────────────────
// Sends the same "forgot password" email a user would trigger themselves.

export async function adminSendPasswordReset(email: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!email.trim()) return { error: 'User has no email on file.' }

  // Without a limit, a compromised admin account could script this into an
  // email-bombing vector against arbitrary org members.
  const { limited } = await rateLimit(`admin-password-reset:${profile.id}`, 10, 60_000)
  if (limited) return { error: 'Too many reset emails sent. Please wait a minute.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password&type=recovery`,
  })
  if (error) return { error: error.message }
  return {}
}

// ── adminSetPassword ─────────────────────────────────────────────────────────
// Sets a user's password directly, without requiring them to click an email
// link — useful when email delivery isn't set up, or for a quick in-person reset.
// Also confirms the email: an unconfirmed user can't sign in even with a valid
// password, and an admin directly setting a password is vouching for the account.

export async function adminSetPassword(userId: string, newPassword: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  if (newPassword.length < 8) return { error: 'Password must be at least 8 characters.' }

  const admin = createAdminClient() as unknown as AnyClient

  // auth.users has no org concept — verify the target belongs to the
  // caller's org via profiles before touching their auth record.
  const { data: targetUser } = await admin.from('profiles').select('org_id').eq('id', userId).maybeSingle()
  if (!targetUser || targetUser.org_id !== profile.org_id) return { error: 'User not found.' }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: newPassword,
    email_confirm: true,
  })
  if (error) return { error: error.message }

  // The user never chose this password themselves — force them to set their
  // own on next login before they can use the portal.
  await admin.from('profiles').update({ must_reset_password: true }).eq('id', userId)

  return {}
}
