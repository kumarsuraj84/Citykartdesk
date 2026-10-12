// Who may open the fixed predefined reports and which technician groups' tickets they get. The reports themselves are in fixed-reports.ts.

import type { RequestStatus } from '@/types'
import type { ProfileWithTeams } from '@/types'

/** "ADMIN GROUP" → "Admin", "PO  GM GROUP" → "PO GM", "L&D GROUP" → "L&D", "IT Group" → "IT". */
export function groupDisplayName(teamName: string): string {
  const words = teamName.replace(/\s+/g, ' ').trim().replace(/\s+group$/i, '').split(' ').filter(Boolean)
  const shaped = words.map((w) => (w.length <= 3 || /[^a-zA-Z]/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
  return shaped.join(' ') || teamName.trim()
}

/** Roles that can open the fixed reports at all. Requesters never see them. */
export function canUseReportAnalytics(role: string): boolean {
  return ['agent', 'manager', 'admin', 'platform_owner'].includes(role)
}

/**
 * Admins and owners may look at any group; a manager or technician only at the technician groups they
 * belong to. What is inside a report is the whole group's tickets.
 */
export function canViewGroupReport(profile: Pick<ProfileWithTeams, 'role' | 'team_members'>, teamId: string): boolean {
  if (profile.role === 'admin' || profile.role === 'platform_owner') return true
  if (profile.role === 'manager' || profile.role === 'agent') return profile.team_members.some((tm) => tm.team_id === teamId)
  return false
}

/** The groups whose tickets this viewer gets, A→Z. */
export function selectableGroups<T extends { id: string; name: string }>(
  profile: Pick<ProfileWithTeams, 'role' | 'team_members'>,
  teams: T[]
): T[] {
  return teams
    .filter((t) => canViewGroupReport(profile, t.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** Statuses that are still being worked: everything but resolved, closed and cancelled. */
export const DEFAULT_REPORT_STATUSES: RequestStatus[] = [
  'open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval',
]
