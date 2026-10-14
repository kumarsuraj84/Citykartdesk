'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import { recordAudit } from '@/lib/syslog/audit'
import {
  exportRequestsCSV,
  exportTasksCSV,
  exportApprovalsCSV,
  exportProjectsCSV,
  exportStoresCSV,
  type ExportFilters,
} from '@/lib/export/reports'

/** Every export of organization data is an audit event: who took which data out, with which filters, and how many rows. */
async function auditExport(profile: { id: string; org_id: string | null }, what: string, csv: string, filters?: unknown): Promise<string> {
  const rows = Math.max(0, csv.split(/\r?\n/).length - 1)
  await recordAudit({ category: 'security', action: `data.exported.${what}`, entityType: what, message: `${rows} rows exported`, after: { rows, filters: filters ?? null }, actorId: profile.id, orgId: profile.org_id })
  return csv
}

export async function exportRequests(f?: ExportFilters): Promise<string> {
  const profile = await getCurrentProfile()
  if (!profile) throw new Error('Not authenticated.')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) throw new Error('Not authorized.')
  if (!profile.org_id) throw new Error('No organization.')
  return auditExport(profile, 'requests', await exportRequestsCSV(profile.org_id, f), f)
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
  return auditExport(profile, 'tasks', await exportTasksCSV(profile.org_id, f, teamIds), f)
}

export async function exportApprovals(f?: ExportFilters): Promise<string> {
  const profile = await getCurrentProfile()
  if (!profile) throw new Error('Not authenticated.')
  // the whole organisation's approvals: admins and platform owners only (a manager's list is limited to their own, see getApprovals)
  if (!['admin', 'platform_owner'].includes(profile.role)) throw new Error('Not authorized.')
  if (!profile.org_id) throw new Error('No organization.')
  return auditExport(profile, 'approvals', await exportApprovalsCSV(profile.org_id, f), f)
}

export async function exportProjects(): Promise<string> {
  const profile = await getCurrentProfile()
  if (!profile) throw new Error('Not authenticated.')
  if (!profile.org_id) throw new Error('No organization.')
  const isOrgWide = ['admin', 'manager', 'platform_owner'].includes(profile.role)
  const teamIds = isOrgWide ? undefined : profile.team_members.map((tm) => tm.team_id)
  return auditExport(profile, 'projects', await exportProjectsCSV(profile.org_id, teamIds))
}

export async function exportStores(): Promise<string> {
  const profile = await getCurrentProfile()
  if (!profile) throw new Error('Not authenticated.')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) throw new Error('Not authorized.')
  if (!profile.org_id) throw new Error('No organization.')
  return auditExport(profile, 'stores', await exportStoresCSV(profile.org_id))
}
