'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { rateLimit } from '@/lib/rate-limit'
import { emailInvitation } from '@/lib/email/auth-mail'
import { recordAudit } from '@/lib/syslog/audit'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { organisationMailDomains, isOrganisationAddress } from '@/lib/email/org-domains'
import { loadPolicies } from '@/lib/permissions/policies'
import { PO_APPROVER_SETTING } from '@/lib/vendor/po'
import { OPEN_REQUEST_STATUSES } from '@/lib/constants/requests'

// Administrator screens for the OEM engineers' companies and logins. A vendor login is an ordinary requester-level account that also belongs to a vendor company
// as a technician or as a manager (read only). Only administrators and the platform owner may create or change them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: any }
type Result = { error?: string; warning?: string }

async function adminOnly() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) return null
  return profile
}

function cleanName(raw: string): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim()
}

export async function createVendorCompany(name: string): Promise<Result & { id?: string }> {
  const profile = await adminOnly()
  if (!profile?.org_id) return { error: 'Unauthorized.' }
  const n = cleanName(name)
  if (n.length < 2 || n.length > 120) return { error: 'The company name must be 2 to 120 characters.' }
  const admin = createAdminClient() as unknown as AnyClient
  const { data, error } = await admin.from('vendor_companies').insert({ org_id: profile.org_id, name: n, created_by: profile.id }).select('id').single()
  if (error) return { error: error.code === '23505' ? 'A vendor company with this name already exists.' : sanitizeError(error, { route: 'admin/vendors.ts#create' }) }
  await recordAudit({ action: 'vendor.company_created', entityType: 'vendor_company', entityId: data.id, entityLabel: n, after: { name: n }, actorId: profile.id, orgId: profile.org_id })
  revalidatePath('/admin/vendors')
  return { id: data.id }
}

export async function renameVendorCompany(id: string, name: string): Promise<Result> {
  const profile = await adminOnly()
  if (!profile?.org_id) return { error: 'Unauthorized.' }
  const n = cleanName(name)
  if (n.length < 2 || n.length > 120) return { error: 'The company name must be 2 to 120 characters.' }
  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('vendor_companies').update({ name: n }).eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: error.code === '23505' ? 'A vendor company with this name already exists.' : sanitizeError(error, { route: 'admin/vendors.ts#rename' }) }
  revalidatePath('/admin/vendors')
  return {}
}

export async function setVendorCompanyActive(id: string, active: boolean): Promise<Result> {
  const profile = await adminOnly()
  if (!profile?.org_id) return { error: 'Unauthorized.' }
  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('vendor_companies').update({ is_active: active }).eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: sanitizeError(error, { route: 'admin/vendors.ts#active' }) }
  revalidatePath('/admin/vendors')
  return {}
}

/** Creates the login of an OEM engineer (technician) or of a vendor manager and e-mails the "set your password" link. */
export async function inviteVendorPerson(fields: { email: string; full_name: string; company_id: string; vendor_role: 'technician' | 'manager' }): Promise<Result> {
  const profile = await adminOnly()
  if (!profile?.org_id) return { error: 'Unauthorized.' }
  const email = (fields.email ?? '').trim().toLowerCase()
  const fullName = cleanName(fields.full_name)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Please enter a valid e-mail address.' }
  if (fullName.length < 2) return { error: 'Name is required.' }
  if (fields.vendor_role !== 'technician' && fields.vendor_role !== 'manager') return { error: 'Choose technician or manager.' }

  const { limited } = await rateLimit(`admin-invite-user:${profile.id}`, 10, 60_000)
  if (limited) return { error: 'Too many invites sent. Please wait a minute.' }

  const domains = await organisationMailDomains()
  const external = domains.length > 0 && !isOrganisationAddress(email, domains)
  if (external && (await loadPolicies()).external_invites === 'org_domains_only') {
    return { error: 'Invitations can only be sent to addresses at the company mail domain (' + domains.join(', ') + ').' }
  }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: company } = await admin.from('vendor_companies').select('id, name, is_active').eq('id', fields.company_id).eq('org_id', profile.org_id).maybeSingle()
  if (!company) return { error: 'Vendor company not found.' }
  if (!company.is_active) return { error: 'This vendor company is switched off.' }

  const { data: authData, error: authErr } = await admin.auth.admin.generateLink({ type: 'invite', email, options: { data: { full_name: fullName } } })
  if (authErr) return { error: sanitizeError(authErr, { route: 'admin/vendors.ts#invite' }) }
  const uid: string | undefined = authData?.user?.id
  const tokenHash: string | undefined = authData?.properties?.hashed_token
  if (!uid) return { error: 'Failed to create the login.' }

  const { error: profileErr } = await admin.from('profiles').update({
    role: 'user', full_name: fullName, org_id: profile.org_id, vendor_company_id: company.id, vendor_role: fields.vendor_role, updated_at: new Date().toISOString(),
  }).eq('id', uid)
  if (profileErr) {
    try { await admin.auth.admin.deleteUser(uid) } catch { /* the error below is the one the administrator needs */ }
    return { error: sanitizeError(profileErr, { route: 'admin/vendors.ts#profile' }) }
  }

  await recordAudit({
    action: 'vendor.person_invited', entityType: 'user', entityId: uid, entityLabel: email,
    after: { email, company: company.name, vendor_role: fields.vendor_role, ...(external ? { external_domain: true } : {}) }, actorId: profile.id, orgId: profile.org_id,
  })
  revalidatePath('/admin/vendors')
  revalidatePath('/admin/users')
  if (tokenHash) {
    const mail = await emailInvitation(email, tokenHash, fullName)
    if (mail.error) return { warning: 'Login created, but the invitation e-mail could not be sent. Use "Send password reset" on the user to e-mail a link.' }
  }
  return {}
}

/** Moves a vendor person to another company or between technician and manager. */
export async function updateVendorPerson(userId: string, change: { company_id?: string; vendor_role?: 'technician' | 'manager' }): Promise<Result> {
  const profile = await adminOnly()
  if (!profile?.org_id) return { error: 'Unauthorized.' }
  const admin = createAdminClient() as unknown as AnyClient
  const { data: person } = await admin.from('profiles').select('id, vendor_company_id, vendor_role').eq('id', userId).eq('org_id', profile.org_id).maybeSingle()
  if (!person?.vendor_company_id) return { error: 'This person is not a vendor login.' }
  const patch: Record<string, unknown> = {}
  if (change.company_id) {
    const { data: company } = await admin.from('vendor_companies').select('id').eq('id', change.company_id).eq('org_id', profile.org_id).maybeSingle()
    if (!company) return { error: 'Vendor company not found.' }
    patch.vendor_company_id = company.id
  }
  if (change.vendor_role) {
    if (change.vendor_role !== 'technician' && change.vendor_role !== 'manager') return { error: 'Choose technician or manager.' }
    patch.vendor_role = change.vendor_role
  }
  // nothing really changes: nothing to check or write
  if (patch.vendor_company_id === person.vendor_company_id) delete patch.vendor_company_id
  if (patch.vendor_role === person.vendor_role) delete patch.vendor_role
  if (Object.keys(patch).length === 0) return {}

  // A technician's tickets (and the quotes and prices on them) are seen by the manager of HIS company. Moving him to another company would show them to the new company's manager, and
  // making him a manager would leave his open tickets with somebody who cannot act on them. So the change waits until his open tickets are given to somebody else.
  const { data: open, error: openErr } = await admin.from('requests').select('request_no').eq('org_id', profile.org_id).eq('assigned_to', userId).in('status', [...OPEN_REQUEST_STATUSES]).order('created_at', { ascending: true }).limit(8)
  if (openErr) return { error: sanitizeError(openErr, { route: 'admin/vendors.ts#open-tickets' }) }
  const openList = (open ?? []) as { request_no: string }[]
  if (openList.length > 0) {
    const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('org_id', profile.org_id).eq('assigned_to', userId).in('status', [...OPEN_REQUEST_STATUSES])
    const n = count ?? openList.length
    return { error: `He still holds ${n} open ticket${n === 1 ? '' : 's'} (${openList.map((r) => r.request_no).join(', ')}${n > openList.length ? ' and more' : ''}). Give ${n === 1 ? 'it' : 'them'} to somebody else first, then change his ${patch.vendor_company_id ? 'company' : 'role'}.` }
  }
  const { error } = await admin.from('profiles').update(patch).eq('id', userId)
  if (error) return { error: sanitizeError(error, { route: 'admin/vendors.ts#update' }) }
  await recordAudit({ action: 'vendor.person_changed', entityType: 'user', entityId: userId, entityLabel: userId, after: patch, actorId: profile.id, orgId: profile.org_id })
  revalidatePath('/admin/vendors')
  if (patch.vendor_company_id) {
    const { count: earlier } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('org_id', profile.org_id).eq('assigned_to', userId)
    if ((earlier ?? 0) > 0) return { warning: `Changed. His ${earlier} earlier ticket${earlier === 1 ? '' : 's'} (with their quotes and prices) can now be seen by the manager of the new company. To keep them with the old company, make a new login for the new company instead.` }
  }
  return {}
}

/** Who approves the purchase orders vendors ask for. There is no built-in person: until an administrator names one here, a vendor cannot ask for a PO (unless the AC row names the approvers). */
export async function setPoApprover(userId: string): Promise<Result> {
  const profile = await adminOnly()
  if (!profile?.org_id) return { error: 'Unauthorized.' }
  const admin = createAdminClient() as unknown as AnyClient
  const { data: person } = await admin.from('profiles').select('id, full_name, role, is_active, vendor_company_id').eq('id', userId).eq('org_id', profile.org_id).maybeSingle()
  if (!person || person.is_active === false || person.vendor_company_id || !['agent', 'manager', 'admin', 'platform_owner'].includes(person.role)) {
    return { error: 'Choose an active Citykart technician, manager or administrator.' }
  }
  const { error } = await admin.from('app_settings').upsert({ key: PO_APPROVER_SETTING, value: userId }, { onConflict: 'key' })
  if (error) return { error: sanitizeError(error, { route: 'admin/vendors.ts#approver' }) }
  await recordAudit({ action: 'vendor.po_approver_set', entityType: 'user', entityId: userId, entityLabel: person.full_name, after: { approver: person.full_name }, actorId: profile.id, orgId: profile.org_id })
  revalidatePath('/admin/vendors')
  return {}
}
