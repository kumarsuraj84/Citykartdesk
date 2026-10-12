// The tree behind the "Ticket Status" and "Store wise" reports (the Excel sheets that listed tickets under
// a CLUSTER / RESPONSIBLE heading with a total per heading): group → store → ticket, one column per age
// bucket. The top level can be the Responsible technician, the store's OEM (CK Desk has no cluster, the
// OEM is the grouping every store already has) or the Category. Pure helpers — the screen and the Excel
// export both build their rows here, so what is exported is exactly what is on screen.

import { AGE_BUCKETS } from '@/lib/reporting/aging'
import { UNASSIGNED, NO_CATEGORY } from './age-summary'
import type { DetailRow } from './ticket-detail'

export type TreeGroupBy = 'technician' | 'oem' | 'category'
export type TreeLevel = 'groups' | 'stores' | 'tickets'

export const NO_OEM = '(No OEM)'
export const NO_STORE = '(No store)'

export const TREE_GROUP_BYS: { value: TreeGroupBy; label: string }[] = [
  { value: 'technician', label: 'Responsible' },
  { value: 'oem', label: 'OEM' },
  { value: 'category', label: 'Category' },
]

export const TREE_LEVELS: TreeLevel[] = ['groups', 'stores', 'tickets']

export function parseGroupBy(v: string | undefined, fallback: TreeGroupBy): TreeGroupBy {
  return TREE_GROUP_BYS.some((g) => g.value === v) ? (v as TreeGroupBy) : fallback
}

export const groupByLabel = (g: TreeGroupBy) => TREE_GROUP_BYS.find((x) => x.value === g)!.label

/** "At least this many tickets" — a whole number from 1 to 1000; anything else means 1 (no narrowing). */
export function parseMinTickets(v: string | undefined): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 1000) : 1
}

/** A ticket line of the tree: the detail row plus the store it was raised from and that store's OEM. */
export interface TreeTicket extends DetailRow {
  /** The store code (the store's requester account), or the requester's name when they are not a store. */
  store: string
  oem: string
}

export interface TreeStore { name: string; tickets: TreeTicket[]; counts: Record<string, number>; total: number }
export interface TreeGroup { name: string; stores: TreeStore[]; counts: Record<string, number>; total: number }
export interface TicketTree {
  /** Bucket labels in age order — only the ones that have at least one ticket. */
  buckets: string[]
  groups: TreeGroup[]
  grand: { counts: Record<string, number>; total: number }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
const lastName = (g: TreeGroupBy) => (g === 'technician' ? UNASSIGNED : g === 'oem' ? NO_OEM : NO_CATEGORY)
const nameOrder = (a: string, b: string, last: string) => (a === last ? (b === last ? 0 : 1) : b === last ? -1 : byName(a, b))
const addCounts = (into: Record<string, number>, from: Record<string, number>) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v }
const sum = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0)

function groupValue(t: TreeTicket, by: TreeGroupBy): string {
  return by === 'technician' ? t.technician : by === 'oem' ? t.oem : t.category
}

/** Stores with fewer than `min` tickets in the whole result are left out (counted across every group, not per group). */
export function filterByMinTickets<T extends { store: string }>(rows: T[], min: number): T[] {
  if (min <= 1) return rows
  const perStore = new Map<string, number>()
  for (const r of rows) perStore.set(r.store, (perStore.get(r.store) ?? 0) + 1)
  return rows.filter((r) => (perStore.get(r.store) ?? 0) >= min)
}

export function buildTicketTree(rows: TreeTicket[], by: TreeGroupBy, minTickets = 1): TicketTree {
  const kept = filterByMinTickets(rows, minTickets)
  const groups = new Map<string, Map<string, TreeTicket[]>>()
  for (const t of kept) {
    const g = groupValue(t, by) || lastName(by)
    const stores = groups.get(g) ?? new Map<string, TreeTicket[]>()
    const list = stores.get(t.store) ?? []
    list.push(t)
    stores.set(t.store, list)
    groups.set(g, stores)
  }

  const used = new Set<string>()
  const grandCounts: Record<string, number> = {}
  const built: TreeGroup[] = [...groups.entries()]
    .sort(([a], [b]) => nameOrder(a, b, lastName(by)))
    .map(([name, stores]) => {
      const groupCounts: Record<string, number> = {}
      const storeList: TreeStore[] = [...stores.entries()]
        .sort(([a], [b]) => nameOrder(a, b, NO_STORE))
        .map(([sname, tickets]) => {
          // oldest first, like the detail report
          const sorted = [...tickets].sort((x, y) => y.ageDays - x.ageDays || byName(x.ticketNo, y.ticketNo))
          const counts: Record<string, number> = {}
          for (const t of sorted) { counts[t.ageBucket] = (counts[t.ageBucket] ?? 0) + 1; used.add(t.ageBucket) }
          addCounts(groupCounts, counts)
          return { name: sname, tickets: sorted, counts, total: sorted.length }
        })
      addCounts(grandCounts, groupCounts)
      return { name, stores: storeList, counts: groupCounts, total: sum(groupCounts) }
    })

  return { buckets: AGE_BUCKETS.map((b) => b.label).filter((l) => used.has(l)), groups: built, grand: { counts: grandCounts, total: sum(grandCounts) } }
}

// ── What is shown, with groups and stores opened or closed ─────────────────────────────────────────

export interface TreeCollapsed {
  /** Group names whose stores are hidden. */
  group: ReadonlySet<string>
  /** Stores (key = storeKey(group, store)) whose tickets are hidden. */
  store: ReadonlySet<string>
}

export const NOTHING_COLLAPSED_TREE: TreeCollapsed = { group: new Set(), store: new Set() }
export const storeKey = (group: string, store: string) => `${group}\u0001${store}`

export type TreeToggle = { type: 'group' | 'store'; key: string; expanded: boolean }

export interface TreeDisplayRow {
  kind: 'group' | 'store' | 'ticket' | 'groupTotal'
  key: string
  groupLabel: string
  storeLabel: string
  groupToggle?: TreeToggle
  storeToggle?: TreeToggle
  /** Only on a ticket line. */
  ticket?: TreeTicket
  counts: Record<string, number>
  total: number
}

export function flattenTree(tree: TicketTree, collapsed: TreeCollapsed = NOTHING_COLLAPSED_TREE): TreeDisplayRow[] {
  const rows: TreeDisplayRow[] = []
  for (const g of tree.groups) {
    if (collapsed.group.has(g.name)) {
      rows.push({
        kind: 'group', key: `g|${g.name}`, groupLabel: g.name, storeLabel: '',
        groupToggle: { type: 'group', key: g.name, expanded: false }, counts: g.counts, total: g.total,
      })
      continue
    }
    let first = true
    for (const s of g.stores) {
      const sk = storeKey(g.name, s.name)
      const groupToggle: TreeToggle | undefined = first ? { type: 'group', key: g.name, expanded: true } : undefined
      if (collapsed.store.has(sk)) {
        rows.push({
          kind: 'store', key: `s|${sk}`, groupLabel: first ? g.name : '', storeLabel: s.name,
          groupToggle, storeToggle: { type: 'store', key: sk, expanded: false }, counts: s.counts, total: s.total,
        })
        first = false
        continue
      }
      s.tickets.forEach((t, i) => {
        rows.push({
          kind: 'ticket', key: `t|${t.id}`, groupLabel: first ? g.name : '', storeLabel: i === 0 ? s.name : '',
          groupToggle: first ? groupToggle : undefined,
          storeToggle: i === 0 ? { type: 'store', key: sk, expanded: true } : undefined,
          ticket: t, counts: { [t.ageBucket]: 1 }, total: 1,
        })
        first = false
      })
    }
    rows.push({ kind: 'groupTotal', key: `gt|${g.name}`, groupLabel: `${g.name} Total`, storeLabel: '', counts: g.counts, total: g.total })
  }
  return rows
}

/** The 1 / 2 / 3 level buttons: how much detail to show everywhere. */
export function collapsedForTreeLevel(tree: TicketTree, level: TreeLevel): TreeCollapsed {
  if (level === 'groups') return { group: new Set(tree.groups.map((g) => g.name)), store: new Set() }
  if (level === 'stores') return { group: new Set(), store: new Set(tree.groups.flatMap((g) => g.stores.map((s) => storeKey(g.name, s.name)))) }
  return NOTHING_COLLAPSED_TREE
}

/** Which level button matches the current state, or null when the viewer has mixed it by hand. */
export function treeLevelOf(tree: TicketTree, collapsed: TreeCollapsed): TreeLevel | null {
  for (const level of ['tickets', 'stores', 'groups'] as TreeLevel[]) {
    const want = collapsedForTreeLevel(tree, level)
    const sameGroup = want.group.size === collapsed.group.size && [...want.group].every((k) => collapsed.group.has(k))
    const sameStore = level === 'groups' ? true : want.store.size === collapsed.store.size && [...want.store].every((k) => collapsed.store.has(k))
    if (sameGroup && sameStore) return level
  }
  return null
}

// ── Ticket columns (shared by the screen and the Excel file) ────────────────────────────────────────

export type TreeColumnKey = 'category' | 'subCategory' | 'subject' | 'ticketNo' | 'technician' | 'oem' | 'status' | 'createdDate' | 'ageDays'

export const TREE_COLUMNS: { key: TreeColumnKey; label: string; width: number; numeric?: boolean }[] = [
  { key: 'category', label: 'Category', width: 28 },
  { key: 'subCategory', label: 'Sub Category', width: 30 },
  { key: 'subject', label: 'Subject', width: 44 },
  { key: 'ticketNo', label: 'Ticket No', width: 14 },
  { key: 'technician', label: 'Responsible', width: 22 },
  { key: 'oem', label: 'OEM', width: 26 },
  { key: 'status', label: 'Status', width: 16 },
  { key: 'createdDate', label: 'Created', width: 13 },
  { key: 'ageDays', label: 'Age (days)', width: 11, numeric: true },
]

/** The ticket columns for a grouping: the column the report is grouped by is the first column already, so it is not repeated. */
export function treeColumns(by: TreeGroupBy) {
  return TREE_COLUMNS.filter((c) => c.key !== by)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** dd Mon yyyy — in the server's local time zone. */
export function formatCreated(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function treeCell(t: TreeTicket, key: TreeColumnKey, statusLabel: (s: string) => string): string | number {
  switch (key) {
    case 'createdDate': return formatCreated(t.createdAt)
    case 'status': return statusLabel(t.status)
    case 'ageDays': return t.ageDays
    default: return t[key] ?? ''
  }
}
