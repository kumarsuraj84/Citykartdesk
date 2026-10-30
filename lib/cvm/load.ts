import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { listAuthEmails } from '@/lib/auth/emails'
import { logger } from '@/lib/observability/logger'
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
  // every page of the sign-in accounts is read (lib/auth/emails.ts); if the sign-in service cannot be read, the people are listed without addresses and it is logged
  const scanned = await listAuthEmails(admin, ids)
  if (!scanned.ok) logger.error({ event: 'cvm.load_emails_failed', message: 'The sign-in accounts could not be read, so the CVM candidates have no e-mail addresses', errorCode: 'auth_list_failed', context: { reason: scanned.error } })
  const emails = scanned.ok ? scanned.value : new Map<string, string>()
  return { ...buildCvmCandidates(staff, emails), staff }
}
