// The grouped ticket table behind the Ticket Status, Store wise and AMC Vendor reports (the Excel sheets that listed
// tickets under a CLUSTER / RESPONSIBLE / AMC BRAND heading with a total per heading): any number of heading levels
// (for example Responsible > Cluster > Store), then one line per ticket, one column per age bucket, and every
// heading or store can be opened or closed like an Excel pivot. Pure helpers: the screen and the Excel export both
// build their rows here, so what is exported is exactly what is on screen.

import { AGE_BUCKETS } from '@/lib/reporting/aging'
import { NO_OEM, NO_STORE, UNASSIGNED, type TicketFact } from './facts'

export type LevelKey = 'technician' | 'cluster' | 'region' | 'oem' | 'category' | 'store' | 'acAmcBrand' | 'acAmcVendor' | 'priorityList' | 'storeType'

export const NOT_SET = '(Not set)'

interface LevelDef { label: string; get: (t: TicketFact) => string; last: string }

export const LEVELS: Record<LevelKey, LevelDef> = {
  technician: { label: 'Responsible', get: (t) => t.technician, last: UNASSIGNED },
  cluster: { label: 'Cluster', get: (t) => t.cluster, last: NOT_SET },
  region: { label: 'Region', get: (t) => t.region, last: NOT_SET },
  oem: { label: 'OEM', get: (t) => t.oem, last: NO_OEM },
  category: { label: 'Category', get: (t) => t.category, last: '(No category)' },
  store: { label: 'Store', get: (t) => t.store, last: NO_STORE },
  acAmcBrand: { label: 'AC-AMC brand', get: (t) => t.acAmcBrand, last: NOT_SET },
  acAmcVendor: { label: 'AC-AMC vendor', get: (t) => t.acAmcVendor, last: NOT_SET },
  priorityList: { label: 'Store priority list as per Ops', get: (t) => t.priorityList, last: NOT_SET },
  storeType: { label: 'Store type', get: (t) => t.storeType, last: NOT_SET },
}

/** The ways a report can be laid out (what the headings are, outermost first). The viewer picks one. */
export interface Layout { id: string; label: string; levels: LevelKey[] }

export const LAYOUTS: Layout[] = [
  { id: 'cluster-store', label: 'Cluster › Store', levels: ['cluster', 'store'] },
  { id: 'tech-store', label: 'Responsible › Store', levels: ['technician', 'store'] },
  { id: 'tech-cluster-store', label: 'Responsible › Cluster › Store', levels: ['technician', 'cluster', 'store'] },
  { id: 'region-cluster-store', label: 'Region › Cluster › Store', levels: ['region', 'cluster', 'store'] },
  { id: 'category-store', label: 'Category › Store', levels: ['category', 'store'] },
  { id: 'oem-store', label: 'OEM › Store', levels: ['oem', 'store'] },
  { id: 'amc-brand-vendor-cluster-store', label: 'AC-AMC brand › Vendor › Cluster › Store', levels: ['acAmcBrand', 'acAmcVendor', 'cluster', 'store'] },
  { id: 'amc-vendor-store', label: 'AC-AMC vendor › Store', levels: ['acAmcVendor', 'store'] },
]
const LAYOUT_BY_ID = new Map(LAYOUTS.map((l) => [l.id, l]))
export const layoutById = (id: string | undefined, fallback: string): Layout => LAYOUT_BY_ID.get(id ?? '') ?? LAYOUT_BY_ID.get(fallback) ?? LAYOUTS[0]

/** A layout that groups by OEM only makes sense where some chosen service goes to an OEM. */
export const layoutUsesOem = (l: Layout) => l.levels.includes('oem')

export type TreeDepth = number | 'tickets'

/** "At least this many tickets" — a whole number from 1 to 1000; anything else means 1 (no narrowing). */
export function parseMinTickets(v: string | undefined): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 1000) : 1
}

/** Stores with fewer than `min` tickets in the whole result are left out (counted across every heading, not per heading). */
export function filterByMinTickets<T extends { store: string }>(rows: T[], min: number): T[] {
  if (min <= 1) return rows
  const perStore = new Map<string, number>()
  for (const r of rows) perStore.set(r.store, (perStore.get(r.store) ?? 0) + 1)
  return rows.filter((r) => (perStore.get(r.store) ?? 0) >= min)
}

// ── Building the tree ────────────────────────────────────────────────────────────────────────────

export interface TreeNode {
  /** unique path of the node, used to remember what is closed */
  key: string
  name: string
  depth: number
  children: TreeNode[]
  /** only the deepest level has tickets */
  tickets: TicketFact[]
  counts: Record<string, number>
  total: number
}

export interface TicketTree {
  levels: LevelKey[]
  /** Bucket labels in age order: only the ones that have at least one ticket. */
  buckets: string[]
  roots: TreeNode[]
  grand: { counts: Record<string, number>; total: number }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
const nameOrder = (a: string, b: string, last: string) => (a === last ? (b === last ? 0 : 1) : b === last ? -1 : byName(a, b))
const SEP = '\u0001'

export function buildTicketTree(rows: TicketFact[], levels: LevelKey[], minTickets = 1): TicketTree {
  // grouped by OEM, only tickets that have an OEM to do with them are listed (an IT ticket does not belong under an AC vendor)
  const base = levels.includes('oem') ? rows.filter((r) => r.oem !== '') : rows
  const kept = filterByMinTickets(base, minTickets)
  const used = new Set<string>()
  const grandCounts: Record<string, number> = {}

  const build = (items: TicketFact[], depth: number, parentKey: string): TreeNode[] => {
    const def = LEVELS[levels[depth]]
    const groups = new Map<string, TicketFact[]>()
    for (const t of items) {
      const name = def.get(t) || def.last
      const list = groups.get(name) ?? []
      list.push(t)
      groups.set(name, list)
    }
    return [...groups.entries()]
      .sort(([a], [b]) => nameOrder(a, b, def.last))
      .map(([name, list]) => {
        const key = `${parentKey}${SEP}${name}`
        const isLeaf = depth === levels.length - 1
        const node: TreeNode = { key, name, depth, children: [], tickets: [], counts: {}, total: 0 }
        if (isLeaf) {
          // oldest first, like the detail report
          node.tickets = [...list].sort((x, y) => y.ageDays - x.ageDays || byName(x.ticketNo, y.ticketNo))
          for (const t of node.tickets) { node.counts[t.ageBucket] = (node.counts[t.ageBucket] ?? 0) + 1; used.add(t.ageBucket) }
        } else {
          node.children = build(list, depth + 1, key)
          for (const c of node.children) for (const [k, v] of Object.entries(c.counts)) node.counts[k] = (node.counts[k] ?? 0) + v
        }
        node.total = Object.values(node.counts).reduce((a, b) => a + b, 0)
        return node
      })
  }

  const roots = kept.length > 0 ? build(kept, 0, '') : []
  for (const r of roots) for (const [k, v] of Object.entries(r.counts)) grandCounts[k] = (grandCounts[k] ?? 0) + v
  return {
    levels,
    buckets: AGE_BUCKETS.map((b) => b.label).filter((l) => used.has(l)),
    roots,
    grand: { counts: grandCounts, total: Object.values(grandCounts).reduce((a, b) => a + b, 0) },
  }
}

// ── What is shown, with headings and stores opened or closed ─────────────────────────────────────

export type TreeToggle = { key: string; name: string; expanded: boolean }

export interface TreeDisplayRow {
  kind: 'node' | 'ticket' | 'total'
  key: string
  /** one entry per heading level: the name on the first line of that heading, '' otherwise */
  labels: string[]
  /** the arrow shown next to a label */
  toggles: (TreeToggle | undefined)[]
  /** only on a ticket line */
  ticket?: TicketFact
  counts: Record<string, number>
  total: number
}

export function flattenTree(tree: TicketTree, collapsed: ReadonlySet<string> = new Set()): TreeDisplayRow[] {
  const rows: TreeDisplayRow[] = []
  const L = tree.levels.length
  let pending: ({ name: string; toggle: TreeToggle } | undefined)[] = Array(L).fill(undefined)

  const emit = (r: Omit<TreeDisplayRow, 'labels' | 'toggles'>) => {
    rows.push({ ...r, labels: pending.map((p) => p?.name ?? ''), toggles: pending.map((p) => p?.toggle) })
    pending = Array(L).fill(undefined)
  }

  const walk = (node: TreeNode) => {
    const isCollapsed = collapsed.has(node.key)
    pending[node.depth] = { name: node.name, toggle: { key: node.key, name: node.name, expanded: !isCollapsed } }
    if (isCollapsed) { emit({ kind: 'node', key: `n${node.key}`, counts: node.counts, total: node.total }); return }
    if (node.children.length > 0) node.children.forEach(walk)
    else for (const t of node.tickets) emit({ kind: 'ticket', key: `t${t.id}`, ticket: t, counts: { [t.ageBucket]: 1 }, total: 1 })
  }

  for (const root of tree.roots) {
    walk(root)
    if (!collapsed.has(root.key)) {
      // a total line after every outermost heading that is open
      rows.push({ kind: 'total', key: `g${root.key}`, labels: [`${root.name} Total`, ...Array(L - 1).fill('')], toggles: Array(L).fill(undefined), counts: root.counts, total: root.total })
    }
  }
  return rows
}

function allNodes(tree: TicketTree): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (n: TreeNode) => { out.push(n); n.children.forEach(walk) }
  tree.roots.forEach(walk)
  return out
}

/** The level buttons: close everything at one depth (so that depth shows as one line each), or open all the way to the tickets. */
export function collapsedForDepth(tree: TicketTree, depth: TreeDepth): Set<string> {
  if (depth === 'tickets') return new Set()
  return new Set(allNodes(tree).filter((n) => n.depth === depth).map((n) => n.key))
}

/** Which level button matches the current state, or null when the viewer has mixed it by hand. */
export function depthOf(tree: TicketTree, collapsed: ReadonlySet<string>): TreeDepth | null {
  const known = new Set(allNodes(tree).map((n) => n.key))
  const have = [...collapsed].filter((k) => known.has(k)).sort().join('|')
  if (have === '') return 'tickets'
  // deepest first, so an exact match is found before a shallower one that contains it
  for (let d = tree.levels.length - 1; d >= 0; d--) {
    if ([...collapsedForDepth(tree, d)].sort().join('|') === have) return d
  }
  return null
}

// ── Ticket columns (shared by the screen and the Excel file) ─────────────────────────────────────

export type ColumnKey =
  | 'category' | 'subCategory' | 'subject' | 'ticketNo' | 'technician' | 'oem' | 'status' | 'createdDate' | 'ageDays'
  | 'acNo' | 'oemTicketNo' | 'oemTicketDate' | 'oemBucket' | 'acResolution' | 'acTotal' | 'storeAcTickets' | 'acPct'
  | 'cluster' | 'region' | 'priorityList' | 'acAmcBrand' | 'acAmcVendor'

export const COLUMNS: Record<ColumnKey, { label: string; width: number; numeric?: boolean; acOnly?: boolean }> = {
  category: { label: 'Category', width: 28 },
  subCategory: { label: 'Sub Category', width: 30 },
  subject: { label: 'Subject', width: 44 },
  ticketNo: { label: 'Ticket No', width: 14 },
  technician: { label: 'Responsible', width: 22 },
  oem: { label: 'OEM', width: 26, acOnly: true },
  status: { label: 'Status', width: 16 },
  createdDate: { label: 'Created', width: 13 },
  ageDays: { label: 'Age (days)', width: 11, numeric: true },
  acNo: { label: 'AC No', width: 11, acOnly: true },
  oemTicketNo: { label: 'AC OEM Ticket No', width: 20, acOnly: true },
  oemTicketDate: { label: 'AC OEM Ticket Date', width: 17, acOnly: true },
  oemBucket: { label: 'OEM Age Bucket', width: 16, acOnly: true },
  acResolution: { label: 'AC Resolution', width: 22, acOnly: true },
  acTotal: { label: 'AC Total', width: 10, numeric: true, acOnly: true },
  storeAcTickets: { label: 'Open AC Tickets', width: 14, numeric: true, acOnly: true },
  acPct: { label: 'AC Not Working %', width: 15, numeric: true, acOnly: true },
  cluster: { label: 'Cluster', width: 12 },
  region: { label: 'Region', width: 11 },
  priorityList: { label: 'Store priority list as per Ops', width: 18 },
  acAmcBrand: { label: 'AC-AMC brand', width: 16, acOnly: true },
  acAmcVendor: { label: 'AC-AMC vendor', width: 26, acOnly: true },
}

/** A column that repeats a heading level is left out (the heading column already shows it); AC columns only where some service is an AC service. */
export function columnsFor(wanted: ColumnKey[], levels: LevelKey[], acAvailable: boolean): ColumnKey[] {
  return wanted.filter((c) => !(levels as string[]).includes(c) && (acAvailable || !COLUMNS[c].acOnly))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** dd Mon yyyy of a timestamp, in the server's local time zone. */
export function formatCreated(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
/** dd Mon yyyy of a plain yyyy-mm-dd day. */
export function formatDay(day: string | null): string {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})/.exec(day) : null
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''
}

export function cellValue(t: TicketFact, key: ColumnKey, statusLabel: (s: string) => string): string | number {
  switch (key) {
    case 'createdDate': return formatCreated(t.createdAt)
    case 'status': return statusLabel(t.status)
    case 'ageDays': return t.ageDays
    case 'oemTicketDate': return formatDay(t.oemTicketDate)
    case 'acTotal': return t.acTotal ?? ''
    case 'storeAcTickets': return t.isStoreAccount && t.isAcTicket ? t.storeAcTickets : ''
    case 'acPct': return t.acNotWorkingPct == null ? '' : `${Math.round(t.acNotWorkingPct)}%`
    default: return (t[key as keyof TicketFact] as string | undefined) ?? ''
  }
}
