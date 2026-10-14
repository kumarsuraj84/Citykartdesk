// The normal Dashboards page and the Smart Dashboard count tickets in the same way, but the normal page used to open a plain side list when
// a number was clicked. This turns what a click on the normal page asks for (a DrawerFilter) into the slice the Smart Dashboard's four-step
// pop-up opens on, so the same pop-up serves both. Pure and client-safe. A click that cannot be expressed exactly (tasks, an unknown group,
// a period it cannot place) returns null and the page keeps the old side list for that one number: a list that did not match its number would
// be worse than the plain list.

import { OPEN_REQUEST_STATUSES } from '@/lib/constants/requests'
import { emptyFilters, type Filters, type Win } from '@/lib/reporting/executive/engine'
import { STORE_FILTER_KEYS, type StoreFilter } from '@/lib/analytics/store-filter'
import type { DrawerFilter } from '@/lib/actions/analytics'
import type { PeriodParam } from '@/lib/queries/analytics'
import type { DrillContext, DrillDims } from '@/components/executive/types'

export interface BridgeEnv {
  now: number
  /** the page's own period: what the numbers were counted over */
  period: PeriodParam
  periodWindow: Win
  periodLabel: string
  /** technician groups picked on the page (ids), and the names of every group / technician the page knows */
  groupIds: string[]
  groupName: (id: string) => string | undefined
  techName: (id: string) => string | undefined
  /** Store Master choices picked on the page */
  store: StoreFilter
}

export interface DrillRequest { ctx: DrillContext; filters: Filters }

const isRange = (p: unknown): p is { from: string; to: string } => !!p && typeof p === 'object' && 'from' in p && 'to' in p

/** A date range as the page writes it (calendar days) to epoch ms, in the browser's own time zone: midnight to the last millisecond. */
function rangeWindow(p: { from: string; to: string }): Win | null {
  const start = new Date(`${p.from}T00:00:00`).getTime()
  const end = new Date(`${p.to}T23:59:59.999`).getTime()
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null
}

const OPEN_SET = new Set<string>(OPEN_REQUEST_STATUSES)
const sameSet = (a: string[], b: ReadonlySet<string>) => a.length === b.size && a.every((x) => b.has(x))

export function drawerToDrill(f: DrawerFilter, env: BridgeEnv): DrillRequest | null {
  if (f._module === 'tasks') return null
  const everything: Win = { start: 0, end: env.now }

  // the window the number was counted over
  let win: Win | null = null
  let winLabel: string | undefined
  if (f.period !== undefined) {
    if (isRange(f.period)) {
      win = rangeWindow(f.period)
      winLabel = f.period.from === f.period.to ? f.period.from : `${f.period.from} to ${f.period.to}`
    } else if (f.period === env.period) {
      win = env.periodWindow
      winLabel = env.periodLabel
    }
    if (!win) return null
  }

  const base = { title: f.title, subtitle: f.description ?? f.title }
  const dims: DrillDims = {}
  let ctx: DrillContext | null = null

  if (f.createdInPeriod && win) ctx = { ...base, stage: 1, metric: 'created', dims, win, winLabel }
  else if (f.resolvedInPeriod && win) ctx = { ...base, stage: 1, metric: 'resolved', dims, win, winLabel }
  else if (f.closedInPeriod && win) ctx = { ...base, stage: 1, metric: 'created', only: 'closed', dims, win, winLabel }
  else if (f.slaBreached) ctx = { ...base, stage: 1, metric: 'breaches', dims, win: everything, winLabel: 'right now' }
  else if (f.frtBreached) ctx = { ...base, stage: 1, metric: 'backlog', only: 'no_response', dims, win: everything, winLabel: 'right now' }
  else if (f.status?.length) {
    if (sameSet(f.status, OPEN_SET)) ctx = { ...base, stage: 1, metric: 'backlog', dims, win: everything, winLabel: 'right now' }
    else if (f.status.length === 1) { dims.status = f.status[0]; ctx = { ...base, stage: 1, metric: 'created', dims, win: everything, winLabel: 'all time' } }
  } else if (f.priority) {
    dims.prio = f.priority
    ctx = { ...base, stage: 2, metric: 'created', dims, win: everything, winLabel: 'all time' }
  } else if (f.teamId) {
    const name = env.groupName(f.teamId)
    if (name) { dims.group = name; ctx = { ...base, stage: 2, metric: 'created', dims, win: everything, winLabel: 'all time' } }
  } else if (f.assignedTo) {
    const name = env.techName(f.assignedTo)
    if (name) { dims.tech = name; ctx = { ...base, stage: 3, metric: 'created', dims, win: everything, winLabel: 'all time' } }
  }
  if (!ctx) return null

  // Everything the page itself has narrowed stays on inside the pop-up, so its list is the same set the number counted.
  const filters = emptyFilters()
  const groups = env.groupIds.map(env.groupName)
  if (groups.some((g) => !g)) return null
  if (groups.length) filters.dims.group = groups as string[]
  const store = f.store ?? env.store
  for (const k of STORE_FILTER_KEYS) if (store[k].length) filters.dims[k] = [...store[k]]
  // a single group clicked on a page already narrowed to groups: the click can only narrow further
  if (dims.group && filters.dims.group.length && !filters.dims.group.includes(dims.group)) return null
  return { ctx, filters }
}
