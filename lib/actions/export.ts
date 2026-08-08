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
  // /tasks is a general-audience page (any signed-in user can export their own view),
  // unlike /admin/reports — so this stays role-open but narrows to the caller's own
  // team(s) unless they hold a role that already sees org-wide data in the UI.
  const isOrgWide = ['admin', 'manager', 'platform_owner'].includes(profile.role)
  const teamIds = isOrgWide ? undefined : profile.team_members.map((tm) => tm.team_id)
  return exportTasksCSV(profile.org_id, f, teamIds)
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
  const isOrgWide = ['admin', 'manager', 'platform_owner'].includes(profile.role)
  const teamIds = isOrgWide ? undefined : profile.team_members.map((tm) => tm.team_id)
  return exportProjectsCSV(profile.org_id, teamIds)
}
