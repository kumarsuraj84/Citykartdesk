'use client'

import { useMemo, useState } from 'react'
import {
  approvalMeasure, approvalRows, approvalSeries, compareApproval, formatApproval,
  AGE_BUCKET_LABELS, DIM_LABEL, MEASURES, MEASURE_ORDER, PERIODS, RESOLVED_BUCKET, STATUS_LABEL,
  ageBucketOf, applyFilters, compare, emptyFilters, filterCount, formatMeasure, insights, joinApprovals, measure, openAt, periodWindow,
  prevWindow, rankItems, series, statusLabel, timeBuckets, toggleFilter, inWin,
  type ApprovalMeasure, type Dim, type ExecApproval, type ExecTicket, type Filters, type Measure, type Period,
} from '@/lib/reporting/executive/engine'
import { LEVEL_COPY, dimsForLevel, type DashLevel } from '@/lib/reporting/executive/levels'
import { ApprovalsCard } from './ApprovalsCard'
import { DrillModal, type DrillScope, type PathItem } from './DrillModal'
import { CompareTable, Heatmap, TicketListCard } from './Panels'
import { TrendChart, bucketLabel } from './TrendChart'
import { BarList, Card, DeltaBadge, SelectBox, Segmented, Spark, type BarItem } from './ui'

interface Props {
  level: DashLevel
  me: string
  now: number
  tickets: ExecTicket[]
  approvals: ExecApproval[]
  truncated: boolean
}

type Zoom = { start: number; end: number; label: string }
type Drill = { id: number; scope: DrillScope; path: PathItem[]; measure: Measure; approval: ApprovalMeasure; ticketId?: string }

const OEM_DIMS: Dim[] = ['brand', 'oem', 'store', 'state']
const PEOPLE_DIMS: Dim[] = ['group', 'tech', 'cat', 'sub', 'svc', 'dept', 'req', 'src', 'prio']

export function ExecutiveDashboard({ level, me, now, tickets, approvals, truncated }: Props) {
  const copy = LEVEL_COPY[level]
  const [period, setPeriod] = useState<Period>('30d')
  const [compareOn, setCompareOn] = useState(true)
  const [m, setM] = useState<Measure>('created')
  const [zoom, setZoom] = useState<Zoom | null>(null)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [rankDim, setRankDim] = useState<Dim>(level === 'requester' ? 'cat' : 'tech')
  const [rankMode, setRankMode] = useState<'top' | 'bottom'>('top')
  const [drill, setDrill] = useState<Drill | null>(null)
  const [drillSeq, setDrillSeq] = useState(0)

  const baseW = useMemo(() => periodWindow(period, now), [period, now])
  const W = useMemo(() => (zoom ? { start: zoom.start, end: zoom.end } : baseW), [zoom, baseW])
  const P = useMemo(() => prevWindow(W), [W])
  const periodText = zoom ? zoom.label : PERIODS.find((p) => p.value === period)?.label ?? ''
  const prevWord = zoom ? 'the period before' : `the previous ${period === 'fy' ? 'period' : PERIODS.find((p) => p.value === period)?.short}`

  const T = useMemo(() => applyFilters(tickets, filters, now), [tickets, filters, now])
  const joined = useMemo(() => joinApprovals(approvals, tickets), [approvals, tickets])
  const hasAge = filters.dims.age.length > 0
  const nFilters = filterCount(filters) + (zoom ? 1 : 0)

  const pick = (dim: Dim, value: string) => setFilters((f) => toggleFilter(f, dim, value))
  const reset = () => { setFilters(emptyFilters()); setZoom(null); setPeriod('30d'); setM('created') }
  const openDrill = (scope: DrillScope, path: PathItem[], opts?: { measure?: Measure; approval?: ApprovalMeasure; ticketId?: string }) => {
    setDrillSeq((n) => n + 1)
    setDrill({ id: drillSeq + 1, scope, path, measure: opts?.measure ?? m, approval: opts?.approval ?? 'pending', ticketId: opts?.ticketId })
  }

  // ── numbers ──
  const apRows = approvalRows(joined, filters, now)
  const apPending = approvalMeasure(apRows, W, 'pending')
  const apPendingPrev = approvalMeasure(apRows, P, 'pending')
  const apSpark = approvalSeries(apRows, baseW, 'pending')
  const kpis = MEASURE_ORDER.map((k) => ({ k, cur: measure(T, W, k), prev: measure(T, P, k), spark: series(T, baseW, k) }))

  const trendBuckets = useMemo(() => timeBuckets(baseW), [baseW])
  const trendCur = useMemo(() => trendBuckets.map((b) => measure(T, b, m)), [trendBuckets, T, m])
  const trendPrev = useMemo(() => {
    if (!compareOn) return null
    const pw = prevWindow(baseW)
    return timeBuckets(pw).map((b) => measure(T, b, m))
  }, [compareOn, baseW, T, m])
  const pickBucket = (i: number) => {
    const b = trendBuckets[i]
    setZoom((z) => (z && z.start === b.start ? null : { start: b.start, end: b.end, label: bucketLabel(b) }))
  }

  const statusItems: BarItem[] = useMemo(() => {
    const base = applyFilters(tickets, filters, now, ['status']).filter((t) => inWin(t.created, W))
    const c = new Map<string, number>()
    for (const t of base) c.set(t.status, (c.get(t.status) ?? 0) + 1)
    return Object.keys(STATUS_LABEL).filter((k) => (c.get(k) ?? 0) > 0 || filters.dims.status.includes(k)).map((k) => ({ key: k, label: STATUS_LABEL[k], value: c.get(k) ?? 0, text: String(c.get(k) ?? 0) }))
  }, [tickets, filters, now, W])
  const prioItems: BarItem[] = useMemo(() => {
    const base = applyFilters(tickets, filters, now, ['prio']).filter((t) => inWin(t.created, W))
    return (['urgent', 'high', 'medium', 'low'] as const).map((k) => {
      const n = base.filter((t) => t.prio === k).length
      return { key: k, label: k[0].toUpperCase() + k.slice(1), value: n, text: String(n) }
    })
  }, [tickets, filters, now, W])
  const ageItems: BarItem[] = useMemo(() => {
    const base = applyFilters(tickets, filters, now, ['age']).filter((t) => openAt(t, W.end))
    const c = new Map<string, number>()
    for (const t of base) { const k = ageBucketOf(t, now); c.set(k, (c.get(k) ?? 0) + 1) }
    return AGE_BUCKET_LABELS.filter((l) => l !== RESOLVED_BUCKET).map((k) => ({ key: k, value: c.get(k) ?? 0, text: String(c.get(k) ?? 0) }))
  }, [tickets, filters, now, W])

  const ranked = useMemo(() => rankItems(tickets, filters, rankDim, W, P, m, now), [tickets, filters, rankDim, W, P, m, now])
  const rankShown = useMemo(() => {
    const items = rankMode === 'top' ? ranked.slice(0, 5) : ranked.slice(-5).reverse()
    for (const key of filters.dims[rankDim]) if (!items.some((i) => i.key === key)) { const f = ranked.find((r) => r.key === key); if (f) items.push(f) }
    return items
  }, [ranked, rankMode, filters, rankDim])
  const rankBars: BarItem[] = rankShown.map((r) => ({ key: r.key, value: r.value ?? 0, text: formatMeasure(m, r.value), delta: compareOn ? compare(m, r.value, r.prev) : null }))
  const good = MEASURES[m].good
  const rankCaption = `${good === 'down' ? 'Top = best (lowest)' : good === 'up' ? 'Top = best (highest)' : 'Top = highest'}. ${m === 'sla' || m === 'tat' || m === 'csat' || m === 'frt' ? 'Items with fewer than 3 resolved tickets are left out. ' : ''}Click a name to filter every box on the page.`

  const notes = useMemo(
    () => (copy.showPeople ? insights(tickets, filters, W, P, now, prevWord) : []),
    [copy.showPeople, tickets, filters, W, P, now, prevWord]
  )

  const chips: { label: string; clear: () => void }[] = []
  if (zoom) chips.push({ label: `Time: ${zoom.label}`, clear: () => setZoom(null) })
  for (const d of Object.keys(filters.dims) as Dim[]) for (const v of filters.dims[d]) chips.push({ label: `${DIM_LABEL[d]}: ${statusLabel(v)}`, clear: () => pick(d, v) })
  if (filters.sla) chips.push({ label: 'SLA: Breached only', clear: () => setFilters((f) => ({ ...f, sla: false })) })

  const allDims = dimsForLevel(level)
  const rankDims = allDims.filter((d) => d !== 'age')
  const compareDims = PEOPLE_DIMS.filter((d) => allDims.includes(d))
  const oemDims = OEM_DIMS.filter((d) => allDims.includes(d))
  const mineActive = filters.dims.tech.includes(me)
  const showTrendPrev = compareOn && trendPrev

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">
            {copy.scope} · {periodText} · {T.filter((t) => inWin(t.created, W)).length} {copy.noun} created in this period match your selection
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Period> label="Period" value={zoom ? ('' as Period) : period} onChange={(p) => { setPeriod(p); setZoom(null) }} options={PERIODS.map((p) => ({ value: p.value, label: p.short }))} />
          <button type="button" onClick={() => setCompareOn(!compareOn)} aria-pressed={compareOn}
            className={`inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold ${compareOn ? 'text-foreground' : 'text-muted-foreground'}`}>
            <span className={`relative inline-block h-4 w-7 rounded-full ${compareOn ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${compareOn ? 'left-3.5' : 'left-0.5'}`} />
            </span>
            Compare with previous period
          </button>
          {copy.showMine && (
            <button type="button" onClick={() => pick('tech', me)} aria-pressed={mineActive}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${mineActive ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}>
              Only my tickets
            </button>
          )}
          <button type="button" onClick={reset} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted">Reset all</button>
        </div>
      </div>

      <div className="flex min-h-[32px] flex-wrap items-center gap-2" aria-live="polite">
        {chips.length === 0 ? (
          <span className="text-xs text-muted-foreground">No filters applied. Click any number, bar, name or day to start drilling in.</span>
        ) : chips.map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-3 pr-1.5 text-xs font-semibold text-primary">
            {c.label}
            <button type="button" onClick={c.clear} aria-label={`Remove ${c.label}`} className="h-[18px] w-[18px] rounded-full bg-primary text-[11px] leading-none text-primary-foreground">×</button>
          </span>
        ))}
        {nFilters > 1 && <button type="button" onClick={reset} className="text-xs font-semibold text-primary underline underline-offset-2">Clear all</button>}
      </div>

      {truncated && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">There are more tickets than this page can load, so the oldest ones are left out.</p>}

      {notes.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-2.5">
          {notes.map((n) => (
            <button key={n.kind} type="button" onClick={() => pick(n.dim, n.value)} className="rounded-xl border border-border border-l-4 border-l-primary bg-card px-3 py-2.5 text-left text-[13px] shadow-sm hover:bg-primary/5">
              <span className="mb-0.5 block text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{n.kind}</span>
              {n.parts.map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map(({ k, cur, prev, spark }) => {
          const selected = m === k
          return (
            <div key={k} className={`flex min-w-0 flex-col rounded-xl border p-3.5 shadow-sm transition-colors ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/50'}`}>
              <button type="button" onClick={() => setM(k)} aria-pressed={selected} className="block w-full text-left">
                <span className={`block truncate text-[11px] font-bold uppercase tracking-wide ${selected ? 'text-primary' : 'text-muted-foreground'}`}>{MEASURES[k].label}</span>
                <span className="mt-0.5 block text-[26px] font-extrabold leading-tight tracking-tight">{formatMeasure(k, cur)}</span>
                <span className="block min-h-[18px]">{compareOn && <DeltaBadge d={compare(k, cur, prev)} />}</span>
              </button>
              <div className="mt-1.5"><Spark values={spark} /></div>
              <button type="button" onClick={() => openDrill('tickets', [], { measure: k })} className="mt-1.5 self-start whitespace-nowrap text-[11.5px] font-bold text-primary hover:underline">Breakdown ▸</button>
            </div>
          )
        })}
        <div className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-3.5 shadow-sm transition-colors hover:border-primary/50">
          <button type="button" onClick={() => openDrill('approvals', [], { approval: 'pending' })} className="block w-full text-left">
            <span className="block truncate text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Approvals waiting</span>
            <span className="mt-0.5 block text-[26px] font-extrabold leading-tight tracking-tight">{formatApproval('pending', apPending)}</span>
            <span className="block min-h-[18px]">{compareOn && <DeltaBadge d={compareApproval('pending', apPending, apPendingPrev)} />}</span>
          </button>
          <div className="mt-1.5"><Spark values={apSpark} /></div>
          <button type="button" onClick={() => openDrill('approvals', [], { approval: 'pending' })} className="mt-1.5 self-start whitespace-nowrap text-[11.5px] font-bold text-primary hover:underline">Breakdown ▸</button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <Card className="col-span-12 lg:col-span-8" title={`${MEASURES[m].label} - ${trendBuckets[0]?.step === 1 ? 'by day' : 'by week'}`} caption={`Dashed line = ${prevWord}. Click another number above to change what is shown.`}>
          <TrendChart measure={m} buckets={trendBuckets} current={trendCur} previous={showTrendPrev ? trendPrev : null} selectedStart={zoom?.start ?? null} onPick={pickBucket} />
        </Card>
        <Card className="col-span-12 lg:col-span-4" title="Status" caption="Where tickets are right now. Click to filter.">
          <BarList items={statusItems} selected={filters.dims.status} onPick={(k) => pick('status', k)} onDrill={(k) => openDrill('tickets', [{ dim: 'status', value: k }])} />
        </Card>

        <Card
          className="col-span-12 lg:col-span-7"
          title={`${rankMode === 'top' ? 'Top 5' : 'Bottom 5'} by ${MEASURES[m].label.toLowerCase()}`}
          caption={rankCaption}
          actions={
            <>
              <SelectBox label="By" value={rankDim} onChange={(v) => setRankDim(v as Dim)} options={rankDims.map((d) => ({ value: d, label: DIM_LABEL[d] }))} />
              <Segmented<'top' | 'bottom'> label="Top or bottom" value={rankMode} onChange={setRankMode} options={[{ value: 'top', label: 'Top 5' }, { value: 'bottom', label: 'Bottom 5' }]} />
            </>
          }
        >
          <BarList items={rankBars} selected={filters.dims[rankDim]} onPick={(k) => pick(rankDim, k)} onDrill={(k) => openDrill('tickets', [{ dim: rankDim, value: k }])} />
        </Card>
        <div className="col-span-12 space-y-3 lg:col-span-5">
          <Card title="Priority" caption="Click to filter.">
            <BarList items={prioItems} selected={filters.dims.prio} onPick={(k) => pick('prio', k)} onDrill={(k) => openDrill('tickets', [{ dim: 'prio', value: k }])} />
          </Card>
          <Card title="Backlog age (open tickets)" caption="How long open tickets have been waiting. Click to filter.">
            <BarList items={ageItems} selected={filters.dims.age} onPick={(k) => pick('age', k)} onDrill={(k) => openDrill('tickets', [{ dim: 'age', value: k }])} />
          </Card>
        </div>

        <div className="col-span-12">
          <ApprovalsCard
            approvals={joined} filters={filters} now={now} W={W} P={P} compareOn={compareOn} selectedGroups={filters.dims.group}
            onOpen={(am, path) => openDrill('approvals', path ?? [], { approval: am })}
            onPickGroup={(g) => pick('group', g)}
          />
        </div>

        {oemDims.length > 0 && (
          <div className="col-span-12">
            <CompareTable
              title="OEM-wise tickets" caption="Tickets by OEM (from the requester's store), for example the AC issues of each OEM brand. Click a column to sort, a row to filter, ▸ to drill into stores and tickets."
              tickets={tickets} filters={filters} now={now} W={W} P={P} compareOn={compareOn} dims={oemDims} defaultDim="brand"
              onPick={pick} onDrill={(d, k) => openDrill('tickets', [{ dim: d, value: k }])} selectedFor={(d) => filters.dims[d]}
            />
          </div>
        )}
        <div className="col-span-12">
          <CompareTable
            title="Compare side by side" caption="Every measure for every item, with the change vs the previous period. Click a column heading to sort (best / worst first), a row to filter."
            tickets={tickets} filters={filters} now={now} W={W} P={P} compareOn={compareOn} dims={compareDims} defaultDim={level === 'requester' ? 'cat' : 'group'}
            onPick={pick} onDrill={(d, k) => openDrill('tickets', [{ dim: d, value: k }])} selectedFor={(d) => filters.dims[d]}
          />
        </div>

        <div className="col-span-12 lg:col-span-5"><Heatmap tickets={T} W={W} /></div>
        <div className="col-span-12 lg:col-span-7">
          <TicketListCard tickets={T} W={W} measure={m} hasAge={hasAge} now={now} onOpen={(id) => openDrill('tickets', [], { ticketId: id })} />
        </div>
      </div>

      {drill && (
        <DrillModal
          key={drill.id}
          scope={drill.scope}
          initialPath={drill.path}
          initialTicketId={drill.ticketId}
          initialMeasure={drill.measure}
          initialApproval={drill.approval}
          tickets={tickets}
          approvals={joined}
          filters={filters}
          now={now}
          W={W}
          P={P}
          periodText={periodText}
          compareOn={compareOn}
          level={level}
          onClose={() => setDrill(null)}
          onApply={(path, measureKey) => {
            setFilters((f) => path.reduce((acc, p) => (acc.dims[p.dim].includes(p.value) ? acc : toggleFilter(acc, p.dim, p.value)), f))
            setM(measureKey)
            setDrill(null)
          }}
        />
      )}
    </div>
  )
}
