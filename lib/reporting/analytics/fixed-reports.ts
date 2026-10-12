// The fixed predefined reports: the 12 sheets of "Citykart Desk Zoho Report.xlsx", under the names of those sheets. Nothing can be chosen inside a report
// (no dates, no filters, no group): each one is a fixed question about the tickets still being worked on, drawn like the Excel pivot it replaces. A number is
// clickable and opens the tickets behind it. A viewer only ever gets the tickets of the technician groups they may see.

import { AGE_BUCKETS } from '@/lib/reporting/aging'
import type { RequestStatus } from '@/types'
import { isServerRoomAc, type TicketFact } from './facts'
import { UNASSIGNED, NO_CATEGORY, techOf, catOf, subOf } from './age-summary'
import {
  byName, shortDate, type Cell, type HeadGroup, type ReportColumn, type ReportRow, type ReportTable, type ReportTicket, type RowKind,
} from './report-table'

/** What the section is called in the menu and on its pages. */
export const REPORTS_NAME = 'Fixed predefined Reports'

export type ReportLayout = 'summary' | 'status' | 'cluster-list' | 'store-ac' | 'red-flag' | 'amc-vendor'

export interface FixedReportDef {
  slug: string
  /** exactly the name of the Excel sheet */
  title: string
  layout: ReportLayout
  /** only tickets of this technician group ("Admin", "BD": the group's name without the word Group) */
  group?: string
  /** only tickets of these services (names, any capitals) */
  services?: string[]
  /** only tickets of services that go to an OEM (AC servicing) */
  acOnly?: boolean
  /** only tickets raised by new stores (NSO) */
  nso?: boolean
  /** the statuses counted; the six "still being worked" statuses unless the report says otherwise */
  statuses: RequestStatus[]
  /** a list report with a Status column (the report that is only about one status has none) */
  statusColumn?: boolean
  /** the sentence under the title */
  about: string
}

export const OPEN_STATUSES: RequestStatus[] = ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval']

const ADMIN_AC = 'ADMIN - AC'

/** In the order of the sheets of the Excel file. */
export const FIXED_REPORTS: FixedReportDef[] = [
  { slug: 'red-flag-store-report', title: '🚩Red Flag Store Report', layout: 'red-flag', acOnly: true, statuses: OPEN_STATUSES,
    about: 'Stores whose open AC tickets are more than 30% of their ACs.' },
  { slug: 'store-ac-not-working-report', title: 'Store AC Not Working Report', layout: 'store-ac', acOnly: true, statuses: OPEN_STATUSES,
    about: 'Open AC tickets of every store, by age, as a share of the store’s ACs.' },
  { slug: 'amc-vendor-report', title: 'AMC Vendor Report', layout: 'amc-vendor', acOnly: true, statuses: OPEN_STATUSES,
    about: 'Open AC tickets by AMC brand and vendor, with the OEM ticket.' },
  { slug: 'store-side-pending-tickets-report', title: 'Store Side Pending Tickets Report', layout: 'cluster-list', statuses: ['waiting_user'],
    about: 'Tickets waiting on the store, by cluster.' },
  { slug: 'ac-issues-report', title: 'AC Issues Report', layout: 'cluster-list', services: [ADMIN_AC], statuses: OPEN_STATUSES, statusColumn: true,
    about: 'Open tickets of the service ADMIN - AC, by cluster.' },
  { slug: 'repair-maintenance-report', title: 'Repair & Maintenance Report', layout: 'cluster-list', services: ['ADMIN REPAIR'], statuses: OPEN_STATUSES, statusColumn: true,
    about: 'Open tickets of the service ADMIN REPAIR, by cluster.' },
  { slug: 'admin-requirement-report', title: 'Admin Requirement Report', layout: 'cluster-list', services: ['ADMIN - REQUIREMENTS (NON TRADING)'], statuses: OPEN_STATUSES, statusColumn: true,
    about: 'Open tickets of the service ADMIN - REQUIREMENTS (NON TRADING), by cluster.' },
  { slug: 'nso-status-report', title: 'NSO Status Report', layout: 'status', nso: true, statuses: OPEN_STATUSES,
    about: 'Open tickets of new stores (NSO), by technician.' },
  { slug: 'nso-summary-report', title: 'NSO Summary Report', layout: 'summary', nso: true, statuses: OPEN_STATUSES,
    about: 'Open tickets of new stores (NSO), by technician and category.' },
  { slug: 'bd-status-report', title: 'BD Status Report', layout: 'status', group: 'BD', statuses: OPEN_STATUSES,
    about: 'Open tickets of the BD group, by technician.' },
  { slug: 'bd-summary-report', title: 'BD Summary Report', layout: 'summary', group: 'BD', statuses: OPEN_STATUSES,
    about: 'Open tickets of the BD group, by technician and category.' },
  { slug: 'admin-summary-report', title: 'Admin Summary Report', layout: 'summary', group: 'Admin', statuses: OPEN_STATUSES,
    about: 'Open tickets of the Admin group, by technician and category.' },
]

export const findFixedReport = (slug: string) => FIXED_REPORTS.find((r) => r.slug === slug)

/** Letters and numbers only, any capitals: how service names are compared. */
export const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// ── Building a report ────────────────────────────────────────────────────────────────────────────

export interface BuildInput {
  def: FixedReportDef
  /** the tickets the report counts (already limited to its group, services, statuses and the viewer's own groups) */
  facts: TicketFact[]
  /** tickets created or resolved on the reference day, whatever their status now (for the "today" columns of a summary) */
  dayFacts?: TicketFact[]
  /** the reference day */
  day?: { start: Date; end: Date; word: string }
  statusLabel: (s: string) => string
  /** the statuses counted when the viewer chose others than the report's own */
  statuses?: RequestStatus[]
}

const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const NO_CLUSTER = '(No cluster)'

/** The tickets of a report, each added once; a cell points at them by position. */
class Tickets {
  list: ReportTicket[] = []
  private index = new Map<string, number>()
  ref(f: TicketFact, statusLabel: (s: string) => string): number {
    const known = this.index.get(f.id)
    if (known !== undefined) return known
    const t: ReportTicket = {
      id: f.id, no: f.ticketNo, subject: f.subject, store: f.store || f.requester, cluster: f.cluster || NO_CLUSTER,
      tech: techOf(f.technician), cat: catOf(f.category), sub: subOf(f.subCategory), service: f.service, status: statusLabel(f.status),
      created: localDay(f.createdAt), age: f.ageDays, bucket: f.ageBucket,
    }
    this.list.push(t)
    this.index.set(f.id, this.list.length - 1)
    return this.list.length - 1
  }
}

const usedBuckets = (facts: TicketFact[]) => {
  const used = new Set(facts.map((f) => f.ageBucket))
  return AGE_BUCKETS.map((b) => b.label).filter((l) => used.has(l))
}
const nameOrder = (a: string, b: string, last: string) => (a === last ? (b === last ? 0 : 1) : b === last ? -1 : byName(a, b))
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const col = (key: string, label: string, width: number, o: Partial<ReportColumn> = {}): ReportColumn => ({ key, label, width, ...o })
const numCol = (key: string, label: string, width: number, o: Partial<ReportColumn> = {}): ReportColumn => col(key, label, width, { align: 'right', ...o })
const bucketCols = (buckets: string[]) => buckets.map((b) => numCol(`b:${b}`, b, 62, { align: 'center' }))

interface Group<T> { key: string; items: T[] }
function groupBy<T>(items: T[], key: (t: T) => string, order: (a: string, b: string) => number): Group<T>[] {
  const m = new Map<string, T[]>()
  for (const i of items) { const k = key(i); const a = m.get(k); if (a) a.push(i); else m.set(k, [i]) }
  return [...m].sort(([a], [b]) => order(a, b)).map(([k, v]) => ({ key: k, items: v }))
}

export function buildFixedReport(input: BuildInput): ReportTable {
  const { def, facts, statusLabel } = input
  const tk = new Tickets()
  const refs = (fs: TicketFact[]) => (fs.length ? fs.map((f) => tk.ref(f, statusLabel)) : undefined)
  const row = (key: string, kind: RowKind, cells: Cell[], r: (number[] | undefined)[]): ReportRow => ({ key, kind, cells, refs: r })

  let columns: ReportColumn[] = []
  let headGroups: HeadGroup[] = []
  let lead = 1
  const rows: ReportRow[] = []
  let dayWord: string | undefined

  if (def.layout === 'summary') {
    const buckets = usedBuckets(facts)
    const day = input.day
    dayWord = day?.word
    const a = day?.start.toISOString() ?? ''
    const b = day?.end.toISOString() ?? ''
    const within = (iso: string | null) => !!iso && iso >= a && iso <= b
    const dayFacts = (input.dayFacts ?? []).filter((f) => f.status !== 'cancelled')
    lead = 2
    columns = [col('tech', 'Responsible', 140), col('cat', 'Category', 180), ...bucketCols(buckets),
      numCol('total', 'Total Tickets', 66, { peach: true }), numCol('created', `Created ${dayWord ?? 'today'}`, 86, { peach: true }), numCol('resolved', `Resolved ${dayWord ?? 'today'}`, 86, { peach: true })]
    // every technician or category that has a counted ticket or something that day
    const techs = new Set([...facts, ...dayFacts].map((f) => techOf(f.technician)))
    const line = (key: string, kind: RowKind, label: [Cell, Cell], mine: TicketFact[], dayMine: TicketFact[]) => {
      const created = dayMine.filter((f) => within(f.createdAt))
      const resolved = dayMine.filter((f) => within(f.resolvedAt))
      rows.push(row(key, kind, [
        label[0], label[1],
        ...buckets.map((x) => mine.filter((f) => f.ageBucket === x).length || ''),
        mine.length || '', created.length || '', resolved.length || '',
      ], [undefined, undefined, ...buckets.map((x) => refs(mine.filter((f) => f.ageBucket === x))), refs(mine), refs(created), refs(resolved)]))
    }
    for (const t of [...techs].sort((x, y) => nameOrder(x, y, UNASSIGNED))) {
      const mineT = facts.filter((f) => techOf(f.technician) === t)
      const dayT = dayFacts.filter((f) => techOf(f.technician) === t)
      const cats = new Set([...mineT, ...dayT].map((f) => catOf(f.category)))
      let first = true
      for (const c of [...cats].sort((x, y) => nameOrder(x, y, NO_CATEGORY))) {
        line(`${t}|${c}`, 'row', [first ? t : '', c], mineT.filter((f) => catOf(f.category) === c), dayT.filter((f) => catOf(f.category) === c))
        first = false
      }
      line(`${t}|total`, 'subtotal', [`${t} Total`, ''], mineT, dayT)
    }
    if (rows.length > 0) line('grand', 'grand', ['Grand Total', ''], facts, dayFacts)
  }

  if (def.layout === 'status') {
    const buckets = usedBuckets(facts)
    lead = 2
    columns = [col('tech', 'Responsible', 130), col('cluster', 'CLUSTER', 70), col('store', 'Requester', 70), col('cat', 'Category', 150), col('sub', 'Sub Category', 170),
      col('subject', 'Subject', 240), col('no', 'Request #', 100), ...bucketCols(buckets), numCol('total', 'Grand Total', 66, { peach: true })]
    const techs = groupBy(facts, (f) => techOf(f.technician), (x, y) => nameOrder(x, y, UNASSIGNED))
    const totalCells = (mine: TicketFact[]): [Cell[], (number[] | undefined)[]] => [
      [...buckets.map((x) => mine.filter((f) => f.ageBucket === x).length || ''), mine.length],
      [...buckets.map((x) => refs(mine.filter((f) => f.ageBucket === x))), refs(mine)],
    ]
    for (const g of techs) {
      const sorted = [...g.items].sort((x, y) => byName(x.cluster || NO_CLUSTER, y.cluster || NO_CLUSTER) || byName(x.store || x.requester, y.store || y.requester) || byName(x.category, y.category) || byName(x.subCategory, y.subCategory) || byName(x.ticketNo, y.ticketNo))
      for (const f of sorted) {
        const r = refs([f])
        rows.push(row(f.id, 'row', [g.key, f.cluster || NO_CLUSTER, f.store || f.requester, catOf(f.category), subOf(f.subCategory), f.subject, f.ticketNo,
          ...buckets.map((x) => (f.ageBucket === x ? 1 : '')), 1], columns.map(() => r)))
      }
      // a "<name> Total" line only when there is more than one technician (with one it would repeat the Grand Total)
      if (techs.length > 1) {
        const [cells, rf] = totalCells(g.items)
        rows.push(row(`${g.key}|total`, 'subtotal', [`${g.key} Total`, '', '', '', '', '', '', ...cells], [undefined, undefined, undefined, undefined, undefined, undefined, undefined, ...rf]))
      }
    }
    if (rows.length > 0) {
      const [cells, rf] = totalCells(facts)
      rows.push(row('grand', 'grand', ['Grand Total', '', '', '', '', '', '', ...cells], [undefined, undefined, undefined, undefined, undefined, undefined, undefined, ...rf]))
    }
  }

  if (def.layout === 'cluster-list') {
    const buckets = usedBuckets(facts)
    lead = 2
    const withStatus = !!def.statusColumn
    columns = [col('cluster', 'CLUSTER', 70), col('store', 'Requester', 70), col('cat', 'Category', 150), col('sub', 'Sub Category', 170), col('subject', 'Subject', 240),
      col('no', 'Request #', 100), col('created', 'Created', 80), ...(withStatus ? [col('status', 'Status', 110)] : []), ...bucketCols(buckets), numCol('total', 'Grand Total', 66, { peach: true })]
    const fixed = 7 + (withStatus ? 1 : 0)
    const blanks = (n: number) => Array.from({ length: n }, () => '' as Cell)
    const none = (n: number) => Array.from({ length: n }, () => undefined)
    const totals = (mine: TicketFact[]): [Cell[], (number[] | undefined)[]] => [
      [...buckets.map((x) => mine.filter((f) => f.ageBucket === x).length || ''), mine.length],
      [...buckets.map((x) => refs(mine.filter((f) => f.ageBucket === x))), refs(mine)],
    ]
    for (const g of groupBy(facts, (f) => f.cluster || NO_CLUSTER, byName)) {
      const sorted = [...g.items].sort((x, y) => byName(x.store || x.requester, y.store || y.requester) || byName(x.category, y.category) || byName(x.subCategory, y.subCategory) || byName(x.ticketNo, y.ticketNo))
      for (const f of sorted) {
        const r = refs([f])
        rows.push(row(f.id, 'row', [g.key, f.store || f.requester, catOf(f.category), subOf(f.subCategory), f.subject, f.ticketNo, shortDate(localDay(f.createdAt)),
          ...(withStatus ? [statusLabel(f.status)] : []), ...buckets.map((x) => (f.ageBucket === x ? 1 : '')), 1], columns.map(() => r)))
      }
      const [cells, rf] = totals(g.items)
      rows.push(row(`${g.key}|total`, 'subtotal', [`${g.key} Total`, ...blanks(fixed - 1), ...cells], [...none(fixed), ...rf]))
    }
    if (rows.length > 0) {
      const [cells, rf] = totals(facts)
      rows.push(row('grand', 'grand', ['Grand Total', ...blanks(fixed - 1), ...cells], [...none(fixed), ...rf]))
    }
  }

  if (def.layout === 'store-ac' || def.layout === 'red-flag') {
    // the AC tickets of a store's own ACs (the Server Room AC is not one of them)
    const acTickets = facts.filter((f) => f.isAcTicket && !isServerRoomAc(f.acNo))
    const red = def.layout === 'red-flag'
    const stores = groupBy(acTickets, (f) => f.store || f.requester, byName)
      .map((g) => ({ key: g.key, items: g.items, first: g.items[0] }))
      .filter((s) => !red || s.first.redFlag === 'Yes')
    const buckets = red ? [] : usedBuckets(stores.flatMap((s) => s.items))
    const pctOf = (n: number, ac: number | null) => (ac && ac > 0 ? n / ac : '')
    lead = 1
    columns = [col('store', 'Requester', 70), col('city', 'CITY', 140), col('cluster', 'CLUSTER', 70), col('plist', 'PRIORITY LIST', 100), col('amc', 'AMC BRAND', 100),
      numCol('ac', 'AC TOTAL', 66), col('zen', 'ZENATIX', 72, { align: 'center' }),
      ...bucketCols(buckets),
      ...buckets.map((b) => numCol(`p:${b}`, b, 62, { align: 'center', pct: true })),
      numCol('total', 'Total Ticket', 72, { peach: true }), numCol('pct', 'Total Sum of Ticket %', 100, { peach: true, pct: true })]
    if (!red) headGroups = [{ label: 'Ticket', from: 7, span: buckets.length }, { label: 'Sum of Ticket %', from: 7 + buckets.length, span: buckets.length }]
    const sorted = [...stores].sort((x, y) => (y.first.acNotWorkingPct ?? -1) - (x.first.acNotWorkingPct ?? -1) || byName(x.key, y.key))
    for (const s of sorted) {
      const f = s.first
      const ac = f.acTotal
      const all = refs(s.items)
      const inBucket = (x: string) => s.items.filter((t) => t.ageBucket === x)
      rows.push(row(s.key, 'row', [s.key, f.city || '', f.cluster || NO_CLUSTER, f.priorityList || '', f.acAmcBrand || '', ac ?? '', f.zenatix || '',
        ...buckets.map((x) => inBucket(x).length || ''),
        ...buckets.map((x) => (inBucket(x).length ? pctOf(inBucket(x).length, ac) : '')),
        s.items.length, pctOf(s.items.length, ac)],
      [all, all, all, all, all, all, all, ...buckets.map((x) => refs(inBucket(x))), ...buckets.map((x) => refs(inBucket(x))), all, all]))
    }
    if (rows.length > 0) {
      const allT = stores.flatMap((s) => s.items)
      const acSum = (list: typeof stores) => sum(list.map((s) => s.first.acTotal ?? 0))
      const bucketStores = (x: string) => stores.filter((s) => s.items.some((t) => t.ageBucket === x))
      const countIn = (x: string) => allT.filter((t) => t.ageBucket === x).length
      const grandRefs = refs(allT)
      rows.push(row('grand', 'grand', ['Grand Total', '', '', '', '', '', '',
        ...buckets.map((x) => countIn(x) || ''),
        ...buckets.map((x) => pctOf(countIn(x), acSum(bucketStores(x)))),
        allT.length, pctOf(allT.length, acSum(stores))],
      [undefined, undefined, undefined, undefined, undefined, undefined, undefined, ...buckets.map((x) => refs(allT.filter((t) => t.ageBucket === x))), ...buckets.map((x) => refs(allT.filter((t) => t.ageBucket === x))), grandRefs, grandRefs]))
    }
  }

  if (def.layout === 'amc-vendor') {
    const list = facts.filter((f) => f.isAcTicket && !isServerRoomAc(f.acNo))
      .sort((x, y) => byName(x.acAmcBrand, y.acAmcBrand) || byName(x.acAmcVendor, y.acAmcVendor) || byName(x.cluster, y.cluster) || byName(x.store || x.requester, y.store || y.requester) || byName(x.ticketNo, y.ticketNo))
    lead = 2
    columns = [col('amc', 'AMC BRAND', 100), col('vendor', 'AMC VENDOR', 180), col('cluster', 'CLUSTER', 70), col('plist', 'PRIORITY LIST', 100), col('store', 'Requester', 70),
      col('sub', 'Sub Category', 150), col('subject', 'Subject', 220), col('acno', 'AC Serial Number', 100, { align: 'center' }), col('no', 'Request #', 100), col('created', 'Created', 80),
      numCol('age', 'Age (days)', 66), col('bucket', 'Age Bucket', 84), col('oemno', 'AC OEM Ticket Number', 140), col('oemdate', 'AC OEM Ticket Creation Date', 120),
      col('oembucket', 'OEM Age Bucket', 94), numCol('ac', 'AC TOTAL', 66), numCol('total', 'Total Ticket', 66), numCol('pct', 'AC Not Working%', 92, { peach: true, pct: true })]
    for (const f of list) {
      const store = list.filter((x) => (x.store || x.requester) === (f.store || f.requester))
      const mine = refs([f])
      const storeRefs = refs(store)
      rows.push(row(f.id, 'row', [f.acAmcBrand || '', f.acAmcVendor || '', f.cluster || NO_CLUSTER, f.priorityList || '', f.store || f.requester, subOf(f.subCategory), f.subject,
        f.acNo || '', f.ticketNo, shortDate(localDay(f.createdAt)), f.ageDays, f.ageBucket, f.oemTicketNo || '', shortDate(f.oemTicketDate), f.oemBucket || '',
        f.acTotal ?? '', store.length, f.acTotal && f.acTotal > 0 ? store.length / f.acTotal : ''],
      [mine, mine, mine, mine, mine, mine, mine, mine, mine, mine, mine, mine, mine, mine, mine, storeRefs, storeRefs, storeRefs]))
    }
    if (rows.length > 0) {
      const stores = groupBy(list, (f) => f.store || f.requester, byName)
      const acSum = sum(stores.map((s) => s.items[0].acTotal ?? 0))
      const all = refs(list)
      rows.push(row('grand', 'grand', ['Grand Total', ...Array.from({ length: 16 }, () => '' as Cell), acSum ? list.length / acSum : ''],
        [undefined, ...Array.from({ length: 16 }, () => undefined), all]))
    }
  }

  const counted_ = input.statuses ?? def.statuses
  const statusText = counted_.length === OPEN_STATUSES.length && counted_.every((s) => OPEN_STATUSES.includes(s)) ? 'Open, Assigned, In Progress, Waiting on User, Hold, Pending Approval' : counted_.map(statusLabel).join(', ')
  // the tickets the report counts (a summary also lists the ones created or resolved today, which are not counted)
  const counted = def.layout === 'summary' ? facts.length : new Set(rows.filter((r) => r.kind === 'row').flatMap((r) => r.refs.flatMap((x) => x ?? []))).size
  return {
    slug: def.slug, title: def.title, columns, headGroups, rows, tickets: tk.list, lead, dayWord,
    scopeText: `${statusText} · ${counted} ticket${counted === 1 ? '' : 's'}`,
  }
}
