// The fixed predefined reports: the 12 sheets of "Citykart Desk Zoho Report.xlsx", under the names of those sheets. Nothing can be chosen inside a report
// (no dates, no filters, no group): each one is a fixed question about the tickets still being worked on, drawn like the Excel pivot it replaces. A number is
// clickable and opens the tickets behind it. A viewer only ever gets the tickets of the technician groups they may see.

import { AGE_BUCKETS } from '@/lib/reporting/aging'
import type { RequestStatus } from '@/types'
import { ALL_STATUSES } from './report-filter'
import { isServerRoomAc, monthLabel, weekOfMonth, type TicketFact } from './facts'
import { monthHeading, weekText, type WeekMonth } from './weekly'
import { UNASSIGNED, NO_CATEGORY, techOf, catOf, subOf } from './age-summary'
import {
  byName, shortDate, type Cell, type HeadGroup, type ReportColumn, type ReportRow, type ReportTable, type ReportTicket, type RowKind,
} from './report-table'

/** What the section is called in the menu and on its pages. */
export const REPORTS_NAME = 'Predefined Reports'

/** The folder the reports are kept in. */
export const REPORTS_FOLDER = 'Admin/NSO/BD Reports'

export type ReportLayout = 'summary' | 'status' | 'cluster-list' | 'store-ac' | 'red-flag' | 'amc-vendor' | 'weekly' | 'monthly'

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
  /** a weekly / monthly report's rows: one per AMC brand (the default) or one per Store Master priority list (TOP 40, ROS) */
  rowBy?: 'amc' | 'priority'
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
  { slug: 'weekly-admin-report', title: 'Weekly Admin Report', layout: 'weekly', group: 'Admin', services: [ADMIN_AC], statuses: ALL_STATUSES,
    about: 'By week of the month (Monday to Sunday): tickets opened that week and tickets resolved that week. Starts on the Admin group\'s AC tickets by AMC brand; choose any group, service or technician (other tickets are shown by category).' },
  { slug: 'monthly-admin-report', title: 'Monthly Admin Report', layout: 'monthly', group: 'Admin', services: [ADMIN_AC], statuses: ALL_STATUSES,
    about: 'By month (choose any months): tickets opened in that month and tickets resolved in that month. Starts on the Admin group\'s AC tickets by AMC brand; choose any group, service or technician (other tickets are shown by category).' },
  { slug: 'priority-wise-report', title: 'Priority Wise Report', layout: 'monthly', rowBy: 'priority', group: 'Admin', services: [ADMIN_AC], statuses: ALL_STATUSES,
    about: 'By priority store list (as per Ops: TOP 40, ROS) and month (choose any months): tickets opened and tickets resolved in that month. Starts on the Admin group\'s AC tickets; choose any group, service or technician.' },
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
  /** the month a weekly report is about */
  month?: WeekMonth
  /** the months a monthly report shows, oldest first */
  months?: WeekMonth[]
  /** a weekly / monthly report on AC tickets only (the default; rows by AMC brand with the store and AC counts); false = any other tickets, rows by category */
  acView?: boolean
  /** the Store Master's stores and ACs per AMC brand (a weekly report's first two columns) */
  amcStores?: { brand: string; stores: number; acs: number }[]
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
  let weekNote = ''

  if (def.layout === 'weekly' || def.layout === 'monthly') {
    // One row per AMC brand, one Open / Resolved pair per week of the chosen month. Open = tickets created that week; Resolved = tickets resolved that
    // week (whenever they were created). The store and AC counts come from the Store Master, whatever the filters are.
    const m = def.layout === 'weekly' ? input.month : input.months?.[0]
    if (m) {
      const byPriority = def.rowBy === 'priority'
      // AC tickets are shown by AMC brand (or priority list) with the Store Master's store and AC counts; any other tickets by category
      // (a priority list is the store's, so it stays, without the AC count)
      const acView = input.acView !== false
      const byCategory = !acView && !byPriority
      const showStores = !byCategory
      const showAcs = acView
      const NO_BRAND = byCategory ? '(No category)' : byPriority ? '(No priority list)' : '(No AMC brand)'
      type Brand = { name: string; stores: number; acs: number; facts: TicketFact[] }
      const brands = new Map<string, Brand>()
      const brand = (name: string) => {
        const k = normName(name)
        let b = brands.get(k)
        if (!b) { b = { name, stores: 0, acs: 0, facts: [] }; brands.set(k, b) }
        return b
      }
      if (!byCategory) for (const s of input.amcStores ?? []) { const b = brand(s.brand); b.stores += s.stores; b.acs += s.acs }
      for (const f of facts) brand((byCategory ? f.category : byPriority ? f.priorityList : f.acAmcBrand).trim() || NO_BRAND).facts.push(f)

      // The columns come in Open / Resolved pairs: one pair per week of the month (Weekly Admin Report), or one per chosen month (Monthly Admin Report).
      type Period = { head: string; opened: (f: TicketFact) => boolean; done: (f: TicketFact) => boolean }
      const doneInMonth = (f: TicketFact, label: string) => !!f.doneAt && monthLabel(new Date(f.doneAt)) === label
      const periods: Period[] = def.layout === 'weekly'
        ? m.weeks.map((w) => ({
            head: `Week-${w.week}`,
            opened: (f) => f.openMonth === m.label && f.openWeek === `Week-${w.week}`,
            done: (f) => doneInMonth(f, m.label) && weekOfMonth(new Date(f.doneAt as string)) === `Week-${w.week}`,
          }))
        : (input.months ?? []).map((mm) => ({ head: monthHeading(mm), opened: (f) => f.openMonth === mm.label, done: (f) => doneInMonth(f, mm.label) }))
      // % Diff: how much more was resolved than opened ((resolved - opened) / opened); nothing opened and nothing resolved is 0%, nothing opened but some resolved has no percentage
      const diff = (o: number, c: number): Cell => (o > 0 ? (c - o) / o : c === 0 ? 0 : '')

      lead = 1
      const first = 1 + (showStores ? 1 : 0) + (showAcs ? 1 : 0)
      columns = [
        col('amc', byCategory ? 'CATEGORY' : byPriority ? 'PRIORITY STORE' : 'AMC BRAND', 130),
        ...(showStores ? [numCol('stores', 'Total Store Count', 70)] : []), ...(showAcs ? [numCol('acs', 'Total AC Count', 70)] : []),
        ...periods.flatMap((_, i) => [numCol(`o${i}`, 'Open', 58, { align: 'center' }), numCol(`c${i}`, 'Resolved', 66, { align: 'center', tint: 'green' })]),
        numCol('to', 'Open', 58, { align: 'center', headTone: 'peach' }), numCol('tc', 'Resolved', 66, { align: 'center', tint: 'green', headTone: 'peach' }),
        numCol('pct', '% Diff', 66, { align: 'center', pct: true, pctWhole: true, diff: true, headTone: 'peach' }),
      ]
      headGroups = [
        ...periods.map((p, i) => ({ label: p.head, from: first + 2 * i, span: 2 })),
        { label: 'Total', from: first + 2 * periods.length, span: 3, peach: true },
      ]
      const list = [...brands.values()].filter((b) => b.name !== NO_BRAND || b.facts.length > 0).sort((x, y) => (byPriority && /^top/i.test(x.name) !== /^top/i.test(y.name) && x.name !== NO_BRAND && y.name !== NO_BRAND ? (/^top/i.test(x.name) ? -1 : 1) : nameOrder(x.name, y.name, NO_BRAND)))
      const line = (key: string, kind: RowKind, name: string, stores: number, acs: number, mine: TicketFact[]) => {
        const per = periods.map((p) => ({ o: mine.filter(p.opened), c: mine.filter(p.done) }))
        const o = sum(per.map((x) => x.o.length))
        const c = sum(per.map((x) => x.c.length))
        rows.push(row(key, kind,
          [name, ...(showStores ? [stores] : []), ...(showAcs ? [acs] : []), ...per.flatMap((x) => [x.o.length, x.c.length]), o, c, diff(o, c)],
          [...Array<undefined>(first).fill(undefined), ...per.flatMap((x) => [refs(x.o), refs(x.c)]), refs(per.flatMap((x) => x.o)), refs(per.flatMap((x) => x.c)), undefined]))
      }
      for (const b of list) line(b.name, 'row', b.name, b.stores, b.acs, b.facts)
      if (list.length > 0) line('grand', 'grand', 'Grand Total', sum(list.map((b) => b.stores)), sum(list.map((b) => b.acs)), list.flatMap((b) => b.facts))
      weekNote = def.layout === 'weekly'
        ? m.weeks.map((w) => `Week-${w.week} = ${weekText(w)}`).join(', ')
        : `${(input.months ?? []).length} month${(input.months ?? []).length === 1 ? '' : 's'}`
    }
  }

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
    lead = 1
    columns = [col('store', 'Requester', 70), col('city', 'CITY', 140), col('cluster', 'CLUSTER', 70), col('plist', 'PRIORITY LIST', 100), col('amc', 'AMC BRAND', 100),
      numCol('ac', 'AC TOTAL', 66), col('zen', 'ZENATIX', 72, { align: 'center' }),
      ...bucketCols(buckets),
      numCol('total', 'Total Ticket', 72, { peach: true })]
    if (!red) headGroups = [{ label: 'Ticket', from: 7, span: buckets.length }]
    const sorted = [...stores].sort((x, y) => (y.first.acNotWorkingPct ?? -1) - (x.first.acNotWorkingPct ?? -1) || byName(x.key, y.key))
    for (const s of sorted) {
      const f = s.first
      const ac = f.acTotal
      const all = refs(s.items)
      const inBucket = (x: string) => s.items.filter((t) => t.ageBucket === x)
      rows.push(row(s.key, 'row', [s.key, f.city || '', f.cluster || NO_CLUSTER, f.priorityList || '', f.acAmcBrand || '', ac ?? '', f.zenatix || '',
        ...buckets.map((x) => inBucket(x).length || ''),
        s.items.length],
      [all, all, all, all, all, all, all, ...buckets.map((x) => refs(inBucket(x))), all]))
    }
    if (rows.length > 0) {
      const allT = stores.flatMap((s) => s.items)
      const countIn = (x: string) => allT.filter((t) => t.ageBucket === x).length
      const grandRefs = refs(allT)
      rows.push(row('grand', 'grand', ['Grand Total', '', '', '', '', '', '',
        ...buckets.map((x) => countIn(x) || ''),
        allT.length],
      [undefined, undefined, undefined, undefined, undefined, undefined, undefined, ...buckets.map((x) => refs(allT.filter((t) => t.ageBucket === x))), grandRefs]))
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
    slug: def.slug, title: def.title, columns, headGroups, rows, tickets: tk.list, lead, dayWord, compact: def.layout === 'weekly' || def.layout === 'monthly',
    scopeText: def.layout === 'weekly' && input.month
      ? `${input.month.name} · ${counted} ticket${counted === 1 ? '' : 's'} opened or resolved · ${weekNote}`
      : def.layout === 'monthly' && input.months
      ? `${input.months.map((x) => x.label).join(', ')} · ${counted} ticket${counted === 1 ? '' : 's'} opened or resolved`
      : `${statusText} · ${counted} ticket${counted === 1 ? '' : 's'}`,
  }
}
