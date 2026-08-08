'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import {
  exportRequestsCSV,
  exportTasksCSV,
  exportApprovalsCSV,
  exportProjectsCSV,
  type ExportFilters,
} from '@/lib/export/reports'

export async function exportRequests(f?: ExportFilters): Promise<string> {
  const profile = await getCurrentProfile()
  if (!profile) throw new Error('Not authenticated.')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) throw new Error('Not authorized.')
  if (!profile.org_id) throw new Error('No organization.')
  return exportRequestsCSV(profile.org_id, f)
}

export async function exportTasks(f?: ExportFilters): Promise<string> {
  const profile = await getCurrentProfile()
  if (!profile) throw new Error('Not authenticated.')
  if (!profile.org_id) throw new Error('No organization.')
  return exportTasksCSV(profile.org_id, f)
}

export async function exportApprovals(f?: ExportFilters): Promise<string> {
  const profile = await getCurrentProfile()
  if (!profile) throw new Error('Not authenticated.')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) throw new Error('Not authorized.')
  if (!profile.org_id) throw new Error('No organization.')
  return exportApprovalsCSV(profile.org_id, f)
}

export async function exportProjects(): Promise<string> {
  const profile = await getCurrentProfile()
  if (!profile) throw new Error('Not authenticated.')
  if (!profile.org_id) throw new Error('No organization.')
  return exportProjectsCSV(profile.org_id)
}
