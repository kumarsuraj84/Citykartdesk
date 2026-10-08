'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { CheckCircle2, SlidersHorizontal } from 'lucide-react'
import {
  DIM_LABEL, MEASURES, PERIODS, STATUS_ORDER, applyFilters, capitalize, emptyFilters, filterCount, inWin, isoDay, joinApprovals, periodWindow,
  prevWindow, statusLabel, type CustomRange, type Dim, type ExecApproval, type ExecTicket, type Filters, type Measure, type Period, type SlaState,
} from '@/lib/reporting/executive/engine'
import { explorerBase, matchesSearch, ticketsToCsv } from '@/lib/reporting/executive/explorer'
import { highlights, type Highlight } from '@/lib/reporting/executive/highlights'
import { kpiText, type KpiKey } from '@/lib/reporting/executive/kpi-context'
import { dayLabelYear } from '@/lib/reporting/executive/labels'
import { LEVEL_COPY, type DashLevel } from '@/lib/reporting/executive/levels'
import { CommandBar, type FilterOptions, type Opt } from './CommandBar'
import { DrilldownModal } from './DrilldownModal'
import { ExplorerSection } from './ExplorerSection'
import { HighlightsStrip } from './HighlightsStrip'
import { KpiScorecard } from './KpiScorecard'
import { MatricesSection } from './MatricesSection'
import { PeopleApprovals } from './PeopleApprovals'
import type { DashData, DrillContext, DrillDims, OpenDrill, ViewMode } from './types'
import { VelocitySection } from './VelocitySection'

interface Props {
  level: DashLevel
  me: string
  now: number
  tickets: ExecTicket[]
  approvals: ExecApproval[]
  truncated: boolean
}

const DAY = 86_400_000

function counts(ts: ExecTicket[], key: (t: ExecTicket) => string): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of ts) m.set(key(t), (m.get(key(t)) ?? 0) + 1)
  return m
}
const toOpts = (m: Map<string, number>, label: (v: string) => string = (v) => v, skip: string[] = []): Opt[] =>
  [...m].filter(([v]) => !skip.includes(v)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: label(value), count }))

export function ExecutiveDashboard({ level, me, now, tickets, approvals, truncated }: Props) {
  const copy = LEVEL_COPY[level]
  const [period, setPeriod] = useState<Period>('30d')
  const [custom, setCustom] = useState<CustomRange>(() => ({ start: isoDay(now - 13 * DAY), end: isoDay(now) }))
  const [compareOn, setCompareOn] = useState(true)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [viewMode, setViewMode] = useState<ViewMode>('stream')
  const [metric, setMetric] = useState<KpiKey>('created')
  const [search, setSearch] = useState('')
  const [drill, setDrill] = useState<(DrillContext & { id: number }) | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const seq = useRef(0)

  const W = useMemo(() => periodWindow(period, now, custom), [period, now, custom])
  const P = useMemo(() => prevWindow(W), [W])
  const joined = useMemo(() => joinApprovals(approvals, tickets), [approvals, tickets])
  const d: DashData = useMemo(() => ({ level, me, now, tickets, approvals: joined, filters, W, P, compareOn }), [level, me, now, tickets, joined, filters, W, P, compareOn])

  const periodText = period === 'custom' ? `${dayLabelYear(W.start)} to ${dayLabelYear(W.end)}` : PERIODS.find((p) => p.value === period)?.label ?? ''
  const inPeriod = useMemo(() => tickets.filter((t) => inWin(t.created, W)), [tickets, W])
  const matching = useMemo(() => applyFilters(tickets, filters, now).filter((t) => inWin(t.created, W)).length, [tickets, filters, now, W])

  // lists for the filter drop-downs (counted over the whole period, so they stay put as you filter)
  const options: FilterOptions = useMemo(() => ({
    groups: toOpts(counts(inPeriod, (t) => t.group)),
    techs: toOpts(counts(inPeriod, (t) => t.tech)),
    brands: toOpts(counts(inPeriod, (t) => t.brand), (v) => v, ['(No OEM)']),
    statuses: STATUS_ORDER.filter((s) => inPeriod.some((t) => t.status === s)).map((s) => ({ value: s, label: statusLabel(s), count: inPeriod.filter((t) => t.status === s).length })),
    prios: (['urgent', 'high', 'medium', 'low'] as const).map((p) => ({ value: p, label: capitalize(p), count: inPeriod.filter((t) => t.prio === p).length })),
  }), [inPeriod])

  const items = useMemo(() => highlights(tickets, joined, filters, W, now, copy.showPeople), [tickets, joined, filters, W, now, copy.showPeople])
  const texts = useMemo(() => kpiText(tickets, joined, filters, W, now), [tickets, joined, filters, W, now])

  const open: OpenDrill = useCallback((c) => {
    seq.current += 1
    setDrill({ metric: 'created', dims: {}, ...c, id: seq.current })
  }, [])

  const openKpi = (k: KpiKey) => {
    setMetric(k)
    const label = k === 'approvals' ? 'Approvals waiting' : MEASURES[k as Measure].label
    open({
      title: `${label} - end-to-end drill-down`, subtitle: `${texts[k].context} · ${texts[k].benchmark}`, stage: 1,
      metric: k === 'approvals' ? 'created' : (k as Measure), approvals: k === 'approvals' ? 'pending' : undefined,
    })
  }
  const openHighlight = (h: Highlight) => {
    setMetric(h.open.approvals ? 'approvals' : h.open.metric)
    open({
      title: h.headline, subtitle: `${h.category} · ${h.keyStat} - step through cohort → stores & technicians → tickets → last leg`, stage: h.open.stage,
      metric: h.open.metric, approvals: h.open.approvals ? 'pending' : undefined, dims: Object.fromEntries(h.open.dims.map((x) => [x.dim, x.value])),
    })
  }

  const applySlice = (dims: DrillDims, sla: SlaState) => {
    setFilters((f) => {
      const next: Filters = { ...f, dims: { ...f.dims }, sla: sla !== 'all' ? sla : f.sla }
      for (const k of Object.keys(dims) as Dim[]) if (dims[k]) next.dims[k] = [dims[k] as string]
      return next
    })
  }
  const reset = () => { setFilters(emptyFilters()); setPeriod('30d'); setSearch(''); setMetric('created') }

  const exportCsv = () => {
    const list = explorerBase(tickets, joined, filters, W, now, metric).filter((t) => matchesSearch(t, search))
    const blob = new Blob([ticketsToCsv(list, now)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `smart-dashboard-${isoDay(now)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setToast(`Exported ${list.length} ticket${list.length === 1 ? '' : 's'} to CSV`)
    window.setTimeout(() => setToast(null), 3500)
  }

  const pills: { label: string; clear: () => void; danger?: boolean }[] = []
  if (period === 'custom') pills.push({ label: `Custom dates: ${custom.start} to ${custom.end}`, clear: () => setPeriod('30d') })
  for (const k of Object.keys(filters.dims) as Dim[]) for (const v of filters.dims[k]) {
    pills.push({ label: `${DIM_LABEL[k]}: ${k === 'status' ? statusLabel(v) : k === 'prio' ? capitalize(v) : v}`, clear: () => setFilters((f) => ({ ...f, dims: { ...f.dims, [k]: f.dims[k].filter((x) => x !== v) } })) })
  }
  if (filters.sla !== 'all') pills.push({ label: `SLA: ${filters.sla === 'breached' ? 'breached only' : 'compliant only'}`, clear: () => setFilters((f) => ({ ...f, sla: 'all' })), danger: true })

  const show = (...modes: ViewMode[]) => viewMode === 'stream' || modes.includes(viewMode)

  return (
    <div className="space-y-5 pb-12">
      {toast && (
        <div role="status" className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg border border-border bg-foreground px-4 py-2.5 text-xs font-medium text-background shadow-lg">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /><span>{toast}</span>
        </div>
      )}

      <CommandBar
        title={copy.title} scopeLine={filters.dims.group[0] ?? copy.scope} now={now} periodText={periodText} totalInPeriod={inPeriod.length}
        filters={filters} onFilters={setFilters} period={period} custom={custom} onPeriod={setPeriod} onCustom={(c) => { setCustom(c); setPeriod('custom') }}
        compareOn={compareOn} onCompare={setCompareOn} viewMode={viewMode} onViewMode={setViewMode} options={options} showPeople={copy.showPeople}
        onReset={reset} onExport={exportCsv}
      />

      {pills.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-4 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 font-semibold text-primary"><SlidersHorizontal className="h-3.5 w-3.5" />Active filters:</span>
            {pills.map((p, i) => (
              <button key={i} type="button" onClick={p.clear} aria-label={`Remove ${p.label}`} className={`rounded border bg-card px-2 py-0.5 font-medium ${p.danger ? 'border-destructive/30 text-destructive hover:bg-destructive/10' : 'border-primary/25 text-primary hover:bg-primary/10'}`}>{p.label} ×</button>
            ))}
            <span className="tabular-nums text-muted-foreground">· {matching} of {inPeriod.length} tickets match</span>
          </div>
          <button type="button" onClick={reset} className="font-semibold text-primary hover:underline">Clear all filters</button>
        </div>
      )}

      {truncated && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">There are more tickets than this page can load, so the oldest ones are left out.</p>}

      <HighlightsStrip items={items} total={filterCount(filters) ? matching : inPeriod.length} onOpen={openHighlight} />
      <KpiScorecard d={d} baseW={W} active={metric} onOpen={openKpi} />

      {show('velocity') && <VelocitySection d={d} baseW={W} metric={metric} onOpen={open} />}
      {show('people') && <PeopleApprovals d={d} onOpen={open} />}
      {show('matrices') && <MatricesSection d={d} onOpen={open} />}
      {show('tickets') && <ExplorerSection d={d} metric={metric} search={search} onSearch={setSearch} onOpen={open} onReset={reset} />}

      {drill && (
        <DrilldownModal
          key={drill.id} ctx={drill} tickets={tickets} approvals={joined} filters={filters} now={now} W={W} periodText={periodText}
          onClose={() => setDrill(null)} onApply={applySlice}
        />
      )}
    </div>
  )
}
