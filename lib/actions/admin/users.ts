'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import type { UserRole } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: any }

export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin','platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

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
    cost_center_id?: string | null
    function_id?: string | null
    designation_id?: string | null
    manager_id?: string | null
  }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient() as unknown as AnyClient
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.full_name !== undefined) update.full_name = fields.full_name.trim()
  if ('job_title' in fields) update.job_title = fields.job_title?.trim() || null
  if ('employee_id' in fields) update.employee_id = fields.employee_id?.trim() || null
  if ('department_id' in fields) update.department_id = fields.department_id || null
  if ('location_id' in fields) update.location_id = fields.location_id || null
  if ('cost_center_id' in fields) update.cost_center_id = fields.cost_center_id || null
  if ('function_id' in fields) update.function_id = fields.function_id || null
  if ('designation_id' in fields) update.designation_id = fields.designation_id || null
  if ('manager_id' in fields) update.manager_id = fields.manager_id || null

  const { error } = await admin.from('profiles').update(update).eq('id', userId).eq('org_id', profile.org_id)
  if (error) return { error: error.message }
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
  manager_id?: string | null
  job_title?: string | null
  team_id?: string | null
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin','platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!fields.email.trim()) return { error: 'Email is required.' }
  if (!fields.full_name.trim()) return { error: 'Name is required.' }

  const admin = createAdminClient() as unknown as AnyClient

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
  if (fields.manager_id) profileUpdate.manager_id = fields.manager_id
  if (fields.job_title) profileUpdate.job_title = fields.job_title.trim()

  const { error: profileErr } = await admin.from('profiles').update(profileUpdate).eq('id', uid)
  if (profileErr) return { error: profileErr.message }

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
  job_title?: string
  employee_id?: string
  manager_email?: string
}

const VALID_IMPORT_ROLES: UserRole[] = ['user', 'agent', 'manager', 'admin', 'platform_owner']
const DEFAULT_BULK_PASSWORD = 'Welcome@123'

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

  const [{ data: departmentsData }, { data: orgProfiles }, { data: authList }] = await Promise.all([
    admin.from('departments').select('id, name').eq('org_id', orgId),
    admin.from('profiles').select('id').eq('org_id', orgId),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])
  const deptByName = new Map<string, string>(
    (departmentsData ?? []).map((d: { id: string; name: string }) => [d.name.trim().toLowerCase(), d.id])
  )
  const orgProfileIds = new Set((orgProfiles ?? []).map((p: { id: string }) => p.id))
  const emailToProfileId = new Map<string, string>(
    ((authList?.users ?? []) as { id: string; email?: string }[])
      .filter((u) => u.email && orgProfileIds.has(u.id))
      .map((u) => [u.email!.trim().toLowerCase(), u.id])
  )

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
      role = candidate
    }

    let departmentId: string | null = null
    if (row.department?.trim()) {
      const found = deptByName.get(row.department.trim().toLowerCase())
      if (!found) { errors.push(`${rowLabel}: department "${row.department}" not found, skipped.`); continue }
      departmentId = found
    }

    let managerId: string | null = null
    if (row.manager_email?.trim()) {
      const found = emailToProfileId.get(row.manager_email.trim().toLowerCase())
      if (!found) { errors.push(`${rowLabel}: manager "${row.manager_email}" not found, skipped.`); continue }
      managerId = found
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
    if (managerId) profileUpdate.manager_id = managerId
    if (row.job_title?.trim()) profileUpdate.job_title = row.job_title.trim()
    if (row.employee_id?.trim()) profileUpdate.employee_id = row.employee_id.trim()

    const { error: profileErr } = await admin.from('profiles').update(profileUpdate).eq('id', uid)
    if (profileErr) {
      errors.push(`${rowLabel}: account created for "${email}" but profile setup failed (${profileErr.message}).`)
      continue
    }

    // Available as a manager for any later row in this same batch.
    emailToProfileId.set(email, uid)
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
