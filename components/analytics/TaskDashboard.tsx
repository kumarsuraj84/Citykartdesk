'use client'

import { useState, useCallback } from 'react'
import {
  AlertTriangle, TrendingUp, TrendingDown, Clock,
  CheckCircle2, Users, ListTodo, BarChart2, Link2, User,
} from 'lucide-react'
import {
  KpiCard, LineAreaChart, HorizBar, AgingBar, DonutChart,
  PRIORITY_COLORS,
} from '@/components/analytics/Charts'
import { fmtHours } from '@/lib/utils/fmt'
import { DetailDrawer } from '@/components/analytics/DetailDrawer'
import type { DrawerFilter } from '@/lib/actions/analytics'
import type { TaskAnalyticsData } from '@/lib/queries/taskAnalytics'

// ── Shared layout helpers ─────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, className = '' }: {
  title: string; icon: React.ElementType; children: React.ReactNode; className?: string
}) {
  return (
    <div className={`rounded-xl border border-border bg-card p-5 space-y-4 ${className}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Divider() { return <div className="h-px bg-border my-1" /> }

function StatRow({ label, value, sub, highlight, onClick }: {
  label: string; value: string; sub?: string; highlight?: 'warn' | 'danger' | 'good'; onClick?: () => void
}) {
  const color = highlight === 'danger' ? 'text-red-600' : highlight === 'warn' ? 'text-amber-600' : highlight === 'good' ? 'text-green-600' : 'text-foreground'
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between py-1.5 text-sm border-b border-border/50 last:border-0 ${
        onClick ? 'cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1 transition-colors' : ''
      }`}
    >
      <span className="text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className={`font-semibold ${color}`}>{value}</span>
        {sub && <span className="ml-1.5 text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  )
}

function ClickRow({ children, onClick, className = '' }: {
  children: React.ReactNode; onClick: () => void; className?: string
}) {
  return (
    <div onClick={onClick} className={`cursor-pointer hover:bg-muted/40 rounded-lg transition-colors px-2 -mx-2 ${className}`}>
      {children}
    </div>
  )
}

const STATUS_COLORS_TASK: Record<string, string> = {
  open:        '#6366F1',
  in_progress: '#F59E0B',
  done:        '#10B981',
  cancelled:   '#94A3B8',
}
const STATUS_LABELS_TASK: Record<string, string> = {
  open:        'Open',
  in_progress: 'In Progress',
  done:        'Done',
  cancelled:   'Cancelled',
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function TaskDashboard({ data }: { data: TaskAnalyticsData }) {
  const [drawer, setDrawer] = useState<DrawerFilter | null>(null)
  const close = useCallback(() => setDrawer(null), [])
  const periodLabel = data.period === '7d' ? 'last 7 days' : data.period === '30d' ? 'last 30 days' : 'last 90 days'

  return (
    <>
      <DetailDrawer filter={drawer} onClose={close} />

      <div className="space-y-4">

        {/* ── KPI Strip ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Open Tasks"
            value={data.totalOpen}
            sub="Active backlog"
            accent="#6366F1"
            onClick={() => setDrawer({ title: 'Open Tasks', description: 'All currently open tasks', status: ['open', 'in_progress'], _module: 'tasks' })}
          />
          <KpiCard
            label="Overdue"
            value={data.totalOverdue}
            sub="Past due date"
            accent="#EF4444"
            danger={data.totalOverdue > 0}
            onClick={() => setDrawer({ title: 'Overdue Tasks', description: 'Open tasks past their due date', taskOverdue: true, _module: 'tasks' })}
          />
          <KpiCard
            label="Created"
            value={data.totalCreatedInPeriod}
            sub={periodLabel}
            accent="#06B6D4"
            onClick={() => setDrawer({ title: `Created — ${periodLabel}`, createdInPeriod: true, period: data.period, _module: 'tasks' })}
          />
          <KpiCard
            label="Completed"
            value={data.totalCompletedInPeriod}
            sub={periodLabel}
            accent="#10B981"
            onClick={() => setDrawer({ title: `Completed — ${periodLabel}`, taskCompletedInPeriod: true, period: data.period, _module: 'tasks' })}
          />
          <KpiCard
            label="Completion Rate"
            value={data.completionRate !== null ? `${data.completionRate}%` : '—'}
            sub="Done / (Done + Open)"
            accent={data.completionRate !== null && data.completionRate < 50 ? '#F59E0B' : '#10B981'}
          />
          <KpiCard
            label="Avg Completion"
            value={fmtHours(data.avgCompletionHours)}
            sub="Time to done"
            accent="#8B5CF6"
            onClick={() => setDrawer({ title: 'Completed Tasks', description: 'Completed tasks by time', taskCompletedInPeriod: true, period: data.period, _module: 'tasks' })}
          />
        </div>

        {/* ── Row 2: Trend + Status Donut ────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Section title="Completion Trend" icon={BarChart2} className="lg:col-span-2">
            <LineAreaChart
              data={data.trend}
              height={170}
              series={[
                { key: 'created',   label: 'Created',   color: '#6366F1', fill: '#6366F1' },
                { key: 'completed', label: 'Completed', color: '#10B981', fill: '#10B981' },
              ]}
            />
          </Section>

          <Section title="Status Breakdown" icon={ListTodo}>
            <DonutChart
              data={data.byStatus.map((s) => ({
                label: STATUS_LABELS_TASK[s.status] ?? s.status,
                value: s.count,
                color: STATUS_COLORS_TASK[s.status] ?? '#94A3B8',
                onClick: () => setDrawer({
                  title: STATUS_LABELS_TASK[s.status] ?? s.status,
                  description: `All tasks with status: ${STATUS_LABELS_TASK[s.status] ?? s.status}`,
                  status: [s.status],
                  _module: 'tasks',
                }),
              }))}
            />
            <div className="space-y-0.5 mt-1">
              {data.byStatus.map((s) => (
                <ClickRow
                  key={s.status}
                  onClick={() => setDrawer({ title: STATUS_LABELS_TASK[s.status] ?? s.status, status: [s.status], _module: 'tasks' })}
                  className="py-1"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS_TASK[s.status] ?? '#94A3B8' }} />
                      <span className="text-muted-foreground">{STATUS_LABELS_TASK[s.status] ?? s.status}</span>
                    </div>
                    <span className="font-semibold">{s.count}</span>
                  </div>
                </ClickRow>
              ))}
            </div>
          </Section>
        </div>

        {/* ── Row 3: Priority + Type + Stats ────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          <Section title="Priority Breakdown" icon={AlertTriangle}>
            <div className="space-y-1">
              {data.byPriority.length === 0 && <p className="text-xs text-muted-foreground py-2">No data</p>}
              {data.byPriority.map((row) => (
                <ClickRow
                  key={row.priority}
                  onClick={() => setDrawer({ title: `${row.priority} Priority Tasks`, priority: row.priority, _module: 'tasks' })}
                  className="py-2"
                >
                  <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1.5 w-16 shrink-0">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: PRIORITY_COLORS[row.priority] ?? '#94A3B8' }} />
                      <span className="font-medium capitalize">{row.priority}</span>
                    </div>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${Math.round((row.count / Math.max(1, data.totalOpen + data.totalCompletedInPeriod)) * 100)}%`,
                          background: PRIORITY_COLORS[row.priority] ?? '#94A3B8',
                        }} />
                      </div>
                    </div>
                    <span className="w-6 tabular-nums font-semibold text-right">{row.count}</span>
                    {row.overdue > 0 && (
                      <span className="text-red-600 font-semibold tabular-nums">{row.overdue} overdue</span>
                    )}
                    <span className="text-muted-foreground tabular-nums w-12 text-right">
                      {row.avgHours !== null ? fmtHours(row.avgHours) : '—'}
                    </span>
                  </div>
                </ClickRow>
              ))}
              {data.byPriority.length > 0 && (
                <p className="text-[10px] text-muted-foreground pt-1 text-right">Count · Overdue · Avg Time</p>
              )}
            </div>
          </Section>

          <Section title="Task Overview" icon={ListTodo}>
            <div className="space-y-1">
              <StatRow label="Open Tasks"         value={String(data.totalOpen)}    onClick={() => setDrawer({ title: 'Open Tasks', status: ['open','in_progress'], _module: 'tasks' })} />
              <StatRow label="Overdue"            value={String(data.totalOverdue)} highlight={data.totalOverdue > 0 ? 'danger' : undefined} onClick={() => setDrawer({ title: 'Overdue Tasks', taskOverdue: true, _module: 'tasks' })} />
              <StatRow label={`Created (${data.period})`}   value={String(data.totalCreatedInPeriod)} onClick={() => setDrawer({ title: 'Created Tasks', createdInPeriod: true, period: data.period, _module: 'tasks' })} />
              <StatRow label={`Completed (${data.period})`} value={String(data.totalCompletedInPeriod)} highlight="good" onClick={() => setDrawer({ title: 'Completed Tasks', taskCompletedInPeriod: true, period: data.period, _module: 'tasks' })} />
              <StatRow label="Avg Completion"      value={fmtHours(data.avgCompletionHours)} />
              <StatRow label="Median Completion"   value={fmtHours(data.medianCompletionHours)} />
            </div>
            <Divider />
            {/* Task type split */}
            <div className="grid grid-cols-2 gap-3 text-center">
              <ClickRow
                onClick={() => setDrawer({ title: 'Team Tasks', taskType: 'team', _module: 'tasks' })}
                className="rounded-lg bg-muted/50 p-3"
              >
                <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                <p className="font-bold text-lg">{data.byType.find((t) => t.type === 'team')?.count ?? 0}</p>
                <p className="text-[11px] text-muted-foreground">Team Tasks</p>
              </ClickRow>
              <ClickRow
                onClick={() => setDrawer({ title: 'Personal Tasks', taskType: 'personal', _module: 'tasks' })}
                className="rounded-lg bg-muted/50 p-3"
              >
                <User className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                <p className="font-bold text-lg">{data.byType.find((t) => t.type === 'personal')?.count ?? 0}</p>
                <p className="text-[11px] text-muted-foreground">Personal Tasks</p>
              </ClickRow>
            </div>
            <Divider />
            {/* Linked vs standalone */}
            <div className="grid grid-cols-2 gap-3 text-center">
              <ClickRow
                onClick={() => setDrawer({ title: 'Tasks Linked to Requests', taskLinkedToRequest: true, _module: 'tasks' })}
                className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 p-3"
              >
                <Link2 className="h-4 w-4 mx-auto mb-1 text-indigo-500" />
                <p className="font-bold text-lg text-indigo-600">{data.linkedToRequests}</p>
                <p className="text-[11px] text-muted-foreground">Linked to Requests</p>
              </ClickRow>
              <ClickRow
                onClick={() => setDrawer({ title: 'Standalone Tasks', taskStandalone: true, _module: 'tasks' })}
                className="rounded-lg bg-muted/50 p-3"
              >
                <ListTodo className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                <p className="font-bold text-lg">{data.standalone}</p>
                <p className="text-[11px] text-muted-foreground">Standalone</p>
              </ClickRow>
            </div>
          </Section>
        </div>

        {/* ── Row 4: Team Performance ────────────────────────────────────────── */}
        {data.byTeam.length > 0 && (
          <Section title="Team Performance" icon={Users}>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['Team', 'Total', 'Done', 'Overdue', 'Open Now', 'Avg Time'].map((h) => (
                      <th key={h} className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.byTeam.map((row) => (
                    <tr
                      key={row.teamId}
                      onClick={() => setDrawer({ title: row.teamName, description: `All tasks for ${row.teamName}`, teamId: row.teamId, _module: 'tasks' })}
                      className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <td className="py-2.5 pr-4 font-medium">{row.teamName}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{row.total}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-green-600 font-semibold">{row.done}</td>
                      <td className={`py-2.5 pr-4 tabular-nums font-semibold ${row.overdue > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>{row.overdue}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{row.openNow}</td>
                      <td className="py-2.5 tabular-nums text-muted-foreground">{fmtHours(row.avgHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* ── Row 5: Agent Leaderboard + Aging ───────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          <Section title="Agent Leaderboard" icon={Users}>
            {data.agentLeaderboard.length === 0 ? (
              <p className="text-xs text-muted-foreground">No agent data</p>
            ) : (
              <div className="space-y-0">
                {data.agentLeaderboard.map((agent, i) => (
                  <ClickRow
                    key={agent.agentId}
                    onClick={() => setDrawer({ title: agent.agentName, description: `Tasks assigned to ${agent.agentName}`, assignedTo: agent.agentId, _module: 'tasks' })}
                    className="flex items-center gap-2.5 py-2 border-b border-border/50 last:border-0"
                  >
                    <span className="w-5 text-center text-[11px] font-bold text-muted-foreground">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{agent.agentName}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {agent.open} open
                        {agent.overdue > 0 && <span className="text-red-500 ml-1">· {agent.overdue} overdue</span>}
                        {agent.avgHours !== null && ` · ${fmtHours(agent.avgHours)} avg`}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold text-green-600">{agent.done}</span>
                      <p className="text-[10px] text-muted-foreground">done</p>
                    </div>
                  </ClickRow>
                ))}
              </div>
            )}
          </Section>

          <Section title="Backlog Aging (Open Tasks)" icon={Clock}>
            <AgingBar aging={data.aging} />
            <Divider />
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: '< 1 day',  value: data.aging.d1,      danger: false },
                { label: '1–7 days', value: data.aging.d7,      danger: false },
                { label: '7–30d',    value: data.aging.d30,     danger: data.aging.d30 > 0 },
                { label: '> 30 days',value: data.aging.d30plus, danger: data.aging.d30plus > 0 },
              ].map((b) => (
                <div key={b.label} className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground leading-tight">{b.label}</p>
                  <p className={`font-bold text-base ${b.danger ? 'text-red-600' : ''}`}>{b.value}</p>
                </div>
              ))}
            </div>
            <Divider />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Net Flux</p>
                <div className={`flex items-center gap-1 font-bold ${data.netFlux >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {data.netFlux >= 0
                    ? <TrendingDown className="h-4 w-4" />
                    : <TrendingUp className="h-4 w-4" />}
                  <span>{Math.abs(data.netFlux)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{data.netFlux >= 0 ? 'Backlog shrinking' : 'Backlog growing'}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Completion Rate</p>
                <p className="font-bold text-xl text-green-600">{data.completionRate ?? 0}%</p>
                <div className="mt-1 h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-green-500" style={{ width: `${data.completionRate ?? 0}%` }} />
                </div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </>
  )
}
