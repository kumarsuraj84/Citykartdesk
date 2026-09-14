'use client'

import { useState, useCallback } from 'react'
import {
  AlertTriangle, TrendingUp, TrendingDown, Clock,
  Users, Inbox, ShieldCheck, BarChart2,
} from 'lucide-react'
import {
  KpiCard, DonutChart, LineAreaChart, HorizBar, SlaGauge, AgingBar,
  PRIORITY_COLORS, STATUS_COLORS, STATUS_LABELS,
} from '@/components/analytics/Charts'
import { fmtHours } from '@/lib/utils/fmt'
import { DetailDrawer } from '@/components/analytics/DetailDrawer'
import type { DrawerFilter } from '@/lib/actions/analytics'
import type { AnalyticsData } from '@/lib/queries/analytics'

// ── Layout helpers ─────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, className = '' }: {
  title: string; icon: React.ElementType; children: React.ReactNode; className?: string
}) {
  return (
    <div className={`rounded-xl border border-border bg-card p-5 space-y-4 ${className}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Divider() { return <div className="h-px bg-border my-1" /> }

function StatRow({ label, value, sub, onClick }: {
  label: string; value: string; sub?: string; onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between py-1.5 text-sm border-b border-border/50 last:border-0 ${
        onClick ? 'cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1 transition-colors' : ''
      }`}
    >
      <span className="text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="font-semibold text-foreground">{value}</span>
        {sub && <span className="ml-1.5 text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  )
}

function ClickableRow({ children, onClick, className = '' }: {
  children: React.ReactNode; onClick: () => void; className?: string
}) {
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer hover:bg-muted/40 rounded-lg transition-colors px-2 -mx-2 ${className}`}
    >
      {children}
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function AnalyticsDashboard({ data }: { data: AnalyticsData }) {
  const [drawer, setDrawer] = useState<DrawerFilter | null>(null)
  const close = useCallback(() => setDrawer(null), [])

  const periodLabel = data.periodLabel

  return (
    <>
      <DetailDrawer filter={drawer} onClose={close} />

      <div className="space-y-4">

        {/* ── KPI Strip ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Open Now"
            value={data.totalOpenNow}
            sub="Active backlog"
            accent="#6366F1"
            onClick={() => setDrawer({
              title: 'Open Requests',
              description: 'All currently open requests',
              status: ['open', 'in_progress', 'pending_approval'],
            })}
          />
          <KpiCard
            label="Created"
            value={data.totalCreated}
            sub={periodLabel}
            accent="#06B6D4"
            onClick={() => setDrawer({
              title: `Created — ${periodLabel}`,
              description: 'All requests created in the selected period',
              createdInPeriod: true,
              period: data.period,
            })}
          />
          <KpiCard
            label="Resolved"
            value={data.totalResolved}
            sub={periodLabel}
            accent="#10B981"
            onClick={() => setDrawer({
              title: `Resolved — ${periodLabel}`,
              description: 'Requests resolved in the selected period',
              resolvedInPeriod: true,
              period: data.period,
              sort: 'tat_desc',
            })}
          />
          <KpiCard
            label="SLA Compliance"
            value={data.slaComplianceRate !== null ? `${data.slaComplianceRate}%` : '—'}
            sub="Resolution SLA"
            accent={data.slaComplianceRate !== null && data.slaComplianceRate < 80 ? 'var(--destructive)' : 'var(--success)'}
            onClick={() => setDrawer({
              title: 'Currently Breached (Open)',
              description: 'Open requests that have exceeded their SLA deadline',
              slaBreached: true,
            })}
          />
          <KpiCard
            label="Avg Resolution"
            value={fmtHours(data.avgResolutionHours)}
            sub={
              data.dataAnomalies.negativeResolutionDurationCount > 0
                ? `TAT (resolved) · ${data.dataAnomalies.negativeResolutionDurationCount} excluded (data anomaly)`
                : 'TAT (resolved)'
            }
            accent="var(--primary)"
            onClick={() => setDrawer({
              title: `Resolution TAT — ${periodLabel}`,
              description: 'Resolved requests sorted by resolution time',
              resolvedInPeriod: true,
              period: data.period,
              sort: 'tat_desc',
            })}
          />
          <KpiCard
            label="Currently Breached"
            value={data.slaBreachedNow}
            sub="Open + overdue"
            accent="var(--destructive)"
            danger
            onClick={() => setDrawer({
              title: 'Currently Breached Requests',
              description: 'Open tickets past their SLA deadline — needs immediate action',
              slaBreached: true,
            })}
          />
        </div>

        {/* ── Row 2: Volume Trend + Status Donut ──────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Section title="Volume Trend" icon={BarChart2} className="lg:col-span-2">
            <LineAreaChart
              data={data.trend}
              height={170}
              series={[
                { key: 'created',  label: 'Created',  color: 'var(--primary)', fill: 'var(--primary)' },
                { key: 'resolved', label: 'Resolved', color: 'var(--success)', fill: 'var(--success)' },
              ]}
            />
          </Section>

          <Section title="Status Distribution" icon={Inbox}>
            <DonutChart
              data={data.byStatus.map((s) => ({
                label: STATUS_LABELS[s.status] ?? s.status,
                value: s.count,
                color: STATUS_COLORS[s.status],
                onClick: () => setDrawer({
                  title: STATUS_LABELS[s.status] ?? s.status,
                  description: `All requests with status: ${STATUS_LABELS[s.status] ?? s.status}`,
                  status: [s.status],
                }),
              }))}
            />
            <div className="space-y-0.5 mt-1">
              {data.byStatus.map((s) => (
                <ClickableRow
                  key={s.status}
                  onClick={() => setDrawer({
                    title: STATUS_LABELS[s.status] ?? s.status,
                    description: `All requests with status: ${STATUS_LABELS[s.status] ?? s.status}`,
                    status: [s.status],
                  })}
                  className="py-1"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[s.status] }} />
                      <span className="text-muted-foreground">{STATUS_LABELS[s.status] ?? s.status}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{s.count}</span>
                      <span className="text-muted-foreground w-8 text-right">
                        {Math.round((s.count / (data.totalOpenNow || 1)) * 100)}%
                      </span>
                    </div>
                  </div>
                </ClickableRow>
              ))}
            </div>
          </Section>
        </div>

        {/* ── Row 3: SLA Performance + Priority Breakdown ──────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Section title="SLA Performance" icon={ShieldCheck}>
            <ClickableRow onClick={() => setDrawer({
              title: 'Currently Breached (Resolution)',
              description: 'Open requests that have exceeded their SLA resolution deadline',
              slaBreached: true,
            })}>
              <SlaGauge
                label="Resolution SLA Compliance"
                value={data.slaComplianceRate}
                sub={`${data.slaBreachedNow} tickets currently breached`}
              />
            </ClickableRow>
            <ClickableRow onClick={() => setDrawer({
              title: 'FRT Overdue Requests',
              description: 'Open requests that have not received a first response yet',
              frtBreached: true,
            })}>
              <SlaGauge
                label="First Response Time (FRT)"
                value={data.frtComplianceRate}
                sub={`${data.frtBreachedNow} tickets pending first reply`}
              />
            </ClickableRow>
            <Divider />
            <div className="space-y-1">
              <StatRow
                label="Avg Resolution Time"
                value={fmtHours(data.avgResolutionHours)}
                onClick={() => setDrawer({
                  title: 'Resolved Requests by TAT',
                  description: 'Requests resolved in the period, ordered by most recent',
                  resolvedInPeriod: true,
                  period: data.period,
                  sort: 'tat_desc',
                })}
              />
              <StatRow
                label="Median Resolution Time"
                value={fmtHours(data.medianResolutionHours)}
              />
              <StatRow
                label="Avg First Response Time"
                value={fmtHours(data.avgFirstResponseHours)}
                onClick={() => setDrawer({
                  title: 'FRT Overdue Requests',
                  description: 'Open requests with no first response yet',
                  frtBreached: true,
                })}
              />
            </div>
          </Section>

          <Section title="Priority Breakdown" icon={AlertTriangle}>
            <div className="space-y-1">
              {data.byPriority.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">No data</p>
              )}
              {data.byPriority.map((row) => (
                <ClickableRow
                  key={row.priority}
                  onClick={() => setDrawer({
                    title: `${row.priority.charAt(0).toUpperCase() + row.priority.slice(1)} Priority`,
                    description: `All requests with ${row.priority} priority`,
                    priority: row.priority,
                  })}
                  className="py-1.5"
                >
                  <div className="grid grid-cols-5 items-center gap-2 text-xs">
                    <div className="col-span-1 flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: PRIORITY_COLORS[row.priority] ?? 'var(--muted-foreground)' }}
                      />
                      <span className="font-medium capitalize">{row.priority}</span>
                    </div>
                    <div className="col-span-2">
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.round((row.count / (data.totalCreated || 1)) * 100)}%`,
                            background: PRIORITY_COLORS[row.priority] ?? 'var(--muted-foreground)',
                          }}
                        />
                      </div>
                    </div>
                    <span className="tabular-nums font-semibold text-right">{row.count}</span>
                    <span className="text-muted-foreground text-right tabular-nums">
                      {row.avgTatHours !== null ? fmtHours(row.avgTatHours) : '—'}
                    </span>
                  </div>
                </ClickableRow>
              ))}
              {data.byPriority.length > 0 && (
                <p className="text-[10px] text-muted-foreground pt-1 text-right">Count · Avg TAT</p>
              )}
            </div>
          </Section>
        </div>

        {/* ── Row 4: Team Performance ──────────────────────────────────────── */}
        <Section title="Team Performance" icon={Users}>
          {data.byTeam.length === 0 ? (
            <p className="text-xs text-muted-foreground">No team data available</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['Team', 'Volume', 'Resolved', 'SLA %', 'Avg TAT', 'Open Now'].map((h) => (
                      <th key={h} className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground last:pr-0">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.byTeam.map((row) => {
                    const slaColor = row.slaRate === null ? '' : row.slaRate >= 90 ? 'text-green-600' : row.slaRate >= 75 ? 'text-amber-600' : 'text-red-600'
                    return (
                      <tr
                        key={row.teamId}
                        onClick={() => setDrawer({
                          title: row.teamName,
                          description: `All requests handled by ${row.teamName}`,
                          teamId: row.teamId,
                        })}
                        className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/40 transition-colors rounded"
                      >
                        <td className="py-2.5 pr-4 font-medium">{row.teamName}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{row.volume}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{row.resolved}</td>
                        <td className={`py-2.5 pr-4 tabular-nums font-semibold ${slaColor}`}>
                          {row.slaRate !== null ? `${row.slaRate}%` : '—'}
                        </td>
                        <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">{fmtHours(row.avgTatHours)}</td>
                        <td className="py-2.5 tabular-nums">{row.openNow}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ── Row 5: Top Services + Backlog Aging ─────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Section title="Top Services by Volume" icon={BarChart2}>
            <HorizBar
              data={data.topServices.map((s, i) => ({
                label: s.name,
                value: s.count,
                color: ['#6366F1','#8B5CF6','#06B6D4','#10B981','#F59E0B','#F97316','#EF4444','#84CC16'][i % 8],
                onClick: () => setDrawer({
                  title: s.name,
                  description: `All requests submitted under "${s.name}"`,
                  createdInPeriod: true,
                  period: data.period,
                }),
              }))}
            />
          </Section>

          <Section title="Backlog Aging (Open Tickets)" icon={Clock}>
            <AgingBar aging={data.backlogAging} />
            <Divider />
            <div className="grid grid-cols-3 gap-3 text-center">
              <ClickableRow
                onClick={() => setDrawer({
                  title: 'All Open Requests',
                  description: 'Currently open requests by age',
                  status: ['open', 'in_progress', 'pending_approval'],
                })}
                className="py-2"
              >
                <p className="text-[11px] text-muted-foreground">Open</p>
                <p className="font-bold text-lg">{data.totalOpenNow}</p>
              </ClickableRow>
              <ClickableRow
                onClick={() => setDrawer({
                  title: 'Currently Breached Requests',
                  description: 'Open requests past their SLA deadline',
                  slaBreached: true,
                })}
                className="py-2"
              >
                <p className="text-[11px] text-muted-foreground">Currently Breached</p>
                <p className={`font-bold text-lg ${data.slaBreachedNow > 0 ? 'text-red-600' : ''}`}>{data.slaBreachedNow}</p>
              </ClickableRow>
              <ClickableRow
                onClick={() => setDrawer({
                  title: 'FRT Overdue Requests',
                  description: 'Open requests with no first response yet',
                  frtBreached: true,
                })}
                className="py-2"
              >
                <p className="text-[11px] text-muted-foreground">FRT Overdue</p>
                <p className={`font-bold text-lg ${data.frtBreachedNow > 0 ? 'text-amber-600' : ''}`}>{data.frtBreachedNow}</p>
              </ClickableRow>
            </div>
          </Section>
        </div>

        {/* ── Row 6: Agent Leaderboard + Approval Analytics ─────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Agent leaderboard */}
          <Section title="Agent Leaderboard" icon={Users}>
            {data.agentLeaderboard.length === 0 ? (
              <p className="text-xs text-muted-foreground">No agent data</p>
            ) : (
              <div className="space-y-0">
                {data.agentLeaderboard.slice(0, 8).map((agent, i) => (
                  <ClickableRow
                    key={agent.agentId}
                    onClick={() => setDrawer({
                      title: agent.agentName,
                      description: `All requests assigned to ${agent.agentName}`,
                      assignedTo: agent.agentId,
                    })}
                    className="flex items-center gap-2.5 py-2 border-b border-border/50 last:border-0"
                  >
                    <span className="w-5 text-center text-[11px] font-bold text-muted-foreground">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{agent.agentName}</p>
                      <p className="text-[10px] text-muted-foreground">{agent.openNow} open · {fmtHours(agent.avgTatHours)} avg</p>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold text-green-600">{agent.resolved}</span>
                      <p className="text-[10px] text-muted-foreground">resolved</p>
                    </div>
                  </ClickableRow>
                ))}
              </div>
            )}
          </Section>

          {/* Approval analytics */}
          <Section title="Approval Analytics" icon={ShieldCheck}>
            {/* Funnel bar — Approved / Rejected / Pending */}
            {(() => {
              const total = data.approvalsApproved + data.approvalsRejected + data.approvalsPending
              const approvedPct = total ? Math.round((data.approvalsApproved / total) * 100) : 0
              const rejectedPct = total ? Math.round((data.approvalsRejected / total) * 100) : 0
              const pendingPct  = total ? 100 - approvedPct - rejectedPct : 0
              return (
                <div className="space-y-3">
                  {/* Big rate + stacked bar */}
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Approval Rate</p>
                      <p className={`text-4xl font-extrabold leading-none tabular-nums mt-1 ${
                        (data.approvalRate ?? 100) >= 80 ? 'text-green-600' : (data.approvalRate ?? 100) >= 60 ? 'text-amber-500' : 'text-red-600'
                      }`}>
                        {data.approvalRate !== null ? `${data.approvalRate}%` : '—'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{total} decisions in period</p>
                    </div>
                    {/* Mini donut */}
                    <div className="relative w-16 h-16">
                      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                        <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={18} />
                        {/* Approved arc */}
                        <circle cx="50" cy="50" r="38" fill="none" stroke="#10B981" strokeWidth={18}
                          strokeDasharray={`${approvedPct * 2.39} 239`} strokeLinecap="butt" strokeDashoffset="0" />
                        {/* Rejected arc */}
                        <circle cx="50" cy="50" r="38" fill="none" stroke="#EF4444" strokeWidth={18}
                          strokeDasharray={`${rejectedPct * 2.39} 239`} strokeLinecap="butt"
                          strokeDashoffset={`${-(approvedPct * 2.39)}`} />
                        {/* Pending arc */}
                        <circle cx="50" cy="50" r="38" fill="none" stroke="#F59E0B" strokeWidth={18}
                          strokeDasharray={`${pendingPct * 2.39} 239`} strokeLinecap="butt"
                          strokeDashoffset={`${-((approvedPct + rejectedPct) * 2.39)}`} />
                      </svg>
                    </div>
                  </div>

                  {/* Stacked progress bar */}
                  {total > 0 && (
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted gap-px">
                      {approvedPct > 0 && <div className="bg-success rounded-l-full" style={{ width: `${approvedPct}%` }} />}
                      {rejectedPct > 0 && <div className="bg-destructive" style={{ width: `${rejectedPct}%` }} />}
                      {pendingPct  > 0 && <div className="bg-warning rounded-r-full" style={{ width: `${pendingPct}%` }} />}
                    </div>
                  )}

                  {/* Legend rows */}
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {[
                      { label: 'Approved', value: data.approvalsApproved, color: 'bg-success',  text: 'text-success',  pct: approvedPct },
                      { label: 'Rejected', value: data.approvalsRejected, color: 'bg-destructive',    text: 'text-destructive',    pct: rejectedPct },
                      { label: 'Pending',  value: data.approvalsPending,  color: 'bg-warning',  text: 'text-warning',  pct: pendingPct,
                        onClick: () => setDrawer({ title: 'Pending Approvals', status: ['pending_approval'] }) },
                    ].map((item) => (
                      <div
                        key={item.label}
                        onClick={item.onClick}
                        className={`rounded-lg border border-border bg-muted/30 p-2.5 text-center ${item.onClick ? 'cursor-pointer hover:bg-muted/60 transition-colors' : ''}`}
                      >
                        <div className="flex items-center justify-center gap-1 mb-1">
                          <span className={`h-2 w-2 rounded-full ${item.color}`} />
                          <span className="text-[10px] font-medium text-muted-foreground">{item.label}</span>
                        </div>
                        <p className={`text-lg font-extrabold leading-none tabular-nums ${item.text}`}>{item.value}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{item.pct}%</p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            <Divider />

            {/* Cycle time + Net Flux + Resolved */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">Avg Cycle</p>
                <p className="font-bold text-base tabular-nums mt-0.5">{fmtHours(data.avgApprovalCycleHours)}</p>
                <p className="text-[10px] text-muted-foreground">to decide</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">Net Flux</p>
                <div className={`flex items-center justify-center gap-0.5 font-bold text-base mt-0.5 ${data.netFlux >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {data.netFlux >= 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                  {Math.abs(data.netFlux)}
                </div>
                <p className="text-[10px] text-muted-foreground">{data.netFlux >= 0 ? 'shrinking' : 'growing'}</p>
              </div>
              <ClickableRow
                onClick={() => setDrawer({ title: `Resolved — ${periodLabel}`, resolvedInPeriod: true, period: data.period, sort: 'tat_desc' })}
                className="rounded-lg bg-muted/40 p-2.5 text-center"
              >
                <p className="text-[10px] text-muted-foreground">Resolved</p>
                <p className="font-bold text-base text-green-600 tabular-nums mt-0.5">{data.totalResolved}</p>
                <p className="text-[10px] text-muted-foreground">in period</p>
              </ClickableRow>
            </div>
          </Section>
        </div>
      </div>
    </>
  )
}
