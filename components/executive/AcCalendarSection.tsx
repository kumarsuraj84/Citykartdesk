'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Loader2, Thermometer } from 'lucide-react'
import {
  CAME_BACK_DAYS, PLACE_KINDS, PLACE_LABEL, RED_ABOVE_PCT, REPEAT_TICKETS, REPEAT_WINDOW_DAYS, WATCH_TICKETS, YELLOW_ABOVE_PCT,
  acStrip, buildMonth, dayKey, daysInMonth, firstWeekday, fleetIn, monthTitle, monthTotals, placeOptions, repeatAcs, shiftMonth, worstPlaces,
  type CalDay, type DayLevel, type PlaceKind, type RepeatAc,
} from '@/lib/reporting/executive/ac-calendar'
import { loadAcCalendar, getAcWeather, type AcWeather } from '@/lib/actions/acCalendar'
import type { AcCalendarData } from '@/lib/queries/ac-calendar'
import { Panel, PanelTitle, SelectBox, Seg } from './ui'

// The AC Calendar: for a store, cluster, region, state or the whole company, one coloured box per day (green = no faulty AC, light green = a few, yellow = more than 10% of the
// ACs, red = more than 30%, grey = days still to come), what was raised and fixed that day, the outside temperature, and the ACs that keep failing.

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

export function AcCalendarSection() {
  const [data, setData] = useState<AcCalendarData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<PlaceKind>('all')
  const [pickedKey, setKey] = useState('')
  const [month, setMonth] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [markAc, setMarkAc] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ id: string; w: AcWeather } | null>(null)

  useEffect(() => {
    let live = true
    loadAcCalendar().then((r) => {
      if (!live) return
      if ('error' in r) { setError(r.error); return }
      setData(r)
      setMonth(dayKey(r.now).slice(0, 7))
      if (r.myStore && r.level === 'requester') { setKind('store'); setKey(r.myStore) }
    }).catch(() => live && setError('The AC calendar could not be loaded.'))
    return () => { live = false }
  }, [])

  const fleet = data?.fleet
  const tickets = data?.tickets
  const now = data?.now ?? 0

  const options = useMemo(() => (kind === 'all' || !fleet ? [] : placeOptions(kind, fleet)), [kind, fleet])
  // a place of the chosen kind is always selected (the first one until somebody picks)
  const key = kind === 'all' ? '' : options.some((o) => o.key === pickedKey) ? pickedKey : (options[0]?.key ?? '')

  const inScope = useMemo(() => (fleet ? fleetIn(fleet, kind, key) : []), [fleet, kind, key])
  const days: CalDay[] = useMemo(() => (tickets && month ? buildMonth(month, tickets, inScope.length, kind, key, now) : []), [tickets, month, inScope.length, kind, key, now])
  const totals = useMemo(() => monthTotals(days), [days])
  const repeats = useMemo(() => (tickets && fleet ? repeatAcs(tickets, fleet, kind, key, now) : []), [tickets, fleet, kind, key, now])
  const flagged = repeats.filter((r) => r.tag !== 'ok').slice(0, 10)
  const strip = useMemo(() => (kind === 'store' && fleet ? acStrip(fleet, repeats, key) : []), [kind, fleet, repeats, key])
  const listKind = kind === 'all' ? 'state' : kind
  const worst = useMemo(() => (tickets && fleet ? worstPlaces(listKind, tickets, fleet, now) : []), [tickets, fleet, listKind, now])
  const byId = useMemo(() => new Map((tickets ?? []).map((t) => [t.id, t])), [tickets])

  // the saved temperatures of the place for this month (collected once a day at 08:00; this only reads them)
  const weatherId = `${kind}|${key}|${month}`
  useEffect(() => {
    if (!month || (kind !== 'all' && !key)) return
    let live = true
    const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
    getAcWeather({ kind, key, from: `${month}-01`, to: last }).then((r) => { if (live && !('error' in r)) setSaved({ id: weatherId, w: r }) }).catch(() => {})
    return () => { live = false }
  }, [kind, key, month, weatherId])
  const weather = saved?.id === weatherId ? saved.w : null

  if (error) return <Panel><PanelTitle title="AC calendar" /><p className="mt-2 text-sm text-destructive">{error}</p></Panel>
  if (!data || !month) return <Panel><PanelTitle title="AC calendar" /><p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading the AC calendar…</p></Panel>

  const thisMonth = dayKey(now).slice(0, 7)
  const marked = markAc ? new Set(repeats.find((r) => r.key === markAc)?.days ?? []) : null
  const pickedDay = picked ? days.find((d) => d.key === picked) ?? null : null
  const place = kind === 'all' ? 'All Citykart' : options.find((o) => o.key === key)?.label ?? key
  const noAcs = inScope.length === 0
  const wcities = weather?.cities ?? []

  const cell = (d: CalDay) => {
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
            {d.down > 0 ? <strong>{d.down} down</strong> : <span className="opacity-70">none down</span>}
            {(d.raised > 0 || d.resolved > 0) && <span className="block opacity-80">R{d.raised} · F{d.resolved}</span>}
          </span>
        )}
      </>
    )
    if (d.future) return <div key={d.key} className={`min-h-[60px] rounded-md p-1.5 ${classes}`} aria-label={`${d.day}: a future day`}>{body}</div>
    return (
      <button key={d.key} type="button" onClick={() => setPicked(picked === d.key ? null : d.key)} aria-pressed={picked === d.key}
        aria-label={`${monthTitle(month)} ${d.day}: ${d.down} faulty, ${d.raised} raised, ${d.resolved} fixed`}
        className={`min-h-[60px] rounded-md p-1.5 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${classes} ${picked === d.key ? 'shadow-md ring-2 ring-foreground' : ''}`}>
        {body}
      </button>
    )
  }

  const list = (title: string, ids: string[]) => (
    <div className="min-w-0">
      <div className="text-xs font-semibold text-foreground">{title} <span className="font-normal text-muted-foreground">({ids.length})</span></div>
      {ids.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">None.</p> : (
        <ul className="mt-1 space-y-0.5">
          {ids.slice(0, 12).map((id) => {
            const t = byId.get(id)
            return t ? (
              <li key={id} className="truncate text-xs"><Link href={`/requests/${t.id}`} className="font-medium text-primary hover:underline">{t.no}</Link> <span className="text-muted-foreground">· {t.storeName}{t.acNo ? ` · AC ${t.acNo}` : ''}</span></li>
            ) : null
          })}
          {ids.length > 12 && <li className="text-xs text-muted-foreground">and {ids.length - 12} more</li>}
        </ul>
      )}
    </div>
  )

  return (
    <Panel>
      <PanelTitle
        title="AC calendar"
        caption={`Which ACs were faulty each day, and what was raised and fixed — ${place}.`}
        right={
          <>
            <Seg<PlaceKind> value={kind} label="Look at" onChange={(k) => { setKind(k); setPicked(null); setMarkAc(null) }} options={PLACE_KINDS.map((k) => ({ value: k, label: PLACE_LABEL[k] }))} />
            {kind !== 'all' && <SelectBox label={`Choose a ${PLACE_LABEL[kind].toLowerCase()}`} value={key} onChange={(v) => { setKey(v); setPicked(null); setMarkAc(null) }} options={options.map((o) => ({ value: o.key, label: `${o.label} · ${o.acs} AC${o.acs === 1 ? '' : 's'}` }))} />}
          </>
        }
      />
      {data.truncated && <p className="mt-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive">There are more tickets than this page can load, so the oldest ones are left out.</p>}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Total ACs', value: inScope.length, tone: '' },
          { label: 'Faulty today', value: totals.downToday ?? '—', tone: (totals.downToday ?? 0) > 0 ? 'text-destructive' : '' },
          { label: 'Raised this month', value: totals.raised, tone: '' },
          { label: 'Fixed this month', value: totals.resolved, tone: 'text-success' },
        ].map((m) => (
          <div key={m.label} className="rounded-lg bg-muted/60 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{m.label}</div>
            <div className={`text-xl font-bold tabular-nums ${m.tone}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {noAcs ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">There are no ACs in the AC sheet for {place}, so there is nothing to show.</p>
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
            <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`${monthTitle(month)} for ${place}`}>
              {WEEKDAYS.map((w) => <div key={w} className="pb-0.5 text-center text-[11px] font-medium text-muted-foreground">{w}</div>)}
              {Array.from({ length: firstWeekday(month) }, (_, i) => <div key={`b${i}`} />)}
              {days.map(cell)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {([['none', 'no faulty AC'], ['low', `up to ${YELLOW_ABOVE_PCT}% of ACs`], ['medium', `more than ${YELLOW_ABOVE_PCT}%`], ['high', `more than ${RED_ABOVE_PCT}%`], ['future', 'days to come']] as [DayLevel, string][]).map(([l, t]) => (
                <span key={l} className="inline-flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm ${LEVEL_CLASS[l]}`} />{t}</span>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Each box: “down” = ACs still faulty at the end of the day, R = faults raised, F = faults fixed. Colour = faulty ACs as a share of the {inScope.length} AC{inScope.length === 1 ? '' : 's'} here.
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              <Thermometer className="h-3 w-3" aria-hidden />
              {kind === 'all'
                ? 'Pick a state, region, cluster or store to see the outside temperature (highest/lowest).'
                : !weather ? 'Temperature: loading…'
                : wcities.length === 0 ? 'Outside temperature has not been collected for this place yet. It is saved every morning at 8:00.'
                : `Top right of each day: highest/lowest outside temperature, ${wcities.length === 1 ? `for ${wcities[0]}` : `average of ${wcities.length} cities`}${weather.missing > 0 ? ` (${weather.missing} more not collected yet)` : ''}. Saved every morning at 8:00.`}
            </p>

            {pickedDay && (
              <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-bold">{pickedDay.day} {monthTitle(month)} · {pickedDay.down} AC{pickedDay.down === 1 ? '' : 's'} faulty at the end of the day</h4>
                  <button type="button" onClick={() => setPicked(null)} className="text-xs font-medium text-primary hover:underline">Close</button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {list('Raised that day', pickedDay.raisedIds)}
                  {list('Fixed that day', pickedDay.resolvedIds)}
                  {list('Still faulty', pickedDay.openIds)}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-5">
            <div>
              <h3 className="text-sm font-bold">ACs that fail again and again</h3>
              <p className="mb-2 text-[11px] text-muted-foreground">Last {REPEAT_WINDOW_DAYS} days: {REPEAT_TICKETS}+ tickets = repeat, {WATCH_TICKETS}–{REPEAT_TICKETS - 1} = watch. Click one to mark its days on the calendar.</p>
              {flagged.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No AC has failed {WATCH_TICKETS} or more times in the last {REPEAT_WINDOW_DAYS} days here.</p> : (
                <ul className="space-y-1.5">
                  {flagged.map((r: RepeatAc) => (
                    <li key={r.key}>
                      <button type="button" onClick={() => { setMarkAc(markAc === r.key ? null : r.key); const first = r.days.find((x) => x.startsWith(month)); setPicked(first ?? null) }} aria-pressed={markAc === r.key}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:border-foreground/40 ${markAc === r.key ? 'border-foreground' : 'border-border'}`}>
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold">{r.label}</span>
                            <span className="block truncate text-muted-foreground">{kind === 'store' ? '' : `${r.storeName} · `}{r.serial ? `serial ${r.serial}` : 'serial not recorded'}</span>
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
                <p className="mb-1 text-[11px] text-muted-foreground">Share of ACs that are faulty today. Click one to open its calendar.</p>
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
          </div>
        </div>
      )}
    </Panel>
  )
}
