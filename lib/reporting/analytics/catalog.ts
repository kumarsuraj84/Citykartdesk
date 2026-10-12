// The predefined reports in Report Analytics. Unlike Report Builder these are fixed: nobody can change
// what a report contains — the viewer only picks the technician group, a date range and the statuses.
// One report covers every technician group (the group is chosen inside the report), so a new group is
// available in it straight away and a deleted group disappears from it.

import type { RequestStatus } from '@/types'
import type { ProfileWithTeams } from '@/types'
import type { FacetKey } from './facets'
import type { ColumnKey } from './ticket-tree'

export type AnalyticsReportKind = 'age-summary' | 'ticket-detail' | 'ticket-tree' | 'store-ac'

/** How a grouped ticket report opens; the viewer can change the layout and open or close any heading. */
export interface TreeConfig {
  /** the layouts the viewer can choose from (ids from LAYOUTS in ticket-tree.ts) and the one the report opens with */
  layouts: string[]
  defaultLayout: string
  /** open to the tickets, or closed to one line per store */
  level: 'tickets' | 'stores'
  /** the ticket columns, in order (the ones that repeat a heading are left out) */
  columns: ColumnKey[]
  minTicketsFilter: boolean
}

export interface AnalyticsReportDef {
  slug: string
  title: string
  description: string
  kind: AnalyticsReportKind
  /** the filters this report offers; each one only lists values that fit the other filters */
  facets: FacetKey[]
  /** more filters, offered only where some chosen service goes to an OEM (AC servicing) */
  acFacets?: FacetKey[]
  /** the report is about AC tickets only (services that go to an OEM) */
  acOnly?: boolean
  tree?: TreeConfig
}

const COMMON_FACETS: FacetKey[] = ['technician', 'storeType', 'region', 'cluster', 'store', 'category', 'ageBucket', 'openMonth', 'openWeek', 'closeMonth', 'closeWeek']
const AC_FACETS: FacetKey[] = ['oem', 'acBrand', 'acAmcBrand', 'acAmcVendor', 'redFlag', 'oemBucket']
const TREE_LAYOUTS = ['cluster-store', 'tech-store', 'tech-cluster-store', 'region-cluster-store', 'category-store', 'oem-store']

export const ANALYTICS_REPORTS: AnalyticsReportDef[] = [
  {
    slug: 'tickets-summary-age-bucket',
    title: 'Tickets Summary Report Age bucket wise',
    description: 'A technician group’s tickets by technician and category, counted by how old they are, with the tickets created and resolved today. Choose the group, dates, statuses and filters.',
    kind: 'age-summary',
    facets: COMMON_FACETS,
    acFacets: AC_FACETS,
  },
  {
    slug: 'ticket-detail-age-bucket',
    title: 'Ticket Detail Report Age bucket wise',
    description: 'The same tickets one by one: ticket number, subject, requester, technician, category, status and age. Choose the group, dates, statuses and filters.',
    kind: 'ticket-detail',
    facets: COMMON_FACETS,
    acFacets: AC_FACETS,
  },
  {
    slug: 'ticket-status-age-bucket',
    title: 'Ticket Status Report Age bucket wise',
    description: 'Tickets by cluster, responsible, region or category, then by store, one line per ticket with its age bucket and a total for every heading. Open or close any heading or store.',
    kind: 'ticket-tree',
    facets: COMMON_FACETS,
    acFacets: AC_FACETS,
    tree: {
      layouts: TREE_LAYOUTS, defaultLayout: 'cluster-store', level: 'tickets', minTicketsFilter: false,
      columns: ['category', 'subCategory', 'subject', 'ticketNo', 'technician', 'status', 'createdDate', 'ageDays', 'acNo', 'oemTicketNo', 'oemBucket'],
    },
  },
  {
    slug: 'store-tickets-age-bucket',
    title: 'Store wise Ticket Report Age bucket wise',
    description: 'Every store with its ticket count by age bucket, under its cluster, responsible or region. Show only stores with several tickets to spot repeat-issue stores, and open a store to see its tickets.',
    kind: 'ticket-tree',
    facets: COMMON_FACETS,
    acFacets: AC_FACETS,
    tree: {
      layouts: TREE_LAYOUTS, defaultLayout: 'cluster-store', level: 'stores', minTicketsFilter: true,
      columns: ['category', 'subCategory', 'subject', 'ticketNo', 'technician', 'status', 'createdDate', 'ageDays'],
    },
  },
  {
    slug: 'store-ac-age-bucket',
    title: 'Store AC Not Working Report Age bucket wise',
    description: 'Each store with open AC tickets: its AC total, the AC Not Working % (open AC tickets ÷ AC total), a red flag above the limit, Zenatix, and its tickets by age. Choose Red flag = Yes to list only the red flag stores.',
    kind: 'store-ac',
    acOnly: true,
    facets: ['technician', 'storeType', 'region', 'cluster', 'store', 'priorityList', 'acBrand', 'acAmcBrand', 'acAmcVendor', 'zenatix', 'redFlag', 'ageBucket', 'openMonth', 'openWeek'],
  },
  {
    slug: 'amc-vendor-age-bucket',
    title: 'AMC Vendor Report Age bucket wise',
    description: 'AC tickets by AC-AMC brand and vendor, then cluster and store, with the AC number, the AC OEM ticket number, date and age, and each store’s AC Not Working %. Open or close any heading.',
    kind: 'ticket-tree',
    acOnly: true,
    facets: ['acAmcBrand', 'acAmcVendor', 'cluster', 'region', 'priorityList', 'store', 'technician', 'storeType', 'redFlag', 'ageBucket', 'oemBucket', 'openMonth', 'openWeek'],
    tree: {
      layouts: ['amc-brand-vendor-cluster-store', 'amc-vendor-store'], defaultLayout: 'amc-brand-vendor-cluster-store', level: 'tickets', minTicketsFilter: false,
      columns: ['subCategory', 'subject', 'acNo', 'ticketNo', 'technician', 'createdDate', 'ageDays', 'oemTicketNo', 'oemTicketDate', 'oemBucket', 'priorityList', 'acTotal', 'storeAcTickets', 'acPct'],
    },
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
