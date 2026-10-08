// The predefined reports in Report Analytics. Unlike Report Builder these are fixed: nobody can change
// what a report contains — the viewer only picks the technician group, a date range and the statuses.
// One report covers every technician group (the group is chosen inside the report), so a new group is
// available in it straight away and a deleted group disappears from it.

import type { RequestStatus } from '@/types'
import type { ProfileWithTeams } from '@/types'

export interface AnalyticsReportDef {
  slug: string
  title: string
  description: string
}

export const ANALYTICS_REPORTS: AnalyticsReportDef[] = [
  {
    slug: 'tickets-summary-age-bucket',
    title: 'Tickets Summary Report Age bucket wise',
    description: 'A technician group’s tickets by technician and category, counted by how old they are. Choose the group, dates and statuses.',
  },
]

export function findAnalyticsReport(slug: string): AnalyticsReportDef | undefined {
  return ANALYTICS_REPORTS.find((r) => r.slug === slug)
}

/** "ADMIN GROUP" → "Admin", "PO  GM GROUP" → "PO GM", "L&D GROUP" → "L&D", "IT Group" → "IT". */
export function groupDisplayName(teamName: string): string {
  const words = teamName.replace(/\s+/g, ' ').trim().replace(/\s+group$/i, '').split(' ').filter(Boolean)
  const shaped = words.map((w) => (w.length <= 3 || /[^a-zA-Z]/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
  return shaped.join(' ') || teamName.trim()
}

/** Title of one group's report, e.g. "Admin Tickets Summary Report Age bucket wise" (used on the page header and the Excel file). */
export function reportTitleForGroup(def: AnalyticsReportDef, teamName: string): string {
  return `${groupDisplayName(teamName)} ${def.title}`
}

/** Roles that can open Report Analytics at all. Requesters never see it. */
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

/** The groups this viewer can choose from in the report, A→Z. */
export function selectableGroups<T extends { id: string; name: string }>(
  profile: Pick<ProfileWithTeams, 'role' | 'team_members'>,
  teams: T[]
): T[] {
  return teams
    .filter((t) => canViewGroupReport(profile, t.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** The requested group when the viewer may see it, otherwise the first one they can. */
export function pickGroup<T extends { id: string }>(groups: T[], requestedId: string | undefined): T | undefined {
  return groups.find((g) => g.id === requestedId) ?? groups[0]
}

/** Statuses a "tickets summary" counts by default: everything still being worked, i.e. not resolved, closed or cancelled. */
export const DEFAULT_REPORT_STATUSES: RequestStatus[] = [
  'open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval',
]

export const ALL_REPORT_STATUSES: RequestStatus[] = [
  ...DEFAULT_REPORT_STATUSES, 'resolved', 'closed', 'cancelled',
]

export function parseStatuses(raw: string | string[] | undefined): RequestStatus[] {
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((s): s is RequestStatus => (ALL_REPORT_STATUSES as string[]).includes(s))
  return list.length > 0 ? ALL_REPORT_STATUSES.filter((s) => list.includes(s)) : DEFAULT_REPORT_STATUSES
}
