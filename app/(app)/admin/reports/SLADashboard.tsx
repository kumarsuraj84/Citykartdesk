'use client'

import { ShieldCheck, AlertTriangle, TrendingUp, Clock } from 'lucide-react'
import { SlaGauge, HorizBar } from '@/components/analytics/Charts'
import type { AnalyticsData } from '@/lib/queries/analytics'
import { fmtHours } from '@/lib/utils/fmt'

function KpiTile({ label, value, sub, accent }: {
  label: string
  value: string | number
  sub?: string
  accent?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={accent ? { color: accent } : undefined}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

interface SLADashboardProps {
  data: AnalyticsData
}

export function SLADashboard({ data }: SLADashboardProps) {
  const complianceColor =
    data.slaComplianceRate === null ? undefined
    : data.slaComplianceRate >= 90 ? 'var(--success)'
    : data.slaComplianceRate >= 75 ? 'var(--warning)'
    : 'var(--destructive)'

  const frtColor =
    data.frtComplianceRate === null ? undefined
    : data.frtComplianceRate >= 90 ? 'var(--success)'
    : data.frtComplianceRate >= 75 ? 'var(--warning)'
    : 'var(--destructive)'

  // Build team SLA rows for HorizBar
  const teamSlaData = data.byTeam
    .filter((t) => t.slaRate !== null)
    .sort((a, b) => (b.slaRate ?? 0) - (a.slaRate ?? 0))
    .map((t) => ({ label: t.teamName, value: t.slaRate ?? 0 }))

  // Compliance is "of resolved tickets in this priority, how many met their
  // due date" — matching the org-wide slaComplianceRate and per-team slaRate
  // calculations upstream (both divide by resolved count, not total count
  // including still-open tickets). Dividing by `p.count` here previously
  // diluted the rate with unresolved tickets that haven't had a chance to
  // breach or meet SLA yet, producing an artificially low, non-percentage-
  // shaped number (e.g. "17" instead of a sensible "%").
  const prioritySlaData = data.byPriority
    .filter((p) => p.resolved > 0)
    .map((p) => ({
      label: p.priority.charAt(0).toUpperCase() + p.priority.slice(1),
      value: Math.round((p.slaCompliant / p.resolved) * 100),
    }))

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Resolution SLA"
          value={data.slaComplianceRate !== null ? `${data.slaComplianceRate}%` : '—'}
          sub="of resolved tickets within SLA"
          accent={complianceColor}
        />
        <KpiTile
          label="First Response SLA"
          value={data.frtComplianceRate !== null ? `${data.frtComplianceRate}%` : '—'}
          sub="responded within target"
          accent={frtColor}
        />
        <KpiTile
          label="Breached Now"
          value={data.slaBreachedNow}
          sub="open tickets past resolution deadline"
          accent={data.slaBreachedNow > 0 ? 'var(--destructive)' : undefined}
        />
        <KpiTile
          label="FRT Breached"
          value={data.frtBreachedNow}
          sub="open tickets past first-response deadline"
          accent={data.frtBreachedNow > 0 ? 'var(--warning)' : undefined}
        />
      </div>

      {/* Gauges + breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Resolution SLA gauge */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Resolution SLA Gauge</h2>
          </div>
          <div className="py-2">
            <SlaGauge label="Resolution SLA Compliance" value={data.slaComplianceRate} />
            <div className="mt-3">
              <SlaGauge label="First Response SLA Compliance" value={data.frtComplianceRate} />
            </div>
          </div>
          {/* DESK design-QA copy fix: this used to read "{N} tickets
              currently breached resolution SLA" directly under the two
              compliance gauges above, which invited reading it as sharing
              their denominator — it doesn't. The gauges are % of
              already-resolved/responded tickets in the period; this is a
              live count of currently-OPEN tickets past their deadline
              right now. Explicit "open ticket(s)" + separating clause
              keeps the two populations from reading as one. */}
          <p className="text-center text-xs text-muted-foreground">
            {data.slaBreachedNow} open ticket{data.slaBreachedNow === 1 ? '' : 's'} currently past the resolution deadline
            <span className="block text-muted-foreground/70">(separate from the compliance rates above, which cover already-resolved tickets)</span>
          </p>
        </div>

        {/* SLA by priority */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">SLA Compliance by Priority</h2>
          </div>
          {prioritySlaData.length > 0 ? (
            <HorizBar data={prioritySlaData} color="var(--primary)" valueLabel={(v) => `${v}%`} />
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">No resolved tickets in this period</p>
          )}
        </div>
      </div>

      {/* SLA by team */}
      {teamSlaData.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">SLA Compliance by Team</h2>
          </div>
          <HorizBar data={teamSlaData} color="var(--success)" valueLabel={(v) => `${v}%`} />
        </div>
      )}

      {/* Avg resolution time by priority */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Avg Resolution Time by Priority</h2>
        </div>
        <div className="divide-y divide-border">
          {data.byPriority.filter((p) => p.avgTatHours !== null).map((p) => (
            <div key={p.priority} className="flex items-center justify-between py-2.5">
              <span className="text-xs capitalize text-foreground">{p.priority}</span>
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                {fmtHours(p.avgTatHours)}
              </span>
            </div>
          ))}
          {data.byPriority.filter((p) => p.avgTatHours !== null).length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">No resolved tickets in this period</p>
          )}
        </div>
      </div>
    </div>
  )
}
