// The Store AC Not Working report (the Excel's "Store AC Not Working" and "Red Flag Store" sheets): one line per store with
// open AC tickets, its AC total, the AC Not Working % (open AC tickets / AC total) and a red flag when that is above the
// limit, and the store's tickets counted by age. Stores can be grouped (by cluster, region ...) and each group opened or closed.
// Every ticket counts, also when the same AC has two tickets: both have to be fixed.

import { AGE_BUCKETS } from '@/lib/reporting/aging'
import type { TicketFact } from './facts'
import { NOT_SET } from './ticket-tree'

/** The store columns, shared by the screen and the Excel file. */
export const STORE_AC_COLUMNS = ['Store', 'City', 'Cluster', 'Region', 'Store priority list as per Ops', 'AC brand', 'AC-AMC brand', 'AC Total', 'Open AC Tickets', 'AC Not Working %', 'Red Flag', 'Zenatix'] as const

export type StoreAcGroupBy = 'cluster' | 'region' | 'priorityList' | 'acAmcBrand' | 'none'

export const STORE_AC_GROUPS: { value: StoreAcGroupBy; label: string }[] = [
  { value: 'cluster', label: 'Cluster' },
  { value: 'region', label: 'Region' },
  { value: 'priorityList', label: 'Store priority list as per Ops' },
  { value: 'acAmcBrand', label: 'AC-AMC brand' },
  { value: 'none', label: 'No grouping' },
]

export function parseStoreAcGroup(v: string | undefined): StoreAcGroupBy {
  return STORE_AC_GROUPS.some((g) => g.value === v) ? (v as StoreAcGroupBy) : 'cluster'
}

export interface StoreAcRow {
  store: string
  city: string
  cluster: string
  region: string
  priorityList: string
  acBrand: string
  acAmcBrand: string
  acAmcVendor: string
  zenatix: string
  acTotal: number | null
  /** open AC tickets of the store (what the % is worked out from) */
  openAcTickets: number
  /** percentage 0-100, null when the AC total is not known */
  pct: number | null
  redFlag: boolean
  /** the store's tickets in this report, counted by age bucket */
  counts: Record<string, number>
  total: number
}

export interface StoreAcGroup {
  key: string
  name: string
  stores: StoreAcRow[]
  counts: Record<string, number>
  total: number
  acTotal: number
  openAcTickets: number
  pct: number | null
}

export interface StoreAcReport {
  buckets: string[]
  groups: StoreAcGroup[]
  grand: { counts: Record<string, number>; total: number; acTotal: number; openAcTickets: number; pct: number | null; stores: number; redFlagStores: number }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
const percent = (tickets: number, acs: number): number | null => (acs > 0 ? (tickets / acs) * 100 : null)

export function buildStoreAc(tickets: TicketFact[], groupBy: StoreAcGroupBy, redFlagPercent: number): StoreAcReport {
  const byStore = new Map<string, TicketFact[]>()
  for (const t of tickets) {
    const list = byStore.get(t.store) ?? []
    list.push(t)
    byStore.set(t.store, list)
  }

  const used = new Set<string>()
  const rows: StoreAcRow[] = [...byStore.entries()].map(([store, list]) => {
    const first = list[0]
    const counts: Record<string, number> = {}
    for (const t of list) { counts[t.ageBucket] = (counts[t.ageBucket] ?? 0) + 1; used.add(t.ageBucket) }
    return {
      store, city: first.city, cluster: first.cluster, region: first.region, priorityList: first.priorityList,
      acBrand: first.acBrand, acAmcBrand: first.acAmcBrand, acAmcVendor: first.acAmcVendor, zenatix: first.zenatix,
      acTotal: first.acTotal, openAcTickets: first.storeAcTickets,
      pct: first.acNotWorkingPct, redFlag: first.acNotWorkingPct != null && first.acNotWorkingPct > redFlagPercent,
      counts, total: list.length,
    }
  })

  const groupName = (r: StoreAcRow) => (groupBy === 'none' ? 'All stores' : r[groupBy] || NOT_SET)
  const groups = new Map<string, StoreAcRow[]>()
  for (const r of rows) {
    const g = groups.get(groupName(r)) ?? []
    g.push(r)
    groups.set(groupName(r), g)
  }

  const grandCounts: Record<string, number> = {}
  let grandAc = 0
  let grandOpen = 0
  const built: StoreAcGroup[] = [...groups.entries()]
    .sort(([a], [b]) => (a === NOT_SET ? 1 : b === NOT_SET ? -1 : byName(a, b)))
    .map(([name, stores]) => {
      // the worst stores first, then by name
      stores.sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1) || byName(x.store, y.store))
      const counts: Record<string, number> = {}
      let acTotal = 0
      let open = 0
      for (const s of stores) {
        for (const [k, v] of Object.entries(s.counts)) { counts[k] = (counts[k] ?? 0) + v; grandCounts[k] = (grandCounts[k] ?? 0) + v }
        // only stores whose AC total is known take part in the group's %
        if (s.acTotal) { acTotal += s.acTotal; open += s.openAcTickets }
      }
      grandAc += acTotal
      grandOpen += open
      return { key: name, name, stores, counts, total: stores.reduce((a, s) => a + s.total, 0), acTotal, openAcTickets: open, pct: percent(open, acTotal) }
    })

  return {
    buckets: AGE_BUCKETS.map((b) => b.label).filter((l) => used.has(l)),
    groups: built,
    grand: {
      counts: grandCounts, total: built.reduce((a, g) => a + g.total, 0), acTotal: grandAc, openAcTickets: grandOpen, pct: percent(grandOpen, grandAc),
      stores: rows.length, redFlagStores: rows.filter((r) => r.redFlag).length,
    },
  }
}

// ── Open and closed groups ───────────────────────────────────────────────────────────────────────

export interface StoreAcDisplayRow {
  kind: 'group' | 'store'
  key: string
  group: StoreAcGroup
  store?: StoreAcRow
  expanded?: boolean
}

export function flattenStoreAc(report: StoreAcReport, collapsed: ReadonlySet<string>, groupBy: StoreAcGroupBy): StoreAcDisplayRow[] {
  const rows: StoreAcDisplayRow[] = []
  for (const g of report.groups) {
    const open = !collapsed.has(g.key)
    // "No grouping" has one group that is not worth a line of its own
    if (groupBy !== 'none') rows.push({ kind: 'group', key: `g|${g.key}`, group: g, expanded: open })
    if (open) for (const s of g.stores) rows.push({ kind: 'store', key: `s|${g.key}|${s.store}`, group: g, store: s })
  }
  return rows
}

export function pctText(pct: number | null): string {
  return pct == null ? '' : `${Math.round(pct)}%`
}
