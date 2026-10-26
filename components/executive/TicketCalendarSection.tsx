'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Loader2, Thermometer } from 'lucide-react'
import {
  ASSET_LABEL, CAME_BACK_DAYS, PLACE_KINDS, PLACE_LABEL, RED_ABOVE_PCT, REPEAT_TICKETS, REPEAT_WINDOW_DAYS, WATCH_TICKETS, YELLOW_ABOVE_PCT,
  acStrip, buildMonth, dayKey, daysInMonth, firstWeekday, fleetIn, monthTitle, placeOptions, repeatAcs, shiftMonth, worstPlaces,
  type AssetKind, type CalDay, type DayLevel, type PlaceKind, type RepeatAc,
} from '@/lib/reporting/executive/ac-calendar'
import {
  BREAK_DIMS, BUSIEST_SHARE, breakdown, buildVolumeMonth, calendarTitle, countable, inVolPlace, sameIssueAgain, topValues, volPlaceOptions, volumeLimits,
  type BreakDim, type VolPlaceKind,
} from '@/lib/reporting/executive/issue-calendar'
import { applyFilters, type ExecTicket, type Filters } from '@/lib/reporting/executive/engine'
import { loadAcCalendar, getAcWeather, type AcWeather } from '@/lib/actions/acCalendar'
import type { AcCalendarData } from '@/lib/queries/ac-calendar'
import { Panel, PanelTitle, SelectBox, Seg } from './ui'

// The Ticket Calendar of the Smart Dashboard ("IT Ticket Calendar", "ADMIN Ticket Calendar" ... named after the group chosen at the top). It always shows the tickets that match
// the dashboard's filters (group, service, category, sub category, technician, region, state, cluster ...), and those are only the tickets the viewer is allowed to see: the
// dashboard loads nothing else. Two ways of counting:
//  - machines (AC, genset): when everything in view is AC or genset work, days are coloured by the share of faulty machines;
//  - tickets: for everything else, days are coloured against the group's own normal (no list of assets to compare with).

const LEVEL_CLASS: Record<DayLevel, string> = {
  none: 'bg-emerald-200 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-50',
  low: 'bg-lime-100 text-lime-950 dark:bg-lime-900/40 dark:text-lime-50',
  medium: 'bg-amber-200 text-amber-950 dark:bg-amber-800/60 dark:text-amber-50',
  high: 'bg-red-300 text-red-950 dark:bg-red-900/70 dark:text-red-50',
  future: 'bg-muted/60 text-muted-foreground',
}
const TAG_CLASS = {
  repeat: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200',
  watch: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
  ok: 'bg-muted text-muted-foreground',
}
const TAG_TEXT = { repeat: 'repeat', watch: 'watch', ok: '' }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const deg = (v: number | null) => (v === null ? '' : `${Math.round(v)}°`)
const dateText = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

/** One day box, the same for both ways of counting. */
interface Cell { key: string; day: number; future: boolean; today: boolean; level: DayLevel; count: number; raised: number; resolved: number; raisedIds: string[]; resolvedIds: string[]; openIds: string[] }
/** A ticket as the day lists need it. */
interface Brief { id: string; no: string; where: string; what: string }

/** The kinds of machine work in view: empty unless EVERY ticket in view is an AC or genset ticket. */
function machineKindsOf(inView: ExecTicket[], assetById: Map<string, { kind: AssetKind }>): AssetKind[] {
  if (inView.length === 0 || assetById.size === 0) return []
  const ks = new Set<AssetKind>()
  for (const t of inView) {
    const a = assetById.get(t.id)
    if (!a) return []
    ks.add(a.kind)
  }
  return [...ks]
}

export function TicketCalendarSection({ tickets, filters, now }: { tickets: ExecTicket[]; filters: Filters; now: number }) {
  const [assets, setAssets] = useState<AcCalendarData | null>(null)
  const [assetError, setAssetError] = useState<string | null>(null)
  const [kind, setKind] = useState<PlaceKind>('all')
  const [pickedKey, setKey] = useState('')
  const [month, setMonth] = useState(() => dayKey(now).slice(0, 7))
  const [picked, setPicked] = useState<string | null>(null)
  const [markAc, setMarkAc] = useState<string | null>(null)
  const [mode, setMode] = useState<'machines' | 'tickets'>('machines')
  const [kindChoice, setKindChoice] = useState<AssetKind>('ac')
  const [breakBy, setBreakBy] = useState<BreakDim>('cluster')
  const [saved, setSaved] = useState<{ id: string; w: AcWeather } | null>(null)

  // the AC / Genset machine lists and their tickets (the same viewer scope as everything else)
  useEffect(() => {
    let live = true
    loadAcCalendar().then((r) => { if (!live) return; if ('error' in r) setAssetError(r.error); else setAssets(r) }).catch(() => live && setAssetError('The machine list could not be loaded.'))
    return () => { live = false }
  }, [])

  // ── what is in view: only tickets that match the dashboard filters ─────────────────────────
  const inView = useMemo(() => applyFilters(tickets, filters, now).filter(countable), [tickets, filters, now])
  const groups = filters.dims.group
  const title = calendarTitle(groups)

  const assetById = useMemo(() => new Map((assets?.tickets ?? []).map((t) => [t.id, t])), [assets])
  // the slice is "machine work" when it is not empty and every ticket in it is an AC or genset ticket
  const kindsInView = useMemo(() => machineKindsOf(inView, assetById), [inView, assetById])
  const machineSlice = kindsInView.length > 0
  const assetKind: AssetKind = kindsInView.includes(kindChoice) ? kindChoice : (kindsInView[0] ?? 'ac')
  const machines = machineSlice && mode === 'machines'

  // ── the place ───────────────────────────────────────────────────────────────────────────────
  const viewIds = useMemo(() => new Set(inView.map((t) => t.id)), [inView])
  const aTickets = useMemo(() => (machines ? (assets?.tickets ?? []).filter((t) => viewIds.has(t.id) && t.kind === assetKind) : []), [machines, assets, viewIds, assetKind])
  const aFleet = useMemo(() => (machines ? (assets?.fleet ?? []).filter((a) => a.kind === assetKind) : []), [machines, assets, assetKind])
  const options = useMemo(() => {
    if (kind === 'all') return []
    return machines ? placeOptions(kind, aFleet).map((o) => ({ key: o.key, label: o.label, n: o.acs })) : volPlaceOptions(kind as VolPlaceKind, inView).map((o) => ({ key: o.key, label: o.label, n: o.count }))
  }, [kind, machines, aFleet, inView])
  const key = kind === 'all' ? '' : options.some((o) => o.key === pickedKey) ? pickedKey : (options[0]?.key ?? '')

  // ── the days ────────────────────────────────────────────────────────────────────────────────
  const scope = useMemo(() => (machines ? fleetIn(aFleet, kind, key) : []), [machines, aFleet, kind, key])
  const aDays: CalDay[] = useMemo(() => (machines ? buildMonth(month, aTickets, scope.length, kind, key, now) : []), [machines, aTickets, month, scope.length, kind, key, now])
  const placeTickets = useMemo(() => (machines ? [] : inView.filter((t) => inVolPlace(kind, key, t))), [machines, inView, kind, key])
  const limits = useMemo(() => volumeLimits(placeTickets, now), [placeTickets, now])
  const vDays = useMemo(() => (machines ? [] : buildVolumeMonth(month, placeTickets, now, limits)), [machines, placeTickets, month, now, limits])
  const cells: Cell[] = machines
    ? aDays.map((d) => ({ key: d.key, day: d.day, future: d.future, today: d.today, level: d.level, count: d.down, raised: d.raised, resolved: d.resolved, raisedIds: d.raisedIds, resolvedIds: d.resolvedIds, openIds: d.openIds }))
    : vDays.map((d) => ({ key: d.key, day: d.day, future: d.future, today: d.today, level: d.level, count: d.open, raised: d.raised, resolved: d.resolved, raisedIds: d.raisedIds, resolvedIds: d.resolvedIds, openIds: d.openIds }))
  const pastCells = cells.filter((c) => !c.future)
  const todayCell = cells.find((c) => c.today)
  const raisedTotal = pastCells.reduce((s, c) => s + c.raised, 0)
  const fixedTotal = pastCells.reduce((s, c) => s + c.resolved, 0)
  const busiest = pastCells.reduce<Cell | null>((b, c) => (!b || c.raised > b.raised ? c : b), null)

  // the lookup for the day lists
  const briefs = useMemo(() => {
    const m = new Map<string, Brief>()
    if (machines) for (const t of aTickets) m.set(t.id, { id: t.id, no: t.no, where: t.storeName, what: t.acNo ? (assetKind === 'ac' ? `AC ${t.acNo}` : 'Genset') : '' })
    else for (const t of placeTickets) m.set(t.id, { id: t.id, no: t.no, where: t.store, what: t.sub && !t.sub.startsWith('(No ') ? t.sub : t.cat })
    return m
  }, [machines, aTickets, placeTickets, assetKind])

  // ── the side panels ─────────────────────────────────────────────────────────────────────────
  const repeats = useMemo(() => (machines ? repeatAcs(aTickets, aFleet, kind, key, now) : []), [machines, aTickets, aFleet, kind, key, now])
  const flagged = repeats.filter((r) => r.tag !== 'ok').slice(0, 10)
  const strip = useMemo(() => (machines && kind === 'store' ? acStrip(aFleet, repeats, key) : []), [machines, kind, aFleet, repeats, key])
  const listKind = (kind === 'all' ? 'state' : kind) as Exclude<PlaceKind, 'all'>
  const worst = useMemo(() => (machines ? worstPlaces(listKind, aTickets, aFleet, now) : []), [machines, aTickets, aFleet, listKind, now])
  const rows = useMemo(() => (machines ? [] : breakdown(placeTickets, breakBy, month, now)), [machines, placeTickets, breakBy, month, now])
  const cats = useMemo(() => (machines ? [] : topValues(placeTickets, 'cat', now)), [machines, placeTickets, now])
  const subs = useMemo(() => (machines ? [] : topValues(placeTickets, 'sub', now)), [machines, placeTickets, now])
  const again = useMemo(() => (machines ? [] : sameIssueAgain(placeTickets, now)), [machines, placeTickets, now])

  // the saved temperatures (collected once a day at 08:00; this only reads them). Only for machine work: IT or HR tickets do not depend on the weather.
  const weatherId = `${machineSlice}|${kind}|${key}|${month}`
  useEffect(() => {
    if (!machineSlice || (kind !== 'all' && !key)) return
    let live = true
    getAcWeather({ kind, key, from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` }).then((r) => { if (live && !('error' in r)) setSaved({ id: weatherId, w: r }) }).catch(() => {})
    return () => { live = false }
  }, [machineSlice, kind, key, month, weatherId])
  const weather = machineSlice && saved?.id === weatherId ? saved.w : null

  const thisMonth = dayKey(now).slice(0, 7)
  const marked = markAc ? new Set(repeats.find((r) => r.key === markAc)?.days ?? []) : null
  const pickedCell = picked ? cells.find((c) => c.key === picked) ?? null : null
  const place = kind === 'all' ? (groups.length === 1 ? groups[0] : 'all Citykart') : options.find((o) => o.key === key)?.label ?? key
  const nothing = machines ? scope.length === 0 : placeTickets.length === 0
  const noun = machines ? ASSET_LABEL[assetKind] : null
  const dim = machines ? 'down' : 'open'
  const wcities = weather?.cities ?? []
  const loadingAssets = !assets && !assetError

  const cell = (d: Cell) => {
    const w = weather?.days[d.key]
    const classes = `${LEVEL_CLASS[d.level]} ${d.today ? 'ring-2 ring-primary' : ''} ${marked?.has(d.key) ? 'outline outline-2 -outline-offset-2 outline-foreground' : ''}`
    const body = (
      <>
        <span className="flex items-start justify-between gap-1">
          <span className="text-sm font-bold leading-none">{d.day}</span>
          {!d.future && w && (w.tmax !== null || w.tmin !== null) && <span className="text-[10px] font-medium leading-none opacity-80" title={`Highest ${deg(w.tmax)}, lowest ${deg(w.tmin)}`}>{deg(w.tmax)}/{deg(w.tmin)}</span>}
        </span>
        {!d.future && (
          <span className="mt-1 block text-[11px] leading-tight">
            {d.count > 0 ? <strong>{d.count} {dim}</strong> : <span className="opacity-70">none {dim}</span>}
            {(d.raised > 0 || d.resolved > 0) && <span className="block opacity-80">R{d.raised} · F{d.resolved}</span>}
          </span>
        )}
      </>
    )
    if (d.future) return <div key={d.key} className={`min-h-[60px] rounded-md p-1.5 ${classes}`} aria-label={`${d.day}: a future day`}>{body}</div>
    return (
      <button key={d.key} type="button" onClick={() => setPicked(picked === d.key ? null : d.key)} aria-pressed={picked === d.key}
        aria-label={`${monthTitle(month)} ${d.day}: ${d.count} ${dim}, ${d.raised} raised, ${d.resolved} fixed`}
        className={`min-h-[60px] rounded-md p-1.5 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${classes} ${picked === d.key ? 'shadow-md ring-2 ring-foreground' : ''}`}>
        {body}
      </button>
    )
  }

  const list = (head: string, ids: string[]) => (
    <div className="min-w-0">
      <div className="text-xs font-semibold text-foreground">{head} <span className="font-normal text-muted-foreground">({ids.length})</span></div>
      {ids.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">None.</p> : (
        <ul className="mt-1 space-y-0.5">
          {ids.slice(0, 12).map((id) => {
            const t = briefs.get(id)
            return t ? <li key={id} className="truncate text-xs"><Link href={`/requests/${t.id}`} className="font-medium text-primary hover:underline">{t.no}</Link> <span className="text-muted-foreground">· {t.where}{t.what ? ` · ${t.what}` : ''}</span></li> : null
          })}
          {ids.length > 12 && <li className="text-xs text-muted-foreground">and {ids.length - 12} more</li>}
        </ul>
      )}
    </div>
  )

  const metrics = machines
    ? [{ label: `Total ${noun!.many}`, value: scope.length, tone: '' }, { label: 'Faulty today', value: todayCell?.count ?? '—', tone: (todayCell?.count ?? 0) > 0 ? 'text-destructive' : '' }, { label: 'Raised this month', value: raisedTotal, tone: '' }, { label: 'Fixed this month', value: fixedTotal, tone: 'text-success' }]
    : [{ label: 'Open today', value: todayCell?.count ?? '—', tone: (todayCell?.count ?? 0) > 0 ? 'text-destructive' : '' }, { label: 'Raised this month', value: raisedTotal, tone: '' }, { label: 'Fixed this month', value: fixedTotal, tone: 'text-success' }, { label: 'Busiest day', value: busiest && busiest.raised > 0 ? `${busiest.day} (${busiest.raised})` : '—', tone: '' }]

  return (
    <Panel>
      <PanelTitle
        title={title}
        caption={machines
          ? `Which ${noun!.many} were faulty each day, and what was raised and fixed - ${place}.`
          : `How many tickets were open each day, and what was raised and fixed - ${place}. Each day is compared with this ${groups.length === 1 ? 'group' : 'view'}'s own usual level.`}
        right={
          <>
            <Seg<PlaceKind> value={kind} label="Look at" onChange={(k) => { setKind(k); setPicked(null); setMarkAc(null) }} options={PLACE_KINDS.map((k) => ({ value: k, label: PLACE_LABEL[k] }))} />
            {kind !== 'all' && <SelectBox label={`Choose a ${PLACE_LABEL[kind].toLowerCase()}`} value={key} onChange={(v) => { setKey(v); setPicked(null); setMarkAc(null) }} options={options.map((o) => ({ value: o.key, label: `${o.label} · ${o.n} ${machines ? (o.n === 1 ? noun!.one : noun!.many) : o.n === 1 ? 'ticket' : 'tickets'}` }))} />}
          </>
        }
      />

      {machineSlice && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Count:</span>
          <Seg<'machines' | 'tickets'> value={mode} label="Count" onChange={(m) => { setMode(m); setPicked(null); setMarkAc(null); setKey('') }} options={[{ value: 'machines', label: kindsInView.length > 1 || assetKind === 'ac' ? 'Faulty ACs / gensets' : 'Faulty gensets' }, { value: 'tickets', label: 'Open tickets' }]} />
          {kindsInView.length > 1 && mode === 'machines' && <Seg<AssetKind> value={assetKind} label="Machine" onChange={(k) => { setKindChoice(k); setKey('') }} options={kindsInView.map((k) => ({ value: k, label: ASSET_LABEL[k].many.toUpperCase() }))} />}
        </div>
      )}
      {assetError && machineSlice === false && <p className="mt-2 text-xs text-muted-foreground">The AC and genset lists are not available right now, so the ticket count is shown.</p>}
      {assets?.truncated && <p className="mt-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive">There are more tickets than this page can load, so the oldest ones are left out.</p>}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg bg-muted/60 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{m.label}</div>
            <div className={`text-xl font-bold tabular-nums ${m.tone}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {loadingAssets && inView.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>
      ) : nothing ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {machines ? `There are no ${noun!.many} in the sheet for ${place}, so there is nothing to show.` : `No tickets match the filters${kind === 'all' ? '' : ` for ${place}`}, so there is nothing to show.`}
        </p>
      ) : (
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold">{monthTitle(month)}</h3>
              <div className="flex items-center gap-1 text-xs">
                <button type="button" aria-label="Previous month" onClick={() => { setMonth(shiftMonth(month, -1)); setPicked(null) }} className="rounded-md border border-border p-1 hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => { setMonth(thisMonth); setPicked(null) }} disabled={month === thisMonth} className="rounded-md border border-border px-2 py-1 font-medium hover:bg-muted disabled:opacity-50">This month</button>
                <button type="button" aria-label="Next month" onClick={() => { setMonth(shiftMonth(month, 1)); setPicked(null) }} disabled={month >= thisMonth} className="rounded-md border border-border p-1 hover:bg-muted disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1" role="group" aria-label={`${monthTitle(month)} for ${place}`}>
              {WEEKDAYS.map((w) => <div key={w} className="pb-0.5 text-center text-[11px] font-medium text-muted-foreground">{w}</div>)}
              {Array.from({ length: firstWeekday(month) }, (_, i) => <div key={`b${i}`} />)}
              {cells.map(cell)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {(machines
                ? [['none', `no faulty ${noun!.one}`], ['low', `up to ${YELLOW_ABOVE_PCT}% of ${noun!.many}`], ['medium', `more than ${YELLOW_ABOVE_PCT}%`], ['high', `more than ${RED_ABOVE_PCT}%`], ['future', 'days to come']]
                : [['none', 'nothing open'], ['low', `up to ${limits.usual} open (usual)`], ['medium', `more than ${limits.usual}`], ['high', `more than ${limits.busy} (busiest ${Math.round(BUSIEST_SHARE * 100)}% of days)`], ['future', 'days to come']]
              ).map(([l, t]) => <span key={l} className="inline-flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm ${LEVEL_CLASS[l as DayLevel]}`} />{t}</span>)}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {machines
                ? `Each box: “down” = ${noun!.many} still faulty at the end of the day, R = faults raised, F = faults fixed. Colour = faulty ${noun!.many} as a share of the ${scope.length} ${scope.length === 1 ? noun!.one : noun!.many} here.`
                : 'Each box: “open” = tickets not yet resolved at the end of the day, R = raised, F = fixed. Colour = the day compared with the usual level of the last 90 days.'}
            </p>
            {machineSlice && (
              <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                <Thermometer className="h-3 w-3" aria-hidden />
                {kind === 'all'
                  ? 'Pick a state, region, cluster or store to see the outside temperature (highest/lowest).'
                  : !weather ? 'Temperature: loading…'
                  : wcities.length === 0 ? 'Outside temperature has not been collected for this place yet. It is saved every morning at 8:00.'
                  : `Top right of each day: highest/lowest outside temperature, ${wcities.length === 1 ? `for ${wcities[0]}` : `average of ${wcities.length} cities`}${weather.missing > 0 ? ` (${weather.missing} more not collected yet)` : ''}. Saved every morning at 8:00.`}
              </p>
            )}

            {pickedCell && (
              <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-bold">{pickedCell.day} {monthTitle(month)} · {pickedCell.count} {machines ? `${pickedCell.count === 1 ? noun!.one : noun!.many} faulty` : 'tickets open'} at the end of the day</h4>
                  <button type="button" onClick={() => setPicked(null)} className="text-xs font-medium text-primary hover:underline">Close</button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {list('Raised that day', pickedCell.raisedIds)}
                  {list('Fixed that day', pickedCell.resolvedIds)}
                  {list(machines ? 'Still faulty' : 'Still open', pickedCell.openIds)}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-5">
            {machines ? (
              <>
                <div>
                  <h3 className="text-sm font-bold">{noun!.many.toUpperCase()} that fail again and again</h3>
                  <p className="mb-2 text-[11px] text-muted-foreground">Last {REPEAT_WINDOW_DAYS} days: {REPEAT_TICKETS}+ tickets = repeat, {WATCH_TICKETS}–{REPEAT_TICKETS - 1} = watch. Click one to mark its days on the calendar.</p>
                  {flagged.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No {noun!.one} has failed {WATCH_TICKETS} or more times in the last {REPEAT_WINDOW_DAYS} days here.</p> : (
                    <ul className="space-y-1.5">
                      {flagged.map((r: RepeatAc) => (
                        <li key={r.key}>
                          <button type="button" onClick={() => { setMarkAc(markAc === r.key ? null : r.key); const first = r.days.find((x) => x.startsWith(month)); setPicked(first ?? null) }} aria-pressed={markAc === r.key}
                            className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:border-foreground/40 ${markAc === r.key ? 'border-foreground' : 'border-border'}`}>
                            <span className="flex items-start justify-between gap-2">
                              <span className="min-w-0">
                                <span className="block truncate text-[13px] font-semibold">{assetKind === 'genset' ? `Genset - ${r.storeName}` : r.label}</span>
                                <span className="block truncate text-muted-foreground">{kind === 'store' || assetKind === 'genset' ? '' : `${r.storeName} · `}{assetKind === 'genset' ? '' : r.serial ? `serial ${r.serial}` : 'serial not recorded'}</span>
                              </span>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${TAG_CLASS[r.tag]}`}>{r.count} tickets · {TAG_TEXT[r.tag]}</span>
                            </span>
                            <span className="mt-1 block text-muted-foreground">
                              {r.cameBack > 0 && <strong className="text-destructive">came back {r.cameBack}× within {CAME_BACK_DAYS} days of a fix</strong>}
                              {r.cameBack > 0 && ' · '}
                              {r.stillOpen ? 'faulty now' : r.lastFixedAt ? `last fixed ${dateText(r.lastFixedAt)}${r.lastFixedBy ? ` by ${r.lastFixedBy}` : ''}` : ''}
                              {r.stillOpen && r.lastFixedBy ? ` · earlier fixed by ${r.lastFixedBy}` : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {strip.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold">Faults per AC in this store</h3>
                    <p className="mb-1 text-[11px] text-muted-foreground">Tickets in the last {REPEAT_WINDOW_DAYS} days.</p>
                    <div className="grid grid-cols-4 gap-1 sm:grid-cols-5">
                      {strip.map((s) => (
                        <div key={s.key} className={`rounded-md px-1 py-1.5 text-center text-[11px] ${s.tag === 'repeat' ? TAG_CLASS.repeat : s.tag === 'watch' ? TAG_CLASS.watch : s.count === 0 ? LEVEL_CLASS.none : LEVEL_CLASS.low}`}>
                          {s.label}<br /><b className="text-sm">{s.count}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {worst.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold">Worst {PLACE_LABEL[listKind].toLowerCase()}s right now</h3>
                    <p className="mb-1 text-[11px] text-muted-foreground">Share of {noun!.many} that are faulty today. Click one to open its calendar.</p>
                    <ul className="space-y-1">
                      {worst.map((p) => (
                        <li key={p.key}>
                          <button type="button" onClick={() => { setKind(listKind); setKey(p.key); setPicked(null); setMarkAc(null) }} className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-xs hover:border-foreground/40">
                            <span className="min-w-0 truncate font-medium">{p.label}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">{p.down} of {p.acs} · <b className={p.pct > RED_ABOVE_PCT ? 'text-destructive' : p.pct > YELLOW_ABOVE_PCT ? 'text-amber-600 dark:text-amber-400' : ''}>{Math.round(p.pct)}%</b></span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">Break it down by</h3>
                    <SelectBox label="Break it down by" value={breakBy} onChange={(v) => setBreakBy(v as BreakDim)} options={BREAK_DIMS.map((b) => ({ value: b.value, label: b.label }))} />
                  </div>
                  <p className="mb-1 text-[11px] text-muted-foreground">Tickets open now, and raised / fixed in {monthTitle(month)}.</p>
                  {rows.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">Nothing to list here.</p> : (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 text-left text-muted-foreground"><tr><th className="px-2 py-1.5 font-medium">{BREAK_DIMS.find((b) => b.value === breakBy)?.label}</th><th className="px-2 py-1.5 text-right font-medium">Open</th><th className="px-2 py-1.5 text-right font-medium">Raised</th><th className="px-2 py-1.5 text-right font-medium">Fixed</th></tr></thead>
                        <tbody className="divide-y divide-border">
                          {rows.map((r) => (
                            <tr key={r.key}><td className="max-w-[10rem] truncate px-2 py-1.5 font-medium">{r.key}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.open}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.raised}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.fixed}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                {(cats.length > 1 || subs.length > 0) && (
                  <div>
                    <h3 className="text-sm font-bold">What the tickets are about</h3>
                    <p className="mb-1 text-[11px] text-muted-foreground">Last {REPEAT_WINDOW_DAYS} days. Use the Category and Sub category filters at the top to look at one.</p>
                    {[['Categories', cats], ['Sub categories', subs]].map(([head, list]) => (list as { key: string; count: number }[]).length > 0 && (
                      <div key={head as string} className="mb-2">
                        <div className="text-[11px] font-semibold text-muted-foreground">{head as string}</div>
                        {(list as { key: string; count: number }[]).map((c, _i, all) => (
                          <div key={c.key} className="my-1 flex items-center gap-2 text-xs">
                            <span className="w-32 shrink-0 truncate" title={c.key}>{c.key}</span>
                            <span className="h-2 rounded bg-primary/50" style={{ width: `${Math.max(6, Math.round((c.count / all[0].count) * 90))}px` }} />
                            <span className="tabular-nums text-muted-foreground">{c.count}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <h3 className="text-sm font-bold">Same issue again</h3>
                  <p className="mb-2 text-[11px] text-muted-foreground">Same store, same issue, raised again. Last {REPEAT_WINDOW_DAYS} days: {REPEAT_TICKETS}+ = repeat, {WATCH_TICKETS}–{REPEAT_TICKETS - 1} = watch.</p>
                  {again.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No store has raised the same issue twice in the last {REPEAT_WINDOW_DAYS} days.</p> : (
                    <ul className="space-y-1.5">
                      {again.map((r) => (
                        <li key={r.key} className="rounded-lg border border-border px-3 py-2 text-xs">
                          <span className="flex items-start justify-between gap-2">
                            <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{r.store}</span><span className="block truncate text-muted-foreground">{r.issue}</span></span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${TAG_CLASS[r.tag]}`}>{r.count} tickets · {TAG_TEXT[r.tag]}</span>
                          </span>
                          {(r.cameBack > 0 || r.stillOpen) && (
                            <span className="mt-1 block text-muted-foreground">
                              {r.cameBack > 0 && <strong className="text-destructive">came back {r.cameBack}× within {CAME_BACK_DAYS} days of a fix</strong>}
                              {r.cameBack > 0 && r.stillOpen && ' · '}{r.stillOpen && 'one is still open'}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Panel>
  )
}
