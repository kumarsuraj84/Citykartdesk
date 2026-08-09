'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import { fetchReportData, getReportFieldsForEntity, type ReportDataResult } from '@/lib/queries/reporting'
import type { EntityKey } from '@/lib/reporting/field-registry'
import type { ReportField } from '@/lib/reporting/field-registry'

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return null
  return profile
}

export async function getReportFields(entity: EntityKey): Promise<{ data?: ReportField[]; error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  const data = await getReportFieldsForEntity(entity, profile.org_id)
  return { data }
}

export async function getReportData(entity: EntityKey): Promise<{ data?: ReportDataResult; error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  const data = await fetchReportData(entity, profile.org_id)
  return { data }
}
