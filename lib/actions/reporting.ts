'use server'

import { revalidatePath } from 'next/cache'
import { fetchReportData, getReportFieldsForEntity, type ReportDataResult } from '@/lib/queries/reporting'
import { authorizeReportAccess } from '@/lib/reporting/access'
import type { EntityKey } from '@/lib/reporting/field-registry'
import type { ReportField } from '@/lib/reporting/field-registry'
import type { SavedReportConfig } from '@/lib/reporting/pivot-engine'
import type { SavedReport } from '@/types'
import type { Json } from '@/types/database'
import { createClient } from '@/lib/supabase/server'

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

// ── Saved reports ────────────────────────────────────────────────────────────
// Shared within the org (anyone who can open Report Builder can see and run a
// saved report), same as a named report handed off between people — RLS still
// only lets the creator (or a manager+) edit or delete one.

export async function listSavedReports(entity: EntityKey): Promise<{ data?: SavedReport[]; error?: string }> {
  const auth = await authorizeReportAccess(entity)
  if ('error' in auth) return { error: auth.error }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('saved_reports')
    .select('*')
    .eq('org_id', auth.profile.org_id!)
    .eq('entity', entity)
    .order('name', { ascending: true })
  if (error) return { error: 'Failed to load saved reports.' }
  return { data: data ?? [] }
}

export async function createSavedReport(
  entity: EntityKey,
  name: string,
  config: SavedReportConfig
): Promise<{ data?: SavedReport; error?: string }> {
  const auth = await authorizeReportAccess(entity)
  if ('error' in auth) return { error: auth.error }
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Give this report a name.' }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('saved_reports')
    .insert({ org_id: auth.profile.org_id!, created_by: auth.profile.id, entity, name: trimmed, config: config as unknown as Json })
    .select('*')
    .single()
  if (error) return { error: 'Failed to save the report.' }
  revalidatePath('/reports/pivot')
  return { data }
}

export async function updateSavedReport(
  id: string,
  updates: { name?: string; config?: SavedReportConfig }
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const payload: { name?: string; config?: Json; updated_at: string } = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) {
    const trimmed = updates.name.trim()
    if (!trimmed) return { error: 'Give this report a name.' }
    payload.name = trimmed
  }
  if (updates.config !== undefined) payload.config = updates.config as unknown as Json
  const { error } = await supabase.from('saved_reports').update(payload).eq('id', id)
  // RLS silently no-ops rather than erroring for a plain requester who isn't the
  // creator — same shape as request-status updates elsewhere in this app, so no
  // separate "not found vs not allowed" distinction is needed here either.
  if (error) return { error: 'Failed to update the saved report.' }
  revalidatePath('/reports/pivot')
  return {}
}

export async function deleteSavedReport(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('saved_reports').delete().eq('id', id)
  if (error) return { error: 'Failed to delete the saved report.' }
  revalidatePath('/reports/pivot')
  return {}
}
