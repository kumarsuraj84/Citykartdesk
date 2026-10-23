// The ticket-volume calendar of the Smart Dashboard, for every group and category that has no list of assets (IT, HR, Finance, VM, ...; the AC / Genset calendar in
// ac-calendar.ts counts faulty machines instead). Pure: it works on the dashboard's own ticket rows, so every filter (group, service, category, sub category,
// technician, region, state, cluster, store ...) narrows it instantly, and a viewer can only ever see the rows the dashboard already loaded for them.
//
// A day counts in India time (IST). "Open" on a day = tickets raised on or before the day and not yet resolved by its end. With no asset total to compare with,
// the colour compares the day with the slice's OWN normal over the last 90 days: green = nothing open; light = up to the usual level (the median day with something
// open); yellow = above usual; red = above the level only the busiest 15% of days reach.

import { dayKey, dayStart, daysInMonth, tagFor, REPEAT_WINDOW_DAYS, CAME_BACK_DAYS, type DayLevel, type PlaceKind, type RepeatTag } from './ac-calendar'
import type { ExecTicket } from './engine'

const DAY = 86_400_000

export const BUSIEST_SHARE = 0.15

/** Cancelled tickets are not work; everything else counts. */
export const countable = (t: ExecTicket) => t.status !== 'cancelled'

export const openAt = (t: ExecTicket, endMs: number) => t.created < endMs && (t.resolved === null || t.resolved >= endMs)

export interface VolumeLimits { usual: number; busy: number }

/** The slice's own normal: the median and the busiest-15% level of its daily open count over the last 90 days (days with nothing open are left out). */
export function volumeLimits(tickets: ExecTicket[], now: number): VolumeLimits {
  const live = tickets.filter(countable)
  const counts: number[] = []
  const today = dayStart(dayKey(now))
  for (let i = 0; i < REPEAT_WINDOW_DAYS; i++) {
    const end = today - i * DAY + DAY
    let open = 0
    for (const t of live) if (openAt(t, end)) open++
    if (open > 0) counts.push(open)
  }
  if (counts.length === 0) return { usual: 1, busy: 2 }
  counts.sort((a, b) => a - b)
  const at = (p: number) => counts[Math.min(counts.length - 1, Math.floor(counts.length * p))]
  const usual = at(0.5)
  return { usual, busy: Math.max(at(1 - BUSIEST_SHARE), usual + 1) }
}

export function volumeLevel(open: number, lim: VolumeLimits): Exclude<DayLevel, 'future'> {
  if (open <= 0) return 'none'
  if (open > lim.busy) return 'high'
  if (open > lim.usual) return 'medium'
  return 'low'
}

export interface VolDay {
  key: string
  day: number
  future: boolean
  today: boolean
  raised: number
  resolved: number
  open: number
  level: DayLevel
  raisedIds: string[]
  resolvedIds: string[]
  openIds: string[]
}

export function buildVolumeMonth(month: string, tickets: ExecTicket[], now: number, lim: VolumeLimits): VolDay[] {
  const live = tickets.filter(countable)
  const today = dayKey(now)
  const out: VolDay[] = []
  for (let d = 1; d <= daysInMonth(month); d++) {
    const k = `${month}-${String(d).padStart(2, '0')}`
    if (k > today) { out.push({ key: k, day: d, future: true, today: false, raised: 0, resolved: 0, open: 0, level: 'future', raisedIds: [], resolvedIds: [], openIds: [] }); continue }
    const from = dayStart(k)
    const to = from + DAY
    const raisedIds: string[] = []
    const resolvedIds: string[] = []
    const openIds: string[] = []
    for (const t of live) {
      if (t.created >= from && t.created < to) raisedIds.push(t.id)
      if (t.resolved !== null && t.resolved >= from && t.resolved < to) resolvedIds.push(t.id)
      if (openAt(t, to)) openIds.push(t.id)
    }
    out.push({ key: k, day: d, future: false, today: k === today, raised: raisedIds.length, resolved: resolvedIds.length, open: openIds.length, level: volumeLevel(openIds.length, lim), raisedIds, resolvedIds, openIds })
  }
  return out
}

// ── the place and the "break it down by" lists ────────────────────────────────────────────────

export type VolPlaceKind = Exclude<PlaceKind, 'all'>
export const volPlaceValue = (kind: VolPlaceKind, t: ExecTicket) => (kind === 'store' ? t.store : t[kind])
export const inVolPlace = (kind: PlaceKind, key: string, t: ExecTicket) => kind === 'all' || volPlaceValue(kind, t) === key

/** The places of a kind that have tickets, A to Z (with their ticket count). */
export function volPlaceOptions(kind: VolPlaceKind, tickets: ExecTicket[]): { key: string; label: string; count: number }[] {
  const m = new Map<string, number>()
  for (const t of tickets) { const v = volPlaceValue(kind, t); if (v) m.set(v, (m.get(v) ?? 0) + 1) }
  return [...m].map(([key, count]) => ({ key, label: key, count })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

export type BreakDim = 'tech' | 'cluster' | 'region' | 'state' | 'store' | 'cat' | 'sub'
export const BREAK_DIMS: { value: BreakDim; label: string }[] = [
  { value: 'tech', label: 'Technician' }, { value: 'cluster', label: 'Cluster' }, { value: 'region', label: 'Region' }, { value: 'state', label: 'State' },
  { value: 'store', label: 'Store' }, { value: 'cat', label: 'Category' }, { value: 'sub', label: 'Sub category' },
]

export interface BreakRow { key: string; open: number; raised: number; fixed: number }

/** For each value of a dimension: tickets open now, and raised / fixed during the shown month. Busiest (most open) first. */
export function breakdown(tickets: ExecTicket[], dim: BreakDim, month: string, now: number, limit = 12): BreakRow[] {
  const from = dayStart(`${month}-01`)
  const to = dayStart(`${month}-${String(daysInMonth(month)).padStart(2, '0')}`) + DAY
  const rows = new Map<string, BreakRow>()
  for (const t of tickets.filter(countable)) {
    const key = t[dim]
    if (!key) continue
    const r = rows.get(key) ?? { key, open: 0, raised: 0, fixed: 0 }
    if (openAt(t, now + 1)) r.open++
    if (t.created >= from && t.created < to) r.raised++
    if (t.resolved !== null && t.resolved >= from && t.resolved < to) r.fixed++
    rows.set(key, r)
  }
  return [...rows.values()].filter((r) => r.open + r.raised + r.fixed > 0).sort((a, b) => b.open - a.open || b.raised - a.raised || a.key.localeCompare(b.key)).slice(0, limit)
}

/** What the tickets of the last 90 days are about: the most common values of a dimension. */
export function topValues(tickets: ExecTicket[], dim: 'cat' | 'sub', now: number, limit = 6): { key: string; count: number }[] {
  const since = now - REPEAT_WINDOW_DAYS * DAY
  const m = new Map<string, number>()
  for (const t of tickets.filter(countable)) if (t.created >= since && t[dim] && !t[dim].startsWith('(No ')) m.set(t[dim], (m.get(t[dim]) ?? 0) + 1)
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, limit)
}

// ── the same issue again ──────────────────────────────────────────────────────────────────────

export interface SameIssue {
  key: string
  store: string
  issue: string
  count: number
  tag: RepeatTag
  /** raised again within CAME_BACK_DAYS after the earlier one was resolved */
  cameBack: number
  stillOpen: boolean
  lastRaised: number
  ids: string[]
  days: string[]
}

/** The same store raising the same sub category (or category) again and again: 2+ tickets in the last 90 days. The volume calendar's version of "this AC fails every time". */
export function sameIssueAgain(tickets: ExecTicket[], now: number, limit = 10): SameIssue[] {
  const since = now - REPEAT_WINDOW_DAYS * DAY
  const groups = new Map<string, ExecTicket[]>()
  for (const t of tickets.filter(countable)) {
    if (!t.store || t.store.startsWith('(No ')) continue
    // the sub category if there is one, else the category, else the service (a ticket with none of them is not a "same issue")
    const named = (v: string) => !!v && !v.startsWith('(No ')
    const what = named(t.sub) ? t.sub : named(t.cat) ? t.cat : t.svc
    if (!named(what)) continue
    groups.set(`${t.store}|${what}`, [...(groups.get(`${t.store}|${what}`) ?? []), t])
  }
  const out: SameIssue[] = []
  for (const [key, list] of groups) {
    const all = [...list].sort((a, b) => a.created - b.created)
    const recent = all.filter((t) => t.created >= since && t.created <= now)
    if (recent.length < 2) continue
    let cameBack = 0
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]
      if (all[i].created >= since && prev.resolved !== null && prev.resolved <= all[i].created && all[i].created - prev.resolved <= CAME_BACK_DAYS * DAY) cameBack++
    }
    const [store, ...rest] = key.split('|')
    out.push({
      key, store, issue: rest.join('|'), count: recent.length, tag: tagFor(recent.length), cameBack, stillOpen: all.some((t) => t.resolved === null),
      lastRaised: all[all.length - 1].created, ids: recent.map((t) => t.id), days: recent.map((t) => dayKey(t.created)),
    })
  }
  return out.sort((a, b) => b.count - a.count || b.lastRaised - a.lastRaised).slice(0, limit)
}

// ── the title ─────────────────────────────────────────────────────────────────────────────────

/** "IT Group" -> "IT Ticket Calendar", "ADMIN GROUP" -> "ADMIN Ticket Calendar"; nothing or several groups chosen -> "Ticket Calendar". */
export function calendarTitle(groups: string[]): string {
  if (groups.length !== 1) return groups.length > 1 ? `Ticket Calendar (${groups.length} groups)` : 'Ticket Calendar'
  const short = groups[0].replace(/\s+/g, ' ').replace(/\s*group\s*$/i, '').trim()
  return `${short || groups[0]} Ticket Calendar`
}
