'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Inbox,
  UserX,
  AlertTriangle,
  TrendingUp,
  CheckCircle2,
  ListTodo,
  Clock,
  GitMerge,
  BarChart3,
  Settings,
  RefreshCw,
  Activity,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'
import type { MonitoringStats, RecentActivityRow } from '@/lib/queries/admin'

interface MonitoringClientProps {
  stats: MonitoringStats
  recentActivity: RecentActivityRow[]
}

function formatSecondsAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

type ColorVariant = 'blue' | 'amber' | 'red' | 'green' | 'purple' | 'slate'

const borderColors: Record<ColorVariant, string> = {
  blue:   'border-l-blue-500',
  amber:  'border-l-amber-500',
  red:    'border-l-red-500',
  green:  'border-l-green-500',
  purple: 'border-l-purple-500',
  slate:  'border-l-slate-400',
}

const iconColors: Record<ColorVariant, string> = {
  blue:   'text-blue-500',
  amber:  'text-amber-500',
  red:    'text-red-500',
  green:  'text-green-500',
  purple: 'text-purple-500',
  slate:  'text-slate-400',
}

const numberColors: Record<ColorVariant, string> = {
  blue:   'text-blue-600',
  amber:  'text-amber-600',
  red:    'text-red-600',
  green:  'text-green-600',
  purple: 'text-purple-600',
  slate:  'text-slate-600',
}

interface MetricCardProps {
  label: string
  value: number
  icon: React.ElementType
  color: ColorVariant
  href: string
}

function MetricCard({ label, value, icon: Icon, color, href }: MetricCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-col gap-3 rounded-lg border border-l-4 bg-card p-5 shadow-sm',
        'transition-shadow hover:shadow-md',
        borderColors[color]
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <Icon className={cn('h-4 w-4', iconColors[color])} />
      </div>
      <span className={cn('text-3xl font-bold tabular-nums', numberColors[color])}>
        {value.toLocaleString()}
      </span>
    </Link>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  )
}

export function MonitoringClient({ stats, recentActivity }: MonitoringClientProps) {
  const router = useRouter()
  const [secondsAgo, setSecondsAgo] = useState(0)

  useEffect(() => {
    const tick = setInterval(() => setSecondsAgo((s) => s + 1), 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh()
      setSecondsAgo(0)
    }, 60_000)
    return () => clearInterval(interval)
  }, [router])

  function handleRefresh() {
    router.refresh()
    setSecondsAgo(0)
  }

  return (
    <div className="space-y-8 max-w-6xl">
      <PageHeader
        title="System Monitoring"
        description="Real-time platform health and activity overview."
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Last refreshed {formatSecondsAgo(secondsAgo)}
            </span>
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        }
      />

      {/* Platform Health */}
      <section className="space-y-3">
        <SectionLabel>Platform Health</SectionLabel>

        {/* Requests row */}
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium pl-0.5">Requests</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Open Requests"
              value={stats.open_requests}
              icon={Inbox}
              color="blue"
              href="/requests?status=open"
            />
            <MetricCard
              label="Unassigned"
              value={stats.unassigned_requests}
              icon={UserX}
              color="amber"
              href="/requests?assigned=none"
            />
            <MetricCard
              label="SLA Breached"
              value={stats.sla_breached}
              icon={AlertTriangle}
              color="red"
              href="/requests"
            />
            <MetricCard
              label="Requests Today"
              value={stats.requests_today}
              icon={TrendingUp}
              color="green"
              href="/requests"
            />
            <MetricCard
              label="Resolved Today"
              value={stats.resolved_today}
              icon={CheckCircle2}
              color="green"
              href="/requests?status=resolved"
            />
          </div>
        </div>

        {/* Tasks row */}
        <div className="space-y-1.5 pt-2">
          <p className="text-xs text-muted-foreground font-medium pl-0.5">Tasks</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Open Tasks"
              value={stats.open_tasks}
              icon={ListTodo}
              color="blue"
              href="/tasks"
            />
            <MetricCard
              label="Overdue Tasks"
              value={stats.overdue_tasks}
              icon={Clock}
              color="red"
              href="/tasks?filter=overdue"
            />
          </div>
        </div>

        {/* Workflows row */}
        <div className="space-y-1.5 pt-2">
          <p className="text-xs text-muted-foreground font-medium pl-0.5">Workflows</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Pending Approvals"
              value={stats.pending_approvals}
              icon={GitMerge}
              color="purple"
              href="/approvals"
            />
            <MetricCard
              label="Scheduled Reports"
              value={stats.scheduled_reports_count}
              icon={BarChart3}
              color="slate"
              href="/admin/reports"
            />
            <MetricCard
              label="Active Business Rules"
              value={stats.business_rules_count}
              icon={Settings}
              color="slate"
              href="/admin/business-rules"
            />
          </div>
        </div>
      </section>

      {/* Recent Activity */}
      <section className="space-y-3">
        <SectionLabel>Recent Activity</SectionLabel>
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          {recentActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <Activity className="h-8 w-8 opacity-30" />
              <p className="text-sm">No recent activity found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Time</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actor</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Action</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Request</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recentActivity.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{row.actor_name}</td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                          {row.action}
                        </code>
                      </td>
                      <td className="px-4 py-3 max-w-[260px]">
                        {row.request_title ? (
                          <Link
                            href={`/requests/${row.request_id}`}
                            className="text-primary hover:underline truncate block"
                          >
                            {row.request_title}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
