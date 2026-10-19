import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { CVM_ROLES, buildCvmCandidates, type CvmCandidates } from './resolve'

/**
 * The active staff of an organisation with their e-mail addresses: the people who can be a store's CVM.
 * Server-only helper (NOT a server action: it has no caller check, so it must never be exported from a "use server" file).
 */
export async function loadCvmCandidates(orgId: string): Promise<CvmCandidates & { staff: { id: string; full_name: string }[] }> {
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, full_name').eq('org_id', orgId).eq('is_active', true).in('role', [...CVM_ROLES]).order('full_name')
  const staff = (data ?? []) as { id: string; full_name: string }[]
  const ids = new Set(staff.map((s) => s.id))
  const emails = new Map<string, string>()
  for (let page = 1; page <= 20; page++) {
    const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) break
    for (const u of list?.users ?? []) if (u.email && ids.has(u.id)) emails.set(u.id, u.email)
    if ((list?.users ?? []).length < 1000) break
  }
  return { ...buildCvmCandidates(staff, emails), staff }
}
