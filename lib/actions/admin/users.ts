'use server'

import { generateOneTimePassword } from '@/lib/auth/one-time-password'
import { findAuthUserByEmail, listAuthEmails, listAuthIdsByEmail } from '@/lib/auth/emails'
import { revokeAllSessions } from '@/lib/auth/sessions'
import { validateNewPassword } from '@/lib/security/password-policy'
import { revalidatePath } from 'next/cache'
import { targetGuardError } from '@/lib/admin/target-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { rateLimit } from '@/lib/rate-limit'
import { assertRefsInOrg } from './orgScopeGuard'
import { emailPasswordResetLink, emailInvitation } from '@/lib/email/auth-mail'
import { logAdminAudit } from './audit'
import { recordAudit } from '@/lib/syslog/audit'
import { BULK_RESET_BATCH_SIZE, BULK_RESET_ROLES } from '@/lib/users/bulk-reset'
import { normalizeMobileNumber } from '@/lib/users/mobile'
import { isUsableEmail, describeEmailUpdates, type EmailChangeCounts } from '@/lib/users/email-change'
import { toCSV } from '@/lib/export/csv'
import { USER_EXPORT_COLUMNS, buildUsersExportRows, type ExportProfile } from '@/lib/export/users'
import type { UserRole } from '@/types'
import { inBatches, inBatchesDo } from '@/lib/queries/in-batches'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { loadCcBook, resetCcBookCache } from '@/lib/requests/cc-recipients'
import { organisationMailDomains, isOrganisationAddress } from '@/lib/email/org-domains'
import { loadPolicies } from '@/lib/permissions/policies'
import { exportAllowed, auditExportEvent, EXPORT_LIMIT_MESSAGE } from '@/lib/security/export-guard'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: any; rpc: (fn: string, args: Record<string, unknown>) => any }

// ── Mobile number helpers (Stage 2, extended for many-numbers-per-profile
// by migration 20240101000140) ──────────────────────────────────────────────
// A number lives in profile_mobile_numbers, not a profiles column — several
// numbers can point at the same profile (a shared "store" login used by
// several people's phones). Every write path still normalizes via
// lib/users/mobile.ts (never trusts a pre-normalized value from the client)
// and re-checks org-scoped uniqueness in application code for a clear error
// message; idx_profile_mobile_numbers_org_mobile_unique remains the final
// race-condition guard (see the 23505 handling at each call site).

/** Returns a clear error if `normalizedMobile` is already registered in
 *  this org, else null. `forProfileId`, when given, distinguishes "already
 *  on a DIFFERENT profile" (a real conflict) from "already on THIS profile"
 *  (a harmless duplicate-add attempt — still surfaced as a friendly error
 *  rather than a silent no-op, so the caller/UI doesn't need special-case
 *  handling for it). */
async function checkMobileNotTaken(
  admin: AnyClient,
  orgId: string,
  normalizedMobile: string,
  forProfileId?: string
): Promise<string | null> {
  const { data: existing } = await admin
    .from('profile_mobile_numbers')
    .select('profile_id')
    .eq('org_id', orgId)
    .eq('mobile_number', normalizedMobile)
    .maybeSingle()
  if (!existing) return null
  if (forProfileId && existing.profile_id === forProfileId) {
    return 'This number is already added to this user.'
  }
  return 'This mobile number is already registered to another user in this organization.'
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
  role: UserRole,
  // A vendor technician / manager is a normal 'user' account linked to a vendor company. Giving such a person any other role ends that link, so it needs a
  // deliberate yes (audit A-23). The screen sends this only after asking.
  opts: { confirmRemoveVendorAccess?: boolean } = {}
): Promise<{ error?: string; needsConfirm?: boolean }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin','platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  const roleError = assertCanAssignRole(profile.role, role)
  if (roleError) return { error: roleError }

  const admin = createAdminClient()
  // D-009: the person being changed matters too, not only the role being given
  const { data: target } = await admin.from('profiles').select('id, role, org_id, vendor_company_id, vendor_role').eq('id', userId).eq('org_id', profile.org_id).maybeSingle()
  if (!target) return { error: 'User not found.' }
  const guard = targetGuardError({ id: profile.id, role: profile.role }, { id: target.id, role: target.role }, 'role')
  if (guard) return { error: guard }
  // The database allows the vendor link only on a plain 'user' account, so a vendor who gets another role must lose the link in the same save (before this the
  // save simply failed with a database error). It is never done silently: see opts above.
  const leavesVendor = !!target.vendor_company_id && role !== 'user'
  if (leavesVendor && !opts.confirmRemoveVendorAccess) {
    return { error: `This person is a vendor ${target.vendor_role ?? 'user'}. Changing their role to "${role}" removes their vendor access (the link to their vendor company). Confirm to continue.`, needsConfirm: true }
  }
  const { error } = await admin
    .from('profiles')
    .update({ role, updated_at: new Date().toISOString(), ...(leavesVendor ? { vendor_company_id: null, vendor_role: null } : {}) })
    .eq('id', userId)
    .eq('org_id', profile.org_id)

  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/users.ts' }) }
  await recordAudit({ category: 'security', action: 'user.role_changed', entityType: 'user', entityId: userId, before: { role: target.role, ...(leavesVendor ? { vendor_company_id: target.vendor_company_id, vendor_role: target.vendor_role } : {}) }, after: { role, ...(leavesVendor ? { vendor_company_id: null, vendor_role: null } : {}) }, actorId: profile.id, orgId: profile.org_id })
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
  // D-009: only a platform owner may deactivate an admin / platform owner, and nobody deactivates themselves
  const { data: target } = await admin.from('profiles').select('id, role, org_id').eq('id', userId).eq('org_id', profile.org_id).maybeSingle()
  if (!target) return { error: 'User not found.' }
  const guard = targetGuardError({ id: profile.id, role: profile.role }, { id: target.id, role: target.role }, 'active')
  if (guard) return { error: guard }
  const { error } = await admin
    .from('profiles')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .eq('org_id', profile.org_id)

  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/users.ts' }) }
  // D-010: the flag alone never stopped anyone signing in. Block (or restore) sign-in at the authentication service as well, so a
  // deactivated person cannot log in again or renew their session.
  const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: isActive ? 'none' : '876000h' })
  if (banError) return { error: `The account was marked ${isActive ? 'active' : 'inactive'}, but its sign-in could not be ${isActive ? 'restored' : 'blocked'}: ${banError.message}` }
  await recordAudit({ category: 'security', action: isActive ? 'user.reactivated' : 'user.deactivated', entityType: 'user', entityId: userId, before: { is_active: !isActive }, after: { is_active: isActive }, actorId: profile.id, orgId: profile.org_id })
  revalidatePath('/admin/users')
  return {}
}

const MAX_NAME_LENGTH = 120
const MAX_JOB_TITLE_LENGTH = 120
const MAX_EMPLOYEE_ID_LENGTH = 60

/** The first too-long text among the profile fields, as a sentence, or null. */
function profileTextLengthError(f: { full_name?: string | null; job_title?: string | null; employee_id?: string | null }): string | null {
  if (typeof f.full_name === 'string' && f.full_name.trim().length > MAX_NAME_LENGTH) return `Name must be at most ${MAX_NAME_LENGTH} characters.`
  if (typeof f.job_title === 'string' && f.job_title.trim().length > MAX_JOB_TITLE_LENGTH) return `Job title must be at most ${MAX_JOB_TITLE_LENGTH} characters.`
  if (typeof f.employee_id === 'string' && f.employee_id.trim().length > MAX_EMPLOYEE_ID_LENGTH) return `Employee id must be at most ${MAX_EMPLOYEE_ID_LENGTH} characters.`
  return null
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
    whatsapp_enabled?: boolean
  }
): Promise<{ error?: string; warning?: string; note?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  // Length caps (audit A-22): these end up in headers, lists, e-mails and PDFs
  const lengthError = profileTextLengthError(fields)
  if (lengthError) return { error: lengthError }

  const admin = createAdminClient() as unknown as AnyClient

  // Who may change whom (VAPT VA-ADM-05): only a platform owner edits an administrator or platform owner; a manager does not set reporting lines
  // (the line manager gets to read that person's tickets).
  {
    const { data: who } = await admin.from('profiles').select('id, role, org_id').eq('id', userId).maybeSingle()
    if (!who || who.org_id !== profile.org_id) return { error: 'User not found.' }
    const guard = targetGuardError({ id: profile.id, role: profile.role }, { id: who.id, role: who.role }, 'profile')
    if (guard) return { error: guard }
    if ('manager_id' in fields && profile.role === 'manager') return { error: 'Only an administrator can set who a person reports to.' }
  }

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

  if (fields.whatsapp_enabled !== undefined) update.whatsapp_enabled = fields.whatsapp_enabled

  // A store's login is named after the store (the store NLD logs in as "NLD"). When such a login is renamed, the store itself is renamed with it,
  // otherwise the Stores list and the store-wise reports would keep showing the old code.
  let storeToRename: { id: string; code: string; name: string } | null = null
  const newName = fields.full_name?.trim()
  if (newName) {
    const { data: before } = await admin.from('profiles').select('full_name, store_id').eq('id', userId).eq('org_id', profile.org_id).maybeSingle()
    const oldName = (before?.full_name ?? '').trim()
    const storeChangedInThisSave = 'store_id' in fields && (fields.store_id || null) !== (before?.store_id ?? null)
    if (before?.store_id && oldName && oldName.toLowerCase() !== newName.toLowerCase() && !storeChangedInThisSave) {
      const { data: st } = await admin.from('stores').select('id, code, name').eq('id', before.store_id).eq('org_id', profile.org_id).maybeSingle()
      if (st && st.code.trim().toLowerCase() === oldName.toLowerCase()) storeToRename = st
    }
  }

  const { error } = await admin.from('profiles').update(update).eq('id', userId).eq('org_id', profile.org_id)
  if (error) {
    return { error: sanitizeError(error, { route: 'lib/actions/admin/users.ts' }) }
  }

  let note: string | undefined
  let warning: string | undefined
  if (storeToRename && newName) {
    const newCode = newName.toUpperCase()
    const { error: storeError } = await admin.from('stores').update({
      code: newCode,
      // the store's name follows when it was just the old code
      name: storeToRename.name.trim().toLowerCase() === storeToRename.code.trim().toLowerCase() ? newName : storeToRename.name,
    }).eq('id', storeToRename.id).eq('org_id', profile.org_id)
    if (storeError) {
      warning = storeError.code === '23505'
        ? `The name was changed, but another store already has the code ${newCode}, so the store ${storeToRename.code} was not renamed. Rename it in Organization Structure → Stores.`
        : `The name was changed, but the store ${storeToRename.code} could not be renamed. Rename it in Organization Structure → Stores.`
    } else {
      note = `The store ${storeToRename.code} was renamed ${newCode}, so its tickets and reports show ${newCode}.`
      revalidatePath('/admin/org')
    }
  }
  // Tickets, comments, reports and lists show a person's name from their profile, so a new name appears everywhere by itself. The sign-in
  // account keeps its own copy of the name; keep that in step (a failure here changes nothing the person sees).
  if (fields.full_name !== undefined && fields.full_name.trim()) {
    try {
      const { data: acct } = await admin.auth.admin.getUserById(userId)
      if (acct?.user) {
        await admin.auth.admin.updateUserById(userId, { user_metadata: { ...(acct.user.user_metadata ?? {}), full_name: fields.full_name.trim() } })
      }
    } catch { /* best effort */ }
  }
  revalidatePath('/admin/users')
  return { ...(note ? { note } : {}), ...(warning ? { warning } : {}) }
}

/** Adds one mobile number to a profile (many:1 — a profile can have several
 *  numbers, e.g. every cashier's phone for a shared store login). Numbers
 *  2+ are added here rather than through updateUserProfile() because the
 *  admin UI's chip editor adds/removes one at a time, not a whole-list
 *  replace — see keen-mapping-adleman.md for why. */
export async function addMobileNumber(
  userId: string,
  rawMobileNumber: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const normalized = normalizeMobileNumber(rawMobileNumber)
  if (!normalized.ok) return { error: normalized.error }

  const admin = createAdminClient() as unknown as AnyClient

  // Target must belong to caller's org — createAdminClient() bypasses RLS.
  const { data: target } = await admin.from('profiles').select('id, org_id, role').eq('id', userId).maybeSingle()
  if (!target || target.org_id !== profile.org_id) return { error: 'User not found.' }
  const phoneGuard = targetGuardError({ id: profile.id, role: profile.role }, { id: target.id, role: target.role }, 'phone')
  if (phoneGuard) return { error: phoneGuard }

  const dupError = await checkMobileNotTaken(admin, profile.org_id, normalized.normalized, userId)
  if (dupError) return { error: dupError }

  const { error } = await admin.from('profile_mobile_numbers').insert({
    profile_id: userId,
    org_id: profile.org_id,
    mobile_number: normalized.normalized,
  })
  if (error) {
    // 23505 = idx_profile_mobile_numbers_org_mobile_unique caught a race the
    // checkMobileNotTaken() pre-check above missed (two concurrent adds).
    if (error.code === '23505') return { error: 'This mobile number is already registered to another user in this organization.' }
    return { error: sanitizeError(error, { route: 'lib/actions/admin/users.ts' }) }
  }
  await recordAudit({ category: 'security', action: 'user.mobile_added', entityType: 'user', entityId: userId, after: { mobile_number: normalized.normalized }, actorId: profile.id, orgId: profile.org_id })
  revalidatePath('/admin/users')
  return {}
}

/** Removes one mobile number from a profile. Removing a number that isn't
 *  actually on this profile is a harmless no-op (DELETE matches zero rows),
 *  not an error — mirrors ordinary idempotent-delete behavior elsewhere in
 *  this codebase. */
export async function removeMobileNumber(
  userId: string,
  mobileNumber: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: who } = await admin.from('profiles').select('id, role, org_id').eq('id', userId).maybeSingle()
  if (!who || who.org_id !== profile.org_id) return { error: 'User not found.' }
  const phoneGuard = targetGuardError({ id: profile.id, role: profile.role }, { id: who.id, role: who.role }, 'phone')
  if (phoneGuard) return { error: phoneGuard }
  await recordAudit({ category: 'security', action: 'user.mobile_removed', entityType: 'user', entityId: userId, before: { mobile_number: mobileNumber }, actorId: profile.id, orgId: profile.org_id })
  const { error } = await admin
    .from('profile_mobile_numbers')
    .delete()
    .eq('profile_id', userId)
    .eq('org_id', profile.org_id)
    .eq('mobile_number', mobileNumber)
  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/users.ts' }) }
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
  const { data: targetUser } = await admin.from('profiles').select('org_id, role').eq('id', userId).maybeSingle()
  if (!targetUser || targetUser.org_id !== profile.org_id) return { error: 'User not found.' }
  const teamsGuard = targetGuardError({ id: profile.id, role: profile.role }, { id: userId, role: targetUser.role }, 'teams')
  if (teamsGuard) return { error: teamsGuard }
  // Technician groups are for technicians/admins to work tickets as a group —
  // a requester has no use for one, so this is enforced here too, not just
  // hidden client-side (e.g. a stale selection from before a role downgrade).
  if (targetUser.role === 'user') teamIds = []
  if (teamIds.length > 0) {
    const { count } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('org_id', profile.org_id).in('id', teamIds)
    if ((count ?? 0) !== teamIds.length) return { error: 'One or more technician groups were not found.' }
  }

  // Replace all team memberships for this user
  const { error: delErr } = await admin.from('team_members').delete().eq('user_id', userId).eq('org_id', profile.org_id)
  if (delErr) return { error: sanitizeError(delErr, { route: 'lib/actions/admin/users.ts' }) }

  if (teamIds.length > 0) {
    const rows = teamIds.map(tid => ({ team_id: tid, user_id: userId, org_id: profile.org_id, is_lead: false }))
    const { error: insErr } = await admin.from('team_members').insert(rows)
    if (insErr) return { error: sanitizeError(insErr, { route: 'lib/actions/admin/users.ts' }) }
  }

  await recordAudit({ action: 'user.teams_set', entityType: 'user', entityId: userId, after: { team_ids: teamIds }, actorId: profile.id, orgId: profile.org_id })
  revalidatePath('/admin/users')
  return {}
}

/** A step after the account was created failed (D-048): remove the new account again so no half-set-up user is left behind (its profile goes with it). */
async function undoInvite(admin: AnyClient, userId: string): Promise<void> {
  try { await admin.auth.admin.deleteUser(userId) } catch { /* nothing more can be done; the error the admin sees is the original one */ }
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
  team_ids?: string[]
  /** Raw, human-entered value (e.g. "9876543210" or "+91 98765 43210") —
   *  never a pre-normalized one. This is the account's FIRST mobile number;
   *  additional numbers (e.g. the rest of a shared store login's phones)
   *  are added afterward via addMobileNumber() on the user's edit screen —
   *  the invite/CSV-import flows only ever set one number at creation. */
  mobile_number?: string | null
  whatsapp_enabled?: boolean
}): Promise<{ error?: string; warning?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin','platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!fields.email.trim()) return { error: 'Email is required.' }
  if (!fields.full_name.trim()) return { error: 'Name is required.' }
  const lengthError = profileTextLengthError(fields)
  if (lengthError) return { error: lengthError }
  const roleError = assertCanAssignRole(profile.role, fields.role)
  if (roleError) return { error: roleError }

  // Technician groups are for technicians/admins to work tickets as a group —
  // a requester has no use for one, so this is enforced here too, not just
  // hidden client-side.
  if (fields.role === 'user') fields.team_ids = []

  // A compromised admin session could otherwise script this into an
  // email-bombing vector against arbitrary addresses — same rationale as
  // adminSendPasswordReset's limit below.
  const { limited } = await rateLimit(`admin-invite-user:${profile.id}`, 10, 60_000)
  if (limited) return { error: 'Too many invites sent. Please wait a minute.' }

  // An address outside the organisation's own mail domain(s): refused when the owner has switched that on, and always written to the audit trail (VAPT-052).
  const domains = await organisationMailDomains()
  const external = domains.length > 0 && !isOrganisationAddress(fields.email, domains)
  if (external && (await loadPolicies()).external_invites === 'org_domains_only') {
    return { error: 'Invitations can only be sent to addresses at the company mail domain (' + domains.join(', ') + ').' }
  }

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

    if (fields.team_ids?.length) {
      const { count } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('org_id', profile.org_id).in('id', fields.team_ids)
      if ((count ?? 0) !== fields.team_ids.length) return { error: 'One or more technician groups were not found.' }
    }
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
  const { data: authData, error: authErr } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: fields.email.trim().toLowerCase(),
    options: { data: { full_name: fields.full_name.trim() } },
  })
  if (authErr) return { error: sanitizeError(authErr, { route: 'lib/actions/admin/users.ts' }) }
  const inviteTokenHash: string | undefined = authData?.properties?.hashed_token

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
  if (fields.whatsapp_enabled !== undefined) profileUpdate.whatsapp_enabled = fields.whatsapp_enabled

  const { error: profileErr } = await admin.from('profiles').update(profileUpdate).eq('id', uid)
  if (profileErr) {
    await undoInvite(admin, uid)
    return { error: sanitizeError(profileErr, { route: 'lib/actions/admin/users.ts' }) }
  }

  // Attach the first mobile number, if any, as its own step AFTER role/
  // department/etc. already committed above — unlike the old combined
  // profileUpdate write, a rare concurrent-duplicate race here only fails
  // the mobile attachment, not the whole invite.
  if (normalizedMobile && profile.org_id) {
    const { error: mobileErr } = await admin.from('profile_mobile_numbers').insert({
      profile_id: uid,
      org_id: profile.org_id,
      mobile_number: normalizedMobile,
    })
    if (mobileErr) {
      await undoInvite(admin, uid)
      if (mobileErr.code === '23505') return { error: 'This mobile number is already registered to another user in this organization.' }
      return { error: sanitizeError(mobileErr, { route: 'lib/actions/admin/users.ts' }) }
    }
  }

  // team_members.org_id is NOT NULL with no DB default — must be set explicitly
  // (matches addTeamMember's fix for the same constraint) or this insert throws
  // and silently leaves the new user with no team, invite result unaffected
  // since the error was previously never even checked.
  if (fields.team_ids?.length && profile.org_id) {
    const rows = fields.team_ids.map(tid => ({ team_id: tid, user_id: uid, org_id: profile.org_id, is_lead: false }))
    const { error: teamErr } = await admin.from('team_members').insert(rows)
    if (teamErr) return { error: `User invited, but technician group assignment failed: ${teamErr.message}` }
  }

  resetCcBookCache()
  await recordAudit({ action: 'user.invited', entityType: 'user', entityId: uid, entityLabel: fields.email, after: { email: fields.email, role: profileUpdate.role, team_ids: fields.team_ids ?? [], ...(external ? { external_domain: true } : {}) }, actorId: profile.id, orgId: profile.org_id })
  revalidatePath('/admin/users')

  // The account is fully set up — now email the "set your password" link through the
  // app's own mailbox. If no mailbox is configured yet the invite still succeeds.
  if (inviteTokenHash) {
    const mail = await emailInvitation(fields.email, inviteTokenHash, fields.full_name.trim())
    if (mail.error) return { warning: 'User created, but the invitation email could not be sent. Use "Send password reset" on the user to email them a link.' }
  }
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
// There is no shared default password any more (VAPT-003): an account without a password in the file gets its own random one-time password (shown to the administrator
// once) or, in invitation mode, a set-your-password e-mail. Either way the account is flagged "must change password".

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

export type BulkOnboarding = 'random_password' | 'invite'
export type BulkCredential = { email: string; full_name: string; password: string }

export async function bulkCreateUsers(
  rows: UserImportRow[],
  options: { onboarding?: BulkOnboarding } = {}
): Promise<{ error?: string; data?: { imported: number; errors: string[]; credentials?: BulkCredential[]; invited?: number } }> {
  const onboarding: BulkOnboarding = options.onboarding === 'invite' ? 'invite' : 'random_password'
  const credentials: BulkCredential[] = []
  let invited = 0
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

  const [{ data: departmentsData }, { data: locationsData }, { data: storesData }, { data: orgProfiles }, { data: orgMobileNumbers }] = await Promise.all([
    admin.from('departments').select('id, name').eq('org_id', orgId),
    admin.from('locations').select('id, name').eq('org_id', orgId),
    admin.from('stores').select('id, code').eq('org_id', orgId),
    admin.from('profiles').select('id').eq('org_id', orgId),
    admin.from('profile_mobile_numbers').select('mobile_number').eq('org_id', orgId),
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
  const orgProfileIds = new Set<string>((orgProfiles ?? []).map((p: { id: string }) => p.id))
  // Every sign-in account, every page (this used to read the first 1000 only, so an existing person beyond that was not recognised and the import tried
  // to create a duplicate). If the list cannot be read to the end the import does not start: a half-known list would be the same mistake again.
  const existingAccounts = await listAuthIdsByEmail(admin, orgProfileIds)
  if (!existingAccounts.ok) return { error: `The list of existing accounts could not be read (${existingAccounts.error}). Nothing was imported; please try again.` }
  const emailToProfileId = existingAccounts.value
  // Every mobile number already registered to ANY existing profile in this
  // org (regardless of how many numbers that profile already has) —
  // bulkCreateUsers() is create-only (an existing email is always skipped,
  // never updated, see the email-dedupe check below), so unlike
  // updateUserProfile()/addMobileNumber() there is no "does this row's
  // mobile belong to the very profile being edited" self-conflict case to
  // account for here: every row that reaches account creation is, by
  // construction, a brand-new profile.
  const existingMobileNumbers = new Set<string>(
    (orgMobileNumbers ?? [])
      .map((m: { mobile_number: string }) => m.mobile_number)
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
    const rowLengthError = profileTextLengthError({ full_name: fullName, job_title: row.job_title, employee_id: row.employee_id })
    if (rowLengthError) { errors.push(`${rowLabel}: ${rowLengthError.replace(/\.$/, '')}, skipped.`); continue }
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

    const givenPassword = row.password?.trim() || ''
    const givenPasswordError = givenPassword ? validateNewPassword(givenPassword) : null
    if (givenPasswordError) { errors.push(`${rowLabel}: ${givenPasswordError}, skipped.`); continue }
    // a password typed in the file is used as is (and must be changed at first sign-in); otherwise the account gets its own random password
    const password = givenPassword || generateOneTimePassword()

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
    if (whatsappParsed.value !== undefined) profileUpdate.whatsapp_enabled = whatsappParsed.value

    const { error: profileErr } = await admin.from('profiles').update(profileUpdate).eq('id', uid)
    if (profileErr) {
      errors.push(`${rowLabel}: account created for "${email}" but profile setup failed (${profileErr.message}).`)
      continue
    }

    if (mobileNumber) {
      const { error: mobileErr } = await admin.from('profile_mobile_numbers').insert({
        profile_id: uid,
        org_id: orgId,
        mobile_number: mobileNumber,
      })
      if (mobileErr) {
        // 23505 = idx_profile_mobile_numbers_org_mobile_unique — the
        // pre-pass + existingMobileNumbers checks above cover every case
        // derivable from data already read at the start of this call, but a
        // second admin importing a colliding number in a concurrent request
        // is still possible; this is that race's final backstop.
        const reason = mobileErr.code === '23505'
          ? 'this mobile number is already assigned to another user'
          : mobileErr.message
        errors.push(`${rowLabel}: account created for "${email}" but mobile number setup failed (${reason}).`)
        continue
      }
    }

    // Available as a manager for any later row in this same batch.
    emailToProfileId.set(email, uid)
    if (mobileNumber) existingMobileNumbers.add(mobileNumber)
    imported++
    if (!givenPassword) {
      if (onboarding === 'invite') {
        // nobody knows the random password: the person sets their own through the e-mailed link
        const mail = await emailPasswordResetLink(email)
        if (mail.error) errors.push(`${rowLabel}: account created for "${email}" but the set-password e-mail could not be sent (${mail.error}). Use "Send password reset" on the user.`)
        else invited++
      } else {
        credentials.push({ email, full_name: fullName, password })
      }
    }
  }

  await recordAudit({ action: 'user.bulk_imported', entityType: 'user', message: `${imported} users imported, ${errors.length} rows with errors`, after: { imported, rowErrors: errors.length }, actorId: profile.id, orgId })
  revalidatePath('/admin/users')
  return { data: { imported, errors, ...(credentials.length ? { credentials } : {}), ...(invited ? { invited } : {}) } }
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

  // Only an existing, active user of the administrator's own organisation (VAPT-052 / VA-ADM-16): a reset link is never mailed to an address that is not one of
  // the organisation's people, so this cannot be used to send mail from the company mailbox to arbitrary addresses.
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  const book = await loadCcBook(profile.org_id)
  if (book.get(email.trim().toLowerCase())?.kind !== 'user') return { error: 'That address does not belong to an active user of your organisation.' }

  const { error } = await emailPasswordResetLink(email)
  await recordAudit({ category: 'security', action: 'user.password_reset_sent', outcome: error ? 'failure' : 'success', entityType: 'user', entityLabel: email, actorId: profile.id, orgId: profile.org_id })
  if (error) return { error }
  return {}
}

// ── updateUserEmail ──────────────────────────────────────────────────────────
// Changes the e-mail address a person signs in with (and receives mail at), for when theirs has changed. The e-mail lives only in the
// sign-in account, so this is the one place to change it; the password and everything else stay as they are. The new address is
// marked confirmed (an admin is vouching for it), so the person can sign in with it straight away and the old address stops working.

/**
 * Whether any account (in any organisation: sign-in addresses are shared by the whole system) already uses this address.
 * 'unknown' when the list could not be read to the end: the caller must then NOT go ahead (this used to answer "free" after 50 pages, i.e. failed open).
 */
async function emailInUse(admin: AnyClient, email: string): Promise<boolean | 'unknown'> {
  const r = await findAuthUserByEmail(admin, email)
  if (!r.ok) return 'unknown'
  return r.value !== null
}

export async function updateUserEmail(userId: string, newEmail: string): Promise<{ error?: string; email?: string; warning?: string; updated?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const email = newEmail.trim().toLowerCase()
  if (!email) return { error: 'Enter the new e-mail address.' }
  if (!isUsableEmail(email)) return { error: 'This does not look like an e-mail address.' }
  // changing your own sign-in address from here is easy to get wrong (a typo locks you out): ask another admin
  if (userId === profile.id) return { error: 'Ask another admin to change your own e-mail address.' }

  const admin = createAdminClient() as unknown as AnyClient

  // auth.users has no org concept: the person must belong to the caller's organisation
  const { data: target } = await admin.from('profiles').select('org_id, role, full_name').eq('id', userId).maybeSingle()
  if (!target || target.org_id !== profile.org_id) return { error: 'User not found.' }
  // changing someone's e-mail is a way into their account (then "forgot password"), so an admin or owner's address
  // can only be changed by a platform owner, the same rule as granting those roles
  if ((target.role === 'admin' || target.role === 'platform_owner') && profile.role !== 'platform_owner') {
    return { error: 'Only a platform owner can change the e-mail address of an admin or platform owner.' }
  }

  const { data: current } = await admin.auth.admin.getUserById(userId)
  const oldEmail = (current?.user?.email ?? '').toLowerCase()
  if (!current?.user) return { error: 'User not found.' }
  if (oldEmail === email) return { error: 'This is already their e-mail address.' }

  // the sign-in service answers a duplicate with a generic failure, so check it here to say what is wrong
  const taken = await emailInUse(admin, email)
  if (taken === 'unknown') return { error: 'Could not check whether another account uses this e-mail address (the sign-in service did not give its list). Nothing was changed; please try again.' }
  if (taken) return { error: 'Another account already uses this e-mail address.' }

  const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true })
  if (error) {
    // (a second admin saving the same address at the same moment lands here too)
    return { error: 'The e-mail address could not be changed. If another account uses it, choose a different one.' }
  }
  // Whoever was signed in under the old address (the previous owner of it, or a thief of a session) must not stay in (audit A-05).
  const endedSessions = await revokeAllSessions(admin, userId)

  // the old address is now gone from the sign-in account: take it out of every other place that kept a copy as well
  let counts: EmailChangeCounts | null = null
  let copyError: string | null = null
  if (oldEmail) {
    const { data, error: rpcError } = await admin.rpc('replace_user_email', { p_org_id: profile.org_id, p_old: oldEmail, p_new: email })
    if (rpcError) copyError = rpcError.message ?? 'unknown error'
    else counts = (data ?? {}) as EmailChangeCounts
  }

  await logAdminAudit({
    orgId: profile.org_id, actorId: profile.id, entityType: 'user', entityId: userId, action: 'user_email_changed',
    metadata: { from: oldEmail, to: email, name: target.full_name ?? null, updated: counts, copyError },
  })
  revalidatePath('/admin/users')
  const sessionWarning = endedSessions === null ? ' Their existing sessions could not be ended; ask them to sign out and in again.' : ''
  if (copyError) {
    return { email, warning: `The sign-in e-mail was changed, but the old address could not be replaced everywhere else (OEM lists, rules, reports). Please tell the system administrator.${sessionWarning}` }
  }
  return { email, updated: describeEmailUpdates(counts), ...(sessionWarning ? { warning: sessionWarning.trim() } : {}) }
}

// ── adminSetPassword ─────────────────────────────────────────────────────────
// Sets a user's password directly, without requiring them to click an email
// link — useful when email delivery isn't set up, or for a quick in-person reset.
// Also confirms the email: an unconfirmed user can't sign in even with a valid
// password, and an admin directly setting a password is vouching for the account.

export async function adminSetPassword(userId: string, newPassword: string): Promise<{ error?: string; warning?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  const policyError = validateNewPassword(newPassword)
  if (policyError) return { error: policyError }

  const admin = createAdminClient() as unknown as AnyClient

  // auth.users has no org concept — verify the target belongs to the
  // caller's org via profiles before touching their auth record.
  const { data: targetUser } = await admin.from('profiles').select('id, role, org_id').eq('id', userId).maybeSingle()
  if (!targetUser || targetUser.org_id !== profile.org_id) return { error: 'User not found.' }
  // D-009: an admin must not be able to set a platform owner's (or another admin's) password and sign in as them
  const guard = targetGuardError({ id: profile.id, role: profile.role }, { id: targetUser.id, role: targetUser.role }, 'password')
  if (guard) return { error: guard }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: newPassword,
    email_confirm: true,
  })
  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/users.ts' }) }

  // The user never chose this password themselves — force them to set their
  // own on next login before they can use the portal.
  await admin.from('profiles').update({ must_reset_password: true }).eq('id', userId)

  // sessions opened with the OLD password must not live on after an administrator's reset (audit A-05)
  const ended = await revokeAllSessions(admin, userId)

  await recordAudit({ category: 'security', action: 'user.password_set_by_admin', entityType: 'user', entityId: userId, message: 'An administrator set a temporary password; the person must choose their own', detail: { sessionsEnded: ended }, actorId: profile.id, orgId: profile.org_id })
  return ended === null ? { warning: "The password was set, but the person's existing sessions could not be ended." } : {}
}

// ── Export ────────────────────────────────────────────────────────────────────
// Admin-only, same gate as bulkCreateUsers(). Returns CSV text for the client to
// download (same shape as the other Export buttons). Exports every user in the
// org — the on-screen search filter is a view aid, not an export scope.

export async function exportUsersCsv(): Promise<string> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) throw new Error('Unauthorized.')
  if (!profile.org_id) throw new Error('Your account is not linked to an organisation.')

  if (!(await exportAllowed(profile.id, 'users'))) throw new Error(EXPORT_LIMIT_MESSAGE)
  await auditExportEvent(profile, 'users', null)
  const admin = createAdminClient() as unknown as AnyClient
  const orgId = profile.org_id

  const [profiles, departments, locations, stores, jobFunctions, designations, costCenters, mobiles, teamMembers] = await Promise.all([
    admin.from('profiles').select('id, full_name, role, is_active, whatsapp_enabled, job_title, employee_id, department_id, location_id, store_id, manager_id, function_id, designation_id, cost_center_id, created_at').eq('org_id', orgId).order('full_name'),
    admin.from('departments').select('id, name').eq('org_id', orgId),
    admin.from('locations').select('id, name').eq('org_id', orgId),
    admin.from('stores').select('id, code').eq('org_id', orgId),
    admin.from('job_functions').select('id, name').eq('org_id', orgId),
    admin.from('designations').select('id, name').eq('org_id', orgId),
    admin.from('cost_centers').select('id, name').eq('org_id', orgId),
    admin.from('profile_mobile_numbers').select('profile_id, mobile_number').eq('org_id', orgId),
    admin.from('team_members').select('user_id, team:teams (name)').eq('org_id', orgId),
  ])
  if (profiles.error) throw new Error('Failed to load users.')

  const orgProfileIds = new Set(((profiles.data ?? []) as { id: string }[]).map((p) => p.id))
  // every page of the account list; an export with missing e-mail addresses must not look complete
  const emails = await listAuthEmails(admin, orgProfileIds)
  if (!emails.ok) throw new Error('Failed to load users.')
  const emailById = emails.value

  const mobileNumbersById = new Map<string, string[]>()
  for (const m of (mobiles.data ?? []) as { profile_id: string; mobile_number: string }[]) {
    mobileNumbersById.set(m.profile_id, [...(mobileNumbersById.get(m.profile_id) ?? []), m.mobile_number])
  }
  const teamNamesById = new Map<string, string[]>()
  for (const t of (teamMembers.data ?? []) as { user_id: string; team: { name: string } | null }[]) {
    if (t.team?.name) teamNamesById.set(t.user_id, [...(teamNamesById.get(t.user_id) ?? []), t.team.name])
  }

  const rows = buildUsersExportRows({
    profiles: (profiles.data ?? []) as ExportProfile[],
    emailById,
    departments: departments.data ?? [],
    locations: locations.data ?? [],
    stores: stores.data ?? [],
    jobFunctions: jobFunctions.data ?? [],
    designations: designations.data ?? [],
    costCenters: costCenters.data ?? [],
    mobileNumbersById,
    teamNamesById,
  })
  await recordAudit({ action: 'user.export_csv', entityType: 'user', message: `${rows.length} users exported`, after: { rows: rows.length }, actorId: profile.id, orgId })
  return toCSV(rows, USER_EXPORT_COLUMNS)
}

// ── Bulk password reset ───────────────────────────────────────────────────────
// Sets one temporary password on many accounts at once and flags each so the person
// must choose their own at their next page load (the same must_reset_password flow
// adminSetPassword() uses). Admin / platform owner only, org-scoped, never the caller's
// own account (so nobody locks themselves out), active users only, and never admins or
// platform owners (only ordinary users, agents and managers). Processed in small
// batches so the UI can show progress and a slow auth server can't time out one giant
// request. The temporary password is never logged or stored by us.

const BULK_RESET_CONCURRENCY = 5

/** Who a bulk reset would touch: every active user, agent and manager in the org (not admins / platform owners, not the caller). */
export async function listPasswordResetTargets(): Promise<{ error?: string; ids?: string[] }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .eq('org_id', profile.org_id)
    .eq('is_active', true)
    .in('role', BULK_RESET_ROLES)
    .neq('id', profile.id)
  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/users.ts' }) }
  return { ids: ((data ?? []) as { id: string }[]).map((r) => r.id) }
}

// Every account gets its OWN random temporary password (audit A-05): one password shared by many accounts meant that anyone who learned it could sign in to
// every account that had not yet changed it, and then choose a new password there. The passwords are returned ONCE, in `credentials` (same shape as the
// bulk import: e-mail, name, password) for the administrator to hand over; they are not stored or logged. The old `newPassword` argument is kept so existing
// callers still compile, but it is no longer used.
export async function resetPasswordsBatch(
  userIds: string[],
  _newPassword?: string // eslint-disable-line @typescript-eslint/no-unused-vars -- deprecated, see above
): Promise<{ error?: string; succeeded?: number; failed?: { id: string; name?: string; error: string }[]; credentials?: BulkCredential[]; warning?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  if (!Array.isArray(userIds) || userIds.length === 0) return { error: 'No users selected.' }
  if (userIds.length > BULK_RESET_BATCH_SIZE) return { error: `At most ${BULK_RESET_BATCH_SIZE} users per batch.` }

  const admin = createAdminClient() as unknown as AnyClient

  // Re-derive the allowed set on the server — never trust the ids the browser sent.
  const { data: allowedRows } = await inBatches(userIds, (batch) => admin
    .from('profiles')
    .select('id, full_name')
    .eq('org_id', profile.org_id)
    .eq('is_active', true)
    .in('role', BULK_RESET_ROLES)
    .neq('id', profile.id)
    .in('id', batch))
  const nameById = new Map(((allowedRows ?? []) as { id: string; full_name: string }[]).map((r) => [r.id, r.full_name]))
  const allowed = [...nameById.keys()]

  const failed: { id: string; name?: string; error: string }[] = userIds
    .filter((id) => !nameById.has(id))
    .map((id) => ({ id, error: 'Not eligible (must be an active user, agent or manager of this organisation).' }))
  const succeededIds: string[] = []
  const issued = new Map<string, string>()   // id -> the password just set
  const emailByAccount = await listAuthEmails(admin, allowed)

  for (let i = 0; i < allowed.length; i += BULK_RESET_CONCURRENCY) {
    const chunk = allowed.slice(i, i + BULK_RESET_CONCURRENCY)
    const results = await Promise.all(
      chunk.map(async (id) => {
        const password = generateOneTimePassword()
        const { error } = await admin.auth.admin.updateUserById(id, { password, email_confirm: true })
        if (!error) issued.set(id, password)
        return { id, error: error?.message ?? null }
      })
    )
    for (const r of results) {
      if (r.error) failed.push({ id: r.id, name: nameById.get(r.id), error: r.error })
      else succeededIds.push(r.id)
    }
  }

  if (succeededIds.length > 0) {
    // They never chose this password — force each to set their own before using the portal.
    await inBatchesDo(succeededIds, (batch) => admin.from('profiles').update({ must_reset_password: true }).in('id', batch))
  }
  // sessions opened with the old passwords end now (audit A-05)
  let sessionsNotEnded = 0
  for (const id of succeededIds) if ((await revokeAllSessions(admin, id)) === null) sessionsNotEnded++

  await logAdminAudit({
    orgId: profile.org_id, actorId: profile.id,
    entityType: 'user', entityId: null, action: 'bulk_password_reset',
    metadata: { requested: userIds.length, succeeded: succeededIds.length, failed: failed.length },
  })
  revalidatePath('/admin/users')
  const credentials: BulkCredential[] = succeededIds.map((id) => ({
    email: emailByAccount.ok ? (emailByAccount.value.get(id) ?? '') : '',
    full_name: nameById.get(id) ?? '',
    password: issued.get(id) ?? '',
  }))
  return {
    succeeded: succeededIds.length, failed, credentials,
    ...(sessionsNotEnded > 0 ? { warning: `${sessionsNotEnded} account(s) could not have their existing sessions ended.` } : {}),
  }
}
