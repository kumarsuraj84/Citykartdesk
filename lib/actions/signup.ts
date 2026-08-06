'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'

type AnyClient = { from: (t: string) => any; auth: any }

export async function signupOrg(formData: FormData) {
  const orgName     = (formData.get('org_name') as string)?.trim()
  const orgSlug     = (formData.get('org_slug') as string)?.trim().toLowerCase()
  const adminName   = (formData.get('admin_name') as string)?.trim()
  const adminEmail  = (formData.get('admin_email') as string)?.trim().toLowerCase()
  const adminPass   = (formData.get('admin_password') as string)

  if (!orgName || !orgSlug || !adminName || !adminEmail || !adminPass) {
    return { error: 'All fields are required.' }
  }
  if (adminPass.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }
  if (!/^[a-z0-9-]+$/.test(orgSlug)) {
    return { error: 'Slug can only contain lowercase letters, numbers, and hyphens.' }
  }

  const admin = createAdminClient() as unknown as AnyClient

  // Check slug uniqueness
  const { data: existing } = await admin
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .maybeSingle()

  if (existing) {
    return { error: 'This organization slug is already taken. Please choose another.' }
  }

  // Create the organization (14-day trial)
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .insert({
      name: orgName,
      slug: orgSlug,
      status: 'trial',
      seat_limit: 10,
      trial_ends_at: trialEndsAt,
    })
    .select('id')
    .single()

  if (orgErr || !org) {
    return { error: orgErr?.message ?? 'Failed to create organization.' }
  }

  // Enable all modules for new org (default set)
  const defaultModules = ['requests', 'tasks', 'approvals', 'services']
  await admin.from('org_module_access').insert(
    defaultModules.map((module) => ({
      org_id: org.id,
      module,
      enabled: true,
      valid_until: null,
    }))
  )

  // Create admin user
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPass,
    email_confirm: true,
    user_metadata: { full_name: adminName },
  })

  if (authErr || !authData?.user) {
    // Roll back org
    await admin.from('organizations').delete().eq('id', org.id)
    return { error: authErr?.message ?? 'Failed to create admin user.' }
  }

  // Set profile: role=admin, org_id
  await admin
    .from('profiles')
    .update({
      full_name: adminName,
      role: 'admin',
      org_id: org.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', authData.user.id)

  return { success: true, orgId: org.id }
}
