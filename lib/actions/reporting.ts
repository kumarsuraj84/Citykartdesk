'use server'

import { fetchReportData, getReportFieldsForEntity, type ReportDataResult } from '@/lib/queries/reporting'
import { authorizeReportAccess } from '@/lib/reporting/access'
import type { EntityKey } from '@/lib/reporting/field-registry'
import type { ReportField } from '@/lib/reporting/field-registry'

export async function getReportFields(entity: EntityKey): Promise<{ data?: ReportField[]; error?: string }> {
  const auth = await authorizeReportAccess(entity)
  if ('error' in auth) return { error: auth.error }
  const data = await getReportFieldsForEntity(entity, auth.profile.org_id!)
  return { data }
}

export async function getReportData(entity: EntityKey): Promise<{ data?: ReportDataResult; error?: string }> {
  const auth = await authorizeReportAccess(entity)
  if ('error' in auth) return { error: auth.error }
  const data = await fetchReportData(entity, auth.profile.org_id!, auth.scope)
  return { data }
}
