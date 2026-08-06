'use client'

import { ShieldCheck, AlertTriangle, TrendingUp, Clock } from 'lucide-react'
import { SlaGauge, HorizBar } from '@/components/analytics/Charts'
import type { AnalyticsData } from '@/lib/queries/analytics'

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

  const prioritySlaData = data.byPriority
    .filter((p) => p.count > 0)
    .map((p) => ({
      label: p.priority.charAt(0).toUpperCase() + p.priority.slice(1),
      value: p.count > 0 ? Math.round((p.slaCompliant / p.count) * 100) : 0,
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
          <p className="text-center text-xs text-muted-foreground">
            {data.slaBreachedNow} tickets currently breached resolution SLA
          </p>
        </div>

        {/* SLA by priority */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">SLA Compliance by Priority</h2>
          </div>
          {prioritySlaData.length > 0 ? (
            <HorizBar data={prioritySlaData} color="var(--primary)" />
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
          <HorizBar data={teamSlaData} color="var(--success)" />
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
                {p.avgTatHours !== null
                  ? p.avgTatHours >= 24
                    ? `${(p.avgTatHours / 24).toFixed(1)}d`
                    : `${p.avgTatHours.toFixed(1)}h`
                  : '—'}
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
