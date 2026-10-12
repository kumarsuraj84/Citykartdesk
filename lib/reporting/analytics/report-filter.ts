// The filters on every fixed report: technician group, then service, ticket status and technician. All four lists are linked: each one shows only what fits the
// other three. Choose a group and the service list becomes that group's services, all of them chosen unless you pick some. A report has its own starting point
// (the Admin Summary starts on the Admin group, the AC Issues Report on the service ADMIN - AC); a choice here replaces it.
// Pure code, shared by the server (which filters the report) and the filter bar (which recomputes its lists live from what is ticked, before Apply).

import type { RequestStatus } from '@/types'

export const ALL_STATUSES: RequestStatus[] = ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval', 'resolved', 'closed', 'cancelled']

/** The tickets of a report's scope by group, service, status and technician: all the filter bar needs to work out its lists. */
export interface FilterCombo { group: string; service: string; status: string; tech: string; count: number }

export interface ReportFilter {
  statuses: string[]
  techs: string[]
  /** chosen technician groups (ids) */
  groups: string[]
  /** chosen services (ids) */
  services: string[]
  /** "every group" was chosen on a report that starts on one group */
  allGroups: boolean
  /** "every service" was chosen on a report that starts on one service */
  allServices: boolean
}

/** What a report starts with when nothing is chosen (empty = no limit). */
export interface FilterDefaults { statuses: string[]; groups: string[]; services: string[] }

/** What is really in force: empty groups / services / technicians mean no limit. */
export interface EffectiveFilter { statuses: string[]; techs: string[]; groups: string[]; services: string[] }

export const emptyReportFilter = (): ReportFilter => ({ statuses: [], techs: [], groups: [], services: [], allGroups: false, allServices: false })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isStatus = (s: string): s is RequestStatus => (ALL_STATUSES as string[]).includes(s)

/** `?status=open,assigned&tech=Krishan|Arun Das&group=<ids>|all&service=<ids>|all` → the choices (unknown values dropped). */
export function parseReportFilter(sp: Record<string, string | string[] | undefined>): ReportFilter {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const statuses = [...new Set(one(sp.status).split(',').map((s) => s.trim()).filter(isStatus))]
  const techs = [...new Set(one(sp.tech).split('|').map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 120))].slice(0, 100)
  const ids = (raw: string) => [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, 300)
  const group = one(sp.group)
  const service = one(sp.service)
  return {
    statuses: ALL_STATUSES.filter((s) => statuses.includes(s)),
    techs,
    groups: group === 'all' ? [] : ids(group),
    services: service === 'all' ? [] : ids(service),
    allGroups: group === 'all',
    allServices: service === 'all',
  }
}

/** What is in force for a choice: the choice where there is one, otherwise the report's own starting point. */
export function effectiveFilter(sel: ReportFilter, d: FilterDefaults): EffectiveFilter {
  const groupChosen = sel.allGroups || sel.groups.length > 0
  return {
    statuses: sel.statuses.length > 0 ? sel.statuses : d.statuses,
    techs: sel.techs,
    groups: sel.allGroups ? [] : sel.groups.length > 0 ? sel.groups : d.groups,
    // choosing a group selects all of its services, unless some are picked
    services: sel.allServices ? [] : sel.services.length > 0 ? sel.services : groupChosen ? [] : d.services,
  }
}

/** From what the filter bar shows (empty list = everything) back to a choice. */
export function choiceFromEffective(e: EffectiveFilter, d: FilterDefaults): ReportFilter {
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
  const allGroups = e.groups.length === 0 && d.groups.length > 0
  const groups = sameSet(e.groups, d.groups) ? [] : e.groups
  const groupChosen = allGroups || groups.length > 0
  const allServices = e.services.length === 0 && d.services.length > 0 && !groupChosen
  const services = sameSet(e.services, d.services) && !groupChosen ? [] : e.services
  return { statuses: sameSet(e.statuses, d.statuses) ? [] : e.statuses, techs: e.techs, groups, services, allGroups, allServices }
}

/** Writes the choices into URL parameters. */
export function applyReportFilterToParams(params: URLSearchParams, f: ReportFilter): void {
  const set = (key: string, value: string) => { if (value) params.set(key, value); else params.delete(key) }
  set('status', f.statuses.join(','))
  set('tech', f.techs.join('|'))
  set('group', f.allGroups ? 'all' : f.groups.join(','))
  set('service', f.allServices ? 'all' : f.services.join(','))
}

export interface LinkedOptions {
  groups: { value: string; count: number }[]
  services: { value: string; count: number }[]
  statuses: { value: string; count: number }[]
  techs: { value: string; count: number }[]
}

type Key = keyof EffectiveFilter
const FIELD: Record<Key, keyof FilterCombo> = { statuses: 'status', techs: 'tech', groups: 'group', services: 'service' }

/**
 * Each list counts the tickets that fit the OTHER three filters (never its own, so more can be added). Ticked values stay in their list with 0 so they can
 * be un-ticked. Statuses are always the nine statuses (with their counts).
 */
export function linkedOptions(combos: FilterCombo[], e: EffectiveFilter): LinkedOptions {
  const fits = (c: FilterCombo, skip: Key) =>
    (Object.keys(FIELD) as Key[]).every((k) => k === skip || e[k].length === 0 || e[k].includes(c[FIELD[k]] as string))
  const count = (key: Key) => {
    const m = new Map<string, number>()
    for (const c of combos) if (fits(c, key)) m.set(c[FIELD[key]] as string, (m.get(c[FIELD[key]] as string) ?? 0) + c.count)
    for (const v of e[key]) if (!m.has(v)) m.set(v, 0)
    return m
  }
  const list = (key: Key) => [...count(key)].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, undefined, { numeric: true }))
  const statusCount = count('statuses')
  return {
    groups: list('groups'),
    services: list('services'),
    statuses: ALL_STATUSES.map((value) => ({ value, count: statusCount.get(value) ?? 0 })),
    techs: list('techs'),
  }
}
