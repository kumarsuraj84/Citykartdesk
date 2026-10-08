// Calculation engine of the Executive Dashboard. Everything here is pure: the page loads one compact row per
// ticket (see lib/queries/executive-dashboard.ts) and these functions work out every number, ranking, trend and
// comparison in the browser, so a click on any bar or name re-filters the whole page instantly.

import { AGE_BUCKETS, ageBucketLabel } from '@/lib/reporting/aging'

export const UNASSIGNED = 'Unassigned'
export const NO_CATEGORY = '(No category)'
export const NO_LOCATION = '(No location)'
export const RESOLVED_BUCKET = 'Resolved / closed'

const DAY = 86_400_000
const HOUR = 3_600_000

export type Priority = 'urgent' | 'high' | 'medium' | 'low'

/** One ticket, as the dashboard needs it. Times are epoch milliseconds. */
export interface ExecTicket {
  id: string
  no: string
  subject: string
  group: string
  tech: string
  /** category / sub category / service */
  cat: string
  sub: string
  svc: string
  /** requester's name and department */
  req: string
  dept: string
  /** requester's site type (Head Office / Stores / Warehouse ...), store, and the store's state */
  loc: string
  store: string
  state: string
  /** the OEM serving the requester's store (e.g. "BLUE STAR OEM - DL") and its brand ("BLUE STAR") */
  oem: string
  brand: string
  /** how the ticket was raised (portal, email, WhatsApp ...) */
  src: string
  prio: Priority
  status: string
  created: number
  /** resolved (or, failing that, closed) time — null while the ticket is still open */
  resolved: number | null
  /** hours from created to resolved; null when open or when the dates are inconsistent */
  tatH: number | null
  /** resolved after its resolution due time, or still open past it */
  breached: boolean
  csat: number | null
  /** times the ticket was re-opened */
  reo: number[]
  /** hours from created to the first response; null while nobody has responded */
  frH: number | null
}

// ── Measures ──────────────────────────────────────────────────────────────────────────────────────

export type Measure = 'created' | 'resolved' | 'backlog' | 'breaches' | 'sla' | 'tat' | 'csat' | 'reopened' | 'frt'
export const MEASURE_ORDER: Measure[] = ['created', 'resolved', 'backlog', 'breaches', 'sla', 'tat', 'csat', 'reopened', 'frt']
export const MEASURES: Record<Measure, { label: string; short: string; good: 'up' | 'down' | 'neutral' }> = {
  created:  { label: 'Created',         short: 'Created',    good: 'neutral' },
  resolved: { label: 'Resolved',        short: 'Resolved',   good: 'up' },
  backlog:  { label: 'Open backlog',    short: 'Backlog',    good: 'down' },
  breaches: { label: 'SLA breaches',    short: 'Breaches',   good: 'down' },
  sla:      { label: 'SLA compliance',  short: 'SLA',        good: 'up' },
  tat:      { label: 'Avg resolution',  short: 'Resolution', good: 'down' },
  csat:     { label: 'CSAT (out of 5)', short: 'CSAT',       good: 'up' },
  reopened: { label: 'Re-opened',       short: 'Re-opened',  good: 'down' },
  frt:      { label: 'First response',  short: 'Response',   good: 'down' },
}
/** Measures that are a rate/average of resolved tickets: a handful of tickets proves nothing. */
export const needsSample = (m: Measure) => m === 'sla' || m === 'tat' || m === 'csat' || m === 'frt'

// ── Dimensions and filters ────────────────────────────────────────────────────────────────────────

export type Dim =
  | 'group' | 'tech' | 'cat' | 'sub' | 'svc' | 'oem' | 'brand' | 'store' | 'state' | 'loc' | 'dept' | 'req' | 'src' | 'prio' | 'status' | 'age'
export const DIMS: Dim[] = ['group', 'tech', 'cat', 'sub', 'svc', 'oem', 'brand', 'store', 'state', 'loc', 'dept', 'req', 'src', 'prio', 'status', 'age']
export const DIM_LABEL: Record<Dim, string> = {
  group: 'Group', tech: 'Technician', cat: 'Category', sub: 'Sub category', svc: 'Service', oem: 'OEM', brand: 'OEM brand',
  store: 'Store', state: 'State', loc: 'Site type', dept: 'Department', req: 'Requester', src: 'Raised via',
  prio: 'Priority', status: 'Status', age: 'Backlog age',
}
export type DimFilters = Record<Dim, string[]>
export type SlaState = 'all' | 'breached' | 'ok'
export interface Filters { dims: DimFilters; sla: SlaState }
export type Skip = Dim | 'sla'

export const emptyFilters = (): Filters => ({
  dims: Object.fromEntries(DIMS.map((d) => [d, [] as string[]])) as DimFilters,
  sla: 'all',
})
export const filterCount = (f: Filters) => DIMS.reduce((n, d) => n + f.dims[d].length, 0) + (f.sla !== 'all' ? 1 : 0)

/** Adds the value to a dimension's filter, or removes it when already there (click again to undo). */
export function toggleFilter(f: Filters, dim: Dim, value: string): Filters {
  const cur = f.dims[dim]
  return { ...f, dims: { ...f.dims, [dim]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } }
}

export const STATUS_LABEL: Record<string, string> = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In Progress', waiting_user: 'Waiting on User',
  hold_purchase_ho: 'Hold - Purchase from HO', pending_approval: 'Pending Approval', resolved: 'Resolved', closed: 'Closed',
}
export const STATUS_ORDER = Object.keys(STATUS_LABEL)
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s
export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export const isOpen = (t: ExecTicket) => t.resolved === null
export const openAt = (t: ExecTicket, at: number) => t.created <= at && (t.resolved === null || t.resolved > at)

/** Backlog-age bucket of a still-open ticket (same buckets as every other aging report). */
export function ageBucketOf(t: ExecTicket, now: number): string {
  return ageBucketLabel(Math.max(0, Math.round((now - t.created) / DAY)))
}
export const AGE_BUCKET_LABELS = [...AGE_BUCKETS.map((b) => b.label), RESOLVED_BUCKET]

export function keyOf(dim: Dim, t: ExecTicket, now: number): string {
  if (dim === 'age') return isOpen(t) ? ageBucketOf(t, now) : RESOLVED_BUCKET
  return t[dim]
}

export function matches(t: ExecTicket, f: Filters, now: number, skip: readonly Skip[] = []): boolean {
  for (const d of DIMS) {
    const wanted = f.dims[d]
    if (wanted.length === 0 || skip.includes(d)) continue
    if (d === 'age') { if (!isOpen(t) || !wanted.includes(ageBucketOf(t, now))) return false }
    else if (!wanted.includes(t[d])) return false
  }
  if (!skip.includes('sla')) {
    if (f.sla === 'breached' && !t.breached) return false
    if (f.sla === 'ok' && t.breached) return false
  }
  return true
}
export const applyFilters = (ts: ExecTicket[], f: Filters, now: number, skip: readonly Skip[] = []) =>
  ts.filter((t) => matches(t, f, now, skip))

// ── Time windows ──────────────────────────────────────────────────────────────────────────────────

export type Period = '7d' | '30d' | '90d' | 'fy' | 'custom'
export const PERIODS: { value: Exclude<Period, 'custom'>; short: string; label: string }[] = [
  { value: '7d', short: '7d', label: 'last 7 days' },
  { value: '30d', short: '30d', label: 'last 30 days' },
  { value: '90d', short: '90d', label: 'last 90 days' },
  { value: 'fy', short: 'This FY', label: 'this financial year' },
]
/** A chosen date range, as yyyy-mm-dd (both days included). */
export interface CustomRange { start: string; end: string }
export interface Win { start: number; end: number }
export const inWin = (ms: number, w: Win) => ms >= w.start && ms <= w.end

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const addDays = (ms: number, n: number) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime() }

/** yyyy-mm-dd → local midnight, or NaN when it is not a real date. */
export function parseDay(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return NaN
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d.getTime() : NaN
}
export function isoDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The window a period covers, ending now (a chosen date range ends at the end of its last day, but never in the future). A financial year starts on 1 April. */
export function periodWindow(period: Period, now: number, custom?: CustomRange): Win {
  if (period === 'custom' && custom) {
    const start = parseDay(custom.start)
    const end = parseDay(custom.end)
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) return { start, end: Math.min(addDays(end, 1) - 1, now) }
    period = '30d'
  }
  if (period === 'fy') {
    const d = new Date(now)
    const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
    return { start: new Date(year, 3, 1).getTime(), end: now }
  }
  const n = period === '7d' ? 7 : period === '90d' ? 90 : 30
  return { start: addDays(startOfDay(now), -(n - 1)), end: now }
}

/** Ready-made date ranges for the custom-date pop-up, worked out from today. */
export function quickRanges(now: number): { label: string; start: string; end: string }[] {
  const d = new Date(now)
  const today = isoDay(now)
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1)
  const lastMonthStart = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  const lastMonthEnd = new Date(d.getFullYear(), d.getMonth(), 0)
  const fyYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  const qStartMonth = Math.floor(((d.getMonth() + 9) % 12) / 3) * 3 // months since April, in steps of 3
  const quarterStart = new Date(fyYear, 3 + qStartMonth, 1)
  const prevQuarterStart = new Date(fyYear, 3 + qStartMonth - 3, 1)
  const prevQuarterEnd = new Date(quarterStart.getTime() - DAY)
  return [
    { label: 'Last 14 days', start: isoDay(addDays(startOfDay(now), -13)), end: today },
    { label: 'This month', start: isoDay(monthStart.getTime()), end: today },
    { label: 'Last month', start: isoDay(lastMonthStart.getTime()), end: isoDay(lastMonthEnd.getTime()) },
    { label: 'This financial quarter', start: isoDay(quarterStart.getTime()), end: today },
    { label: 'Last financial quarter', start: isoDay(prevQuarterStart.getTime()), end: isoDay(prevQuarterEnd.getTime()) },
    { label: 'This financial year', start: isoDay(new Date(fyYear, 3, 1).getTime()), end: today },
    { label: 'Last financial year', start: isoDay(new Date(fyYear - 1, 3, 1).getTime()), end: isoDay(new Date(fyYear, 2, 31).getTime()) },
  ]
}

/** The equally long window just before this one. */
export function prevWindow(w: Win): Win {
  const len = w.end - w.start + 1
  return { start: w.start - len, end: w.start - 1 }
}

export interface TimeBucket extends Win { step: number }
/** Days for a window of up to a month, otherwise weeks. */
export function timeBuckets(w: Win): TimeBucket[] {
  const days = Math.round((w.end - w.start) / DAY)
  const step = days <= 31 ? 1 : 7
  const out: TimeBucket[] = []
  for (let s = startOfDay(w.start); s <= w.end; s = addDays(s, step)) out.push({ start: s, end: Math.min(addDays(s, step) - 1, w.end), step })
  return out
}

// ── Measuring ─────────────────────────────────────────────────────────────────────────────────────

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)

/** The value of one measure for some tickets over a window. null = nothing to measure (e.g. no resolved tickets). */
export function measure(ts: ExecTicket[], w: Win, m: Measure, minN = 1): number | null {
  switch (m) {
    case 'created': return ts.filter((t) => inWin(t.created, w)).length
    case 'resolved': return ts.filter((t) => t.resolved !== null && inWin(t.resolved, w)).length
    case 'backlog': return ts.filter((t) => openAt(t, w.end)).length
    case 'breaches': return ts.filter((t) => inWin(t.created, w) && t.breached).length
    case 'reopened': return ts.reduce((n, t) => n + t.reo.filter((r) => inWin(r, w)).length, 0)
    case 'frt': {
      const answered = ts.filter((t) => t.frH !== null && inWin(t.created, w))
      return answered.length >= minN ? avg(answered.map((t) => t.frH as number)) : null
    }
  }
  const done = ts.filter((t) => t.resolved !== null && inWin(t.resolved, w))
  if (done.length < minN) return null
  if (m === 'sla') return done.length ? (100 * done.filter((t) => !t.breached).length) / done.length : null
  if (m === 'tat') return avg(done.filter((t) => t.tatH !== null).map((t) => t.tatH as number))
  const rated = done.filter((t) => t.csat !== null).map((t) => t.csat as number)
  return rated.length >= Math.min(minN, 3) ? avg(rated) : null
}

export function series(ts: ExecTicket[], w: Win, m: Measure): (number | null)[] {
  return timeBuckets(w).map((b) => measure(ts, b, m))
}

export function formatMeasure(m: Measure, v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '-'
  if (m === 'sla') return `${v.toFixed(0)}%`
  if (m === 'tat' || m === 'frt') return v < 48 ? `${v.toFixed(1)}h` : `${(v / 24).toFixed(1)}d`
  if (m === 'csat') return v.toFixed(1)
  return String(Math.round(v))
}

export interface Delta {
  /** "+12%", "-3.2 pts", "new" … */
  text: string
  direction: 'up' | 'down' | 'same'
  tone: 'good' | 'bad' | 'neutral'
}
/** Change of a measure against the previous period; null when there is nothing to compare. */
export function compare(m: Measure, cur: number | null, prev: number | null): Delta | null {
  if (cur === null || prev === null) return null
  let diff: number
  let text: string
  if (m === 'sla') { diff = cur - prev; text = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pts` }
  else if (m === 'csat') { diff = cur - prev; text = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}` }
  else if (prev === 0) { if (cur === 0) return null; diff = 1; text = 'new' }
  else { diff = (cur - prev) / prev; text = `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(0)}%` }
  if (Math.abs(diff) < 0.0005) return { text: 'same', direction: 'same', tone: 'neutral' }
  const up = diff > 0
  const good = MEASURES[m].good
  const tone = good === 'neutral' ? 'neutral' : (up && good === 'up') || (!up && good === 'down') ? 'good' : 'bad'
  return { text, direction: up ? 'up' : 'down', tone }
}

// ── Rankings and comparison ───────────────────────────────────────────────────────────────────────

export interface RankItem { key: string; value: number | null; prev: number | null }

/** Every value of a dimension with its measure, best first ("best" = what the measure's good direction says). */
export function rankItems(
  ts: ExecTicket[], f: Filters, dim: Dim, w: Win, p: Win, m: Measure, now: number
): RankItem[] {
  const base = applyFilters(ts, f, now, [dim])
  const by = new Map<string, ExecTicket[]>()
  for (const t of base) {
    const k = keyOf(dim, t, now)
    const arr = by.get(k)
    if (arr) arr.push(t); else by.set(k, [t])
  }
  const minN = needsSample(m) ? 3 : 1
  const items: RankItem[] = []
  for (const [key, arr] of by) {
    const value = measure(arr, w, m, minN)
    if (value !== null) items.push({ key, value, prev: measure(arr, p, m, minN) })
  }
  const down = MEASURES[m].good === 'down'
  return items.sort((a, b) => (down ? (a.value as number) - (b.value as number) : (b.value as number) - (a.value as number)) || a.key.localeCompare(b.key))
}

export type CompareRow = { key: string } & Record<`${Measure}`, number | null> & Record<`prev_${Measure}`, number | null>

export function compareRows(ts: ExecTicket[], f: Filters, dim: Dim, w: Win, p: Win, now: number): CompareRow[] {
  const base = applyFilters(ts, f, now, [dim])
  const by = new Map<string, ExecTicket[]>()
  for (const t of base) {
    const k = keyOf(dim, t, now)
    const arr = by.get(k)
    if (arr) arr.push(t); else by.set(k, [t])
  }
  return [...by].map(([key, arr]) => {
    const row: Record<string, number | string | null> = { key }
    for (const m of MEASURE_ORDER) { row[m] = measure(arr, w, m); row[`prev_${m}`] = measure(arr, p, m) }
    return row as CompareRow
  })
}

// ── Other views ───────────────────────────────────────────────────────────────────────────────────

/** Counts of tickets created per weekday (0 = Sunday) and hour, within the window. */
export function heatmap(ts: ExecTicket[], w: Win): { cells: Map<string, number>; max: number } {
  const cells = new Map<string, number>()
  let max = 0
  for (const t of ts) {
    if (!inWin(t.created, w)) continue
    const d = new Date(t.created)
    const k = `${d.getDay()}_${d.getHours()}`
    const n = (cells.get(k) ?? 0) + 1
    cells.set(k, n)
    if (n > max) max = n
  }
  return { cells, max }
}

/** The tickets "behind the numbers" for a measure: oldest first for backlog, newest first otherwise. */
export function ticketsBehind(ts: ExecTicket[], w: Win, m: Measure, onlyOpen = false): ExecTicket[] {
  let out: ExecTicket[]
  if (onlyOpen) out = ts.filter(isOpen)
  else if (m === 'frt') out = ts.filter((t) => t.frH !== null && inWin(t.created, w))
  else if (m === 'resolved' || needsSample(m)) out = ts.filter((t) => t.resolved !== null && inWin(t.resolved, w))
  else if (m === 'backlog') out = ts.filter((t) => openAt(t, w.end))
  else if (m === 'breaches') out = ts.filter((t) => inWin(t.created, w) && t.breached)
  else if (m === 'reopened') out = ts.filter((t) => t.reo.some((r) => inWin(r, w)))
  else out = ts.filter((t) => inWin(t.created, w))
  const oldestFirst = m === 'backlog' || onlyOpen
  return out.sort((a, b) => (oldestFirst ? a.created - b.created : b.created - a.created))
}

export function ageInDays(t: ExecTicket, now: number): number {
  return Math.floor(((t.resolved ?? now) - t.created) / DAY)
}
export const hoursTaken = (t: ExecTicket, now: number) => ((t.resolved ?? now) - t.created) / HOUR

// ── Approvals ─────────────────────────────────────────────────────────────────────────────────────

export interface ExecApproval {
  id: string
  /** the ticket the approval belongs to */
  reqId: string
  status: 'pending' | 'approved' | 'rejected'
  requested: number
  /** when the final decision was made; null while pending */
  decided: number | null
  /** who made the final decision */
  by: string
}
/** An approval together with its ticket, so the dashboard filters (group, OEM, store ...) apply to it. */
export interface ApprovalRow extends ExecApproval { t: ExecTicket }

export function joinApprovals(as: ExecApproval[], tickets: ExecTicket[]): ApprovalRow[] {
  const byId = new Map(tickets.map((t) => [t.id, t]))
  const out: ApprovalRow[] = []
  for (const a of as) { const t = byId.get(a.reqId); if (t) out.push({ ...a, t }) }
  return out
}

export type ApprovalMeasure = 'pending' | 'approved' | 'rejected' | 'rate' | 'cycle'
export const APPROVAL_ORDER: ApprovalMeasure[] = ['pending', 'approved', 'rejected', 'rate', 'cycle']
export const APPROVAL_MEASURES: Record<ApprovalMeasure, { label: string; good: 'up' | 'down' | 'neutral' }> = {
  pending:  { label: 'Waiting for a decision', good: 'down' },
  approved: { label: 'Approved',               good: 'neutral' },
  rejected: { label: 'Rejected',               good: 'neutral' },
  rate:     { label: 'Approval rate',          good: 'neutral' },
  cycle:    { label: 'Avg decision time',      good: 'down' },
}
/** Approvals follow every dashboard filter that describes the ticket (not its status, backlog age or SLA flag). */
const TICKET_ONLY: Skip[] = ['status', 'age', 'sla']
export const approvalRows = (as: ApprovalRow[], f: Filters, now: number, skip: readonly Skip[] = []) =>
  as.filter((a) => matches(a.t, f, now, [...TICKET_ONLY, ...skip]))

export function approvalMeasure(as: ApprovalRow[], w: Win, m: ApprovalMeasure): number | null {
  const decidedIn = (st?: string) => as.filter((a) => a.decided !== null && inWin(a.decided, w) && (!st || a.status === st))
  switch (m) {
    case 'pending': return as.filter((a) => a.requested <= w.end && (a.decided === null || a.decided > w.end)).length
    case 'approved': return decidedIn('approved').length
    case 'rejected': return decidedIn('rejected').length
    case 'rate': {
      const all = decidedIn()
      return all.length ? (100 * all.filter((a) => a.status === 'approved').length) / all.length : null
    }
    case 'cycle': {
      const all = decidedIn()
      return all.length ? all.reduce((n, a) => n + ((a.decided as number) - a.requested) / HOUR, 0) / all.length : null
    }
  }
}

export function formatApproval(m: ApprovalMeasure, v: number | null): string {
  if (v === null) return '-'
  if (m === 'rate') return `${v.toFixed(0)}%`
  if (m === 'cycle') return v < 48 ? `${v.toFixed(1)}h` : `${(v / 24).toFixed(1)}d`
  return String(Math.round(v))
}

export function compareApproval(m: ApprovalMeasure, cur: number | null, prev: number | null): Delta | null {
  if (cur === null || prev === null) return null
  let diff: number
  let text: string
  if (m === 'rate') { diff = cur - prev; text = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pts` }
  else if (prev === 0) { if (cur === 0) return null; diff = 1; text = 'new' }
  else { diff = (cur - prev) / prev; text = `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(0)}%` }
  if (Math.abs(diff) < 0.0005) return { text: 'same', direction: 'same', tone: 'neutral' }
  const up = diff > 0
  const good = APPROVAL_MEASURES[m].good
  return { text, direction: up ? 'up' : 'down', tone: good === 'neutral' ? 'neutral' : (up && good === 'up') || (!up && good === 'down') ? 'good' : 'bad' }
}

/** The approvals behind a number: oldest first while waiting, newest decision first otherwise. */
export function approvalsBehind(as: ApprovalRow[], w: Win, m: ApprovalMeasure): ApprovalRow[] {
  let out: ApprovalRow[]
  if (m === 'pending') out = as.filter((a) => a.requested <= w.end && (a.decided === null || a.decided > w.end))
  else if (m === 'approved') out = as.filter((a) => a.decided !== null && inWin(a.decided, w) && a.status === 'approved')
  else if (m === 'rejected') out = as.filter((a) => a.decided !== null && inWin(a.decided, w) && a.status === 'rejected')
  else out = as.filter((a) => a.decided !== null && inWin(a.decided, w))
  return out.sort((a, b) => (m === 'pending' ? a.requested - b.requested : (b.decided ?? 0) - (a.decided ?? 0)))
}

export function approvalSeries(as: ApprovalRow[], w: Win, m: ApprovalMeasure): (number | null)[] {
  return timeBuckets(w).map((b) => approvalMeasure(as, b, m))
}
