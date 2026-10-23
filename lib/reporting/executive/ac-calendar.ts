// The AC Calendar of the Smart Dashboard: for a place (a store, cluster, region or state, or everything) it works out, day by day, how many ACs were faulty, how many
// faults were raised and how many were fixed, and which individual ACs keep failing. Pure: the page loads compact rows (see lib/queries/ac-calendar.ts) and everything
// here is worked out in the browser, so changing the place or the month is instant.
//
// A day counts in India time (IST). "Faulty" on a day means an AC that had an open AC ticket at the END of that day (the ticket was raised on or before the day and not
// yet resolved by its end). The colour compares the number of faulty ACs with the number of ACs in the place:
//   none faulty -> green | up to 10% -> light green | above 10% -> yellow | above 30% -> red | days after today -> grey

export const IST_OFFSET_MS = 19_800_000
const DAY = 86_400_000

/** A day is yellow above this share of faulty ACs, and red above the second one (the owner's rule). Everything else with a faulty AC is light green. */
export const YELLOW_ABOVE_PCT = 10
export const RED_ABOVE_PCT = 30
/** An AC with this many tickets in the last REPEAT_WINDOW_DAYS is a repeat-fault AC; with WATCH_TICKETS it is on watch. */
export const REPEAT_TICKETS = 4
export const WATCH_TICKETS = 2
export const REPEAT_WINDOW_DAYS = 90
/** A ticket raised within this many days after the same AC was fixed is a fault that "came back". */
export const CAME_BACK_DAYS = 30

export type PlaceKind = 'all' | 'store' | 'cluster' | 'region' | 'state'
export const PLACE_KINDS: PlaceKind[] = ['all', 'store', 'cluster', 'region', 'state']
export const PLACE_LABEL: Record<PlaceKind, string> = { all: 'All Citykart', store: 'Store', cluster: 'Cluster', region: 'Region', state: 'State' }

/** The machines the asset calendar counts: air conditioners (AC sheet) and gensets (Genset sheet). */
export type AssetKind = 'ac' | 'genset'
export const ASSET_LABEL: Record<AssetKind, { one: string; many: string }> = { ac: { one: 'AC', many: 'ACs' }, genset: { one: 'genset', many: 'gensets' } }

export type DayLevel = 'none' | 'low' | 'medium' | 'high' | 'future'

/** An AC of the AC sheet (or a genset of the Genset sheet). */
export interface CalAc {
  kind: AssetKind
  /** store code + AC number: the same on every ticket of that AC */
  key: string
  store: string
  storeName: string
  no: string
  serial: string
  label: string
  region: string
  cluster: string
  state: string
  city: string
}

/** One AC or genset ticket (cancelled ones are left out). Times are epoch milliseconds. */
export interface CalTicket {
  kind: AssetKind
  id: string
  no: string
  /** the AC's key; '' when the ticket does not say which AC */
  ac: string
  acNo: string
  serial: string
  store: string
  storeName: string
  region: string
  cluster: string
  state: string
  created: number
  resolved: number | null
  /** who fixed it: the vendor company, or the technician */
  fixedBy: string
  status: string
}

// ── days ──────────────────────────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' of a time in India. */
export const dayKey = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)
/** The start (midnight India time) of a 'YYYY-MM-DD' day. */
export const dayStart = (key: string) => Date.parse(`${key}T00:00:00+05:30`)
export const monthKeyOf = (ms: number) => dayKey(ms).slice(0, 7)

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
/** Mon = 0 ... Sun = 6, for the first day of 'YYYY-MM'. */
export function firstWeekday(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
}
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthTitle = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

// ── places ────────────────────────────────────────────────────────────────────────────────────

const attrOf = (kind: Exclude<PlaceKind, 'all'>, x: { store: string; cluster: string; region: string; state: string }) => (kind === 'store' ? x.store : x[kind])
export const inPlace = (kind: PlaceKind, key: string, x: { store: string; cluster: string; region: string; state: string }) => kind === 'all' || attrOf(kind, x) === key

export interface PlaceOption { key: string; label: string; acs: number }

/** The places of one kind that have ACs, A to Z. */
export function placeOptions(kind: Exclude<PlaceKind, 'all'>, fleet: CalAc[]): PlaceOption[] {
  const m = new Map<string, PlaceOption>()
  for (const a of fleet) {
    const k = attrOf(kind, a)
    if (!k) continue
    const have = m.get(k)
    if (have) have.acs++
    else m.set(k, { key: k, label: kind === 'store' ? (a.storeName && a.storeName !== a.store ? `${a.storeName} (${a.store})` : a.store) : k, acs: 1 })
  }
  return [...m.values()].sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true }))
}

// ── the colour ────────────────────────────────────────────────────────────────────────────────

export function levelFor(down: number, total: number): Exclude<DayLevel, 'future'> {
  if (down <= 0) return 'none'
  const pct = total > 0 ? Math.min(100, (down / total) * 100) : 100
  if (pct > RED_ABOVE_PCT) return 'high'
  if (pct > YELLOW_ABOVE_PCT) return 'medium'
  return 'low'
}

export interface CalDay {
  key: string
  day: number
  future: boolean
  today: boolean
  raised: number
  resolved: number
  /** ACs with an open ticket at the end of the day */
  down: number
  pct: number | null
  level: DayLevel
  raisedIds: string[]
  resolvedIds: string[]
  openIds: string[]
}

/** One month of the calendar for a place. `totalAcs` is the number of ACs in the place. */
export function buildMonth(month: string, tickets: CalTicket[], totalAcs: number, kind: PlaceKind, key: string, now: number): CalDay[] {
  const mine = tickets.filter((t) => inPlace(kind, key, t))
  const today = dayKey(now)
  const out: CalDay[] = []
  for (let d = 1; d <= daysInMonth(month); d++) {
    const k = `${month}-${String(d).padStart(2, '0')}`
    if (k > today) {
      out.push({ key: k, day: d, future: true, today: false, raised: 0, resolved: 0, down: 0, pct: null, level: 'future', raisedIds: [], resolvedIds: [], openIds: [] })
      continue
    }
    const from = dayStart(k)
    const to = from + DAY
    const raisedIds: string[] = []
    const resolvedIds: string[] = []
    const openIds: string[] = []
    const downAcs = new Set<string>()
    for (const t of mine) {
      if (t.created >= from && t.created < to) raisedIds.push(t.id)
      if (t.resolved !== null && t.resolved >= from && t.resolved < to) resolvedIds.push(t.id)
      if (t.created < to && (t.resolved === null || t.resolved >= to)) {
        openIds.push(t.id)
        downAcs.add(t.ac || `?${t.id}`)   // a ticket that does not say which AC counts as its own AC
      }
    }
    const down = downAcs.size
    out.push({
      key: k, day: d, future: false, today: k === today, raised: raisedIds.length, resolved: resolvedIds.length, down,
      pct: totalAcs > 0 ? Math.min(100, (down / totalAcs) * 100) : down > 0 ? 100 : 0,
      level: levelFor(down, totalAcs), raisedIds, resolvedIds, openIds,
    })
  }
  return out
}

export interface MonthTotals { raised: number; resolved: number; downToday: number | null }
export function monthTotals(days: CalDay[]): MonthTotals {
  const past = days.filter((d) => !d.future)
  const today = days.find((d) => d.today)
  return { raised: past.reduce((s, d) => s + d.raised, 0), resolved: past.reduce((s, d) => s + d.resolved, 0), downToday: today ? today.down : null }
}

// ── ACs that fail again and again ─────────────────────────────────────────────────────────────

export type RepeatTag = 'repeat' | 'watch' | 'ok'

export interface RepeatAc {
  key: string
  label: string
  storeName: string
  store: string
  serial: string
  /** tickets in the last REPEAT_WINDOW_DAYS */
  count: number
  tag: RepeatTag
  /** 'YYYY-MM-DD' of each of those tickets */
  days: string[]
  /** how many of them were raised within CAME_BACK_DAYS after the AC was fixed */
  cameBack: number
  /** who fixed it last, and when */
  lastFixedBy: string
  lastFixedAt: number | null
  lastRaisedAt: number
  stillOpen: boolean
  ticketIds: string[]
}

export const tagFor = (count: number): RepeatTag => (count >= REPEAT_TICKETS ? 'repeat' : count >= WATCH_TICKETS ? 'watch' : 'ok')

/** The ACs of a place ranked by how many tickets they had in the last 90 days (only ACs with a known AC number). Includes ACs with a single ticket (tag 'ok'). */
export function repeatAcs(tickets: CalTicket[], fleet: CalAc[], kind: PlaceKind, key: string, now: number): RepeatAc[] {
  const since = now - REPEAT_WINDOW_DAYS * DAY
  const fleetBy = new Map(fleet.map((a) => [a.key, a]))
  const byAc = new Map<string, CalTicket[]>()
  for (const t of tickets) {
    if (!t.ac || !inPlace(kind, key, t)) continue
    byAc.set(t.ac, [...(byAc.get(t.ac) ?? []), t])
  }
  const out: RepeatAc[] = []
  for (const [acKey, list] of byAc) {
    const all = [...list].sort((a, b) => a.created - b.created)
    const recent = all.filter((t) => t.created >= since && t.created <= now)
    if (recent.length === 0) continue
    // a fault that came back: raised shortly after the AC's previous ticket was fixed
    let cameBack = 0
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]
      if (all[i].created >= since && prev.resolved !== null && prev.resolved <= all[i].created && all[i].created - prev.resolved <= CAME_BACK_DAYS * DAY) cameBack++
    }
    const fixed = [...all].filter((t) => t.resolved !== null).sort((a, b) => (b.resolved ?? 0) - (a.resolved ?? 0))[0]
    const ac = fleetBy.get(acKey)
    const last = all[all.length - 1]
    out.push({
      key: acKey,
      label: ac?.label || (last.acNo ? `AC ${last.acNo}` : acKey),
      storeName: ac?.storeName || last.storeName || last.store,
      store: ac?.store || last.store,
      serial: ac?.serial || last.serial,
      count: recent.length, tag: tagFor(recent.length), days: recent.map((t) => dayKey(t.created)), cameBack,
      lastFixedBy: fixed?.fixedBy ?? '', lastFixedAt: fixed?.resolved ?? null, lastRaisedAt: last.created,
      stillOpen: all.some((t) => t.resolved === null), ticketIds: recent.map((t) => t.id),
    })
  }
  return out.sort((a, b) => b.count - a.count || b.lastRaisedAt - a.lastRaisedAt)
}

/** Fault count per AC of a single store (the small boxes next to the list); ACs without a ticket count 0. */
export function acStrip(fleet: CalAc[], repeats: RepeatAc[], storeCode: string): { key: string; label: string; count: number; tag: RepeatTag }[] {
  const byKey = new Map(repeats.map((r) => [r.key, r]))
  return fleet.filter((a) => a.store === storeCode)
    .sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true }))
    .map((a) => ({ key: a.key, label: `AC ${a.no}`, count: byKey.get(a.key)?.count ?? 0, tag: byKey.get(a.key)?.tag ?? 'ok' }))
}

// ── the worst places ──────────────────────────────────────────────────────────────────────────

export interface WorstPlace { key: string; label: string; acs: number; down: number; pct: number }

/** The places of one kind ranked by the share of their ACs that are faulty now. */
export function worstPlaces(kind: Exclude<PlaceKind, 'all'>, tickets: CalTicket[], fleet: CalAc[], now: number, limit = 8): WorstPlace[] {
  const options = placeOptions(kind, fleet)
  const downBy = new Map<string, Set<string>>()
  for (const t of tickets) {
    if (t.resolved !== null && t.resolved <= now) continue
    if (t.created > now) continue
    const k = attrOf(kind, t)
    if (!k) continue
    const set = downBy.get(k) ?? new Set<string>()
    set.add(t.ac || `?${t.id}`)
    downBy.set(k, set)
  }
  return options
    .map((o) => { const down = downBy.get(o.key)?.size ?? 0; return { key: o.key, label: o.label, acs: o.acs, down, pct: o.acs > 0 ? Math.min(100, (down / o.acs) * 100) : 0 } })
    .filter((p) => p.down > 0)
    .sort((a, b) => b.pct - a.pct || b.down - a.down)
    .slice(0, limit)
}

/** The ACs in a place. */
export const fleetIn = (fleet: CalAc[], kind: PlaceKind, key: string) => fleet.filter((a) => inPlace(kind, key, a))
