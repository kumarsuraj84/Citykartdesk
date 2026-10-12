// The two filters on every fixed report: ticket status and technician. Both lists are linked: the technicians offered are the ones who have tickets in the
// chosen statuses, and each status shows the tickets it has for the chosen technicians. Pure code, shared by the server (which filters the report) and the
// filter bar (which recomputes its lists live from what is ticked, before anything is applied).

import type { RequestStatus } from '@/types'

export const ALL_STATUSES: RequestStatus[] = ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval', 'resolved', 'closed', 'cancelled']

/** The tickets of a report's scope by status and technician: all the filter bar needs to work out its lists. */
export interface FilterCombo { status: string; tech: string; count: number }

export interface ReportFilter {
  /** chosen statuses; empty = the report's own statuses */
  statuses: string[]
  /** chosen technicians; empty = everybody */
  techs: string[]
}

export const emptyReportFilter = (): ReportFilter => ({ statuses: [], techs: [] })

const isStatus = (s: string): s is RequestStatus => (ALL_STATUSES as string[]).includes(s)

/** `?status=open,assigned&tech=Krishan|Arun Das` → the choices (unknown statuses dropped, names de-duplicated). */
export function parseReportFilter(sp: Record<string, string | string[] | undefined>): ReportFilter {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const statuses = [...new Set(one(sp.status).split(',').map((s) => s.trim()).filter(isStatus))]
  const techs = [...new Set(one(sp.tech).split('|').map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 120))].slice(0, 100)
  return { statuses: ALL_STATUSES.filter((s) => statuses.includes(s)), techs }
}

/** Writes the choices into URL parameters; a status choice equal to the report's own statuses is no choice at all. */
export function applyReportFilterToParams(params: URLSearchParams, f: ReportFilter, defaults: readonly string[]): void {
  const same = f.statuses.length === defaults.length && f.statuses.every((s) => defaults.includes(s))
  if (f.statuses.length > 0 && !same) params.set('status', f.statuses.join(','))
  else params.delete('status')
  if (f.techs.length > 0) params.set('tech', f.techs.join('|'))
  else params.delete('tech')
}

export interface LinkedOptions {
  statuses: { value: string; count: number }[]
  techs: { value: string; count: number }[]
}

/**
 * Each status shows how many tickets it has for the chosen technicians; each technician shows how many tickets they have in the chosen statuses.
 * Ticked values stay in their list (with 0) so they can be un-ticked.
 */
export function linkedOptions(combos: FilterCombo[], statuses: readonly string[], techs: readonly string[]): LinkedOptions {
  const statusCount = new Map<string, number>()
  const techCount = new Map<string, number>()
  for (const c of combos) {
    if (techs.length === 0 || techs.includes(c.tech)) statusCount.set(c.status, (statusCount.get(c.status) ?? 0) + c.count)
    if (statuses.includes(c.status)) techCount.set(c.tech, (techCount.get(c.tech) ?? 0) + c.count)
  }
  for (const t of techs) if (!techCount.has(t)) techCount.set(t, 0)
  return {
    statuses: ALL_STATUSES.map((value) => ({ value, count: statusCount.get(value) ?? 0 })),
    techs: [...techCount].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, undefined, { numeric: true })),
  }
}
