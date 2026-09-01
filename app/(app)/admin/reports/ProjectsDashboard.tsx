'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  FolderKanban, ArrowRight, TrendingUp, Users, Clock, GanttChartSquare,
  ChevronDown, ChevronRight, AlertTriangle, Layers, PieChart, CalendarRange, UserCheck,
} from 'lucide-react'
import {
  LineAreaChart, HorizBar, BarChart, DonutChart, AgingBar, PALETTE,
  PROJECT_STATUS_COLORS, PROJECT_STATUS_LABELS,
} from '@/components/analytics/Charts'
import type { ProjectAnalyticsData, ManagerRollup, OwnerRollupRow, LoadItem } from '@/lib/queries/projectAnalytics'

// ── Layout helpers (mirrors AnalyticsDashboard's Section/Divider) ──────────────

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

// This dashboard is reachable by plain managers (admin/reports is
// manager-or-admin), but /projects and /projects/[id] now redirect anyone
// who isn't admin/platform_owner to /home (Projects is admin-only for now —
// see components/layout/Sidebar.tsx). Render project deep-links as plain,
// non-navigating content for a non-admin viewer instead of a dead-end link.
function ProjectLink({ href, isAdmin, className, children }: {
  href: string; isAdmin: boolean; className?: string; children: React.ReactNode
}) {
  if (!isAdmin) return <div className={className}>{children}</div>
  return <Link href={href} className={className}>{children}</Link>
}

// ── Milestones Timeline (portfolio Gantt) ───────────────────────────────────────

const MS_DAY = 24 * 60 * 60 * 1000

function toLocalDate(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function MilestonesTimeline({ milestones, nowIso, isAdmin }: {
  milestones: ProjectAnalyticsData['milestonesTimeline']; nowIso: string; isAdmin: boolean
}) {
  const now = new Date(nowIso).getTime()

  let min = Infinity
  let max = -Infinity
  for (const m of milestones) {
    const s = m.startDate ? toLocalDate(m.startDate).getTime() : toLocalDate(m.endDate).getTime()
    const e = toLocalDate(m.endDate).getTime()
    if (s < min) min = s
    if (e > max) max = e
  }
  min = Math.min(min, now) - MS_DAY
  max = Math.max(max, now) + MS_DAY
  const totalMs = Math.max(max - min, MS_DAY)
  const todayPct = ((now - min) / totalMs) * 100

  const sorted = [...milestones].sort((a, b) => {
    const av = a.startDate ? toLocalDate(a.startDate).getTime() : toLocalDate(a.endDate).getTime()
    const bv = b.startDate ? toLocalDate(b.startDate).getTime() : toLocalDate(b.endDate).getTime()
    return av - bv
  })

  return (
    <div className="space-y-0">
      <div className="flex items-center justify-between pb-2 text-[11px] text-muted-foreground">
        <span>{fmtShort(new Date(min))}</span>
        <span className="font-semibold text-foreground">Today</span>
        <span>{fmtShort(new Date(max))}</span>
      </div>
      <div className="relative divide-y divide-border/60 rounded-lg border border-border">
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary/50 z-10"
          style={{ left: `${todayPct}%` }}
        />
        {sorted.map((m) => {
          const startMs = m.startDate ? toLocalDate(m.startDate).getTime() : toLocalDate(m.endDate).getTime()
          const endMs = toLocalDate(m.endDate).getTime()
          const left = ((startMs - min) / totalMs) * 100
          const width = Math.max(((Math.max(endMs, startMs) - startMs) / totalMs) * 100, 1)
          return (
            <ProjectLink
              key={m.id}
              href={`/projects/${m.projectId}`}
              isAdmin={isAdmin}
              className="relative flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors"
            >
              <span className="w-48 shrink-0 truncate text-xs">
                <span className="font-medium text-foreground">{m.name}</span>
                <span className="text-muted-foreground"> · {m.projectName}</span>
              </span>
              <span className="relative h-2 flex-1">
                <span
                  className="absolute top-0 h-2 rounded-full"
                  style={{ left: `${left}%`, width: `${width}%`, background: PROJECT_STATUS_COLORS[m.status] }}
                  title={`${fmtShort(new Date(startMs))} → ${fmtShort(new Date(endMs))}`}
                />
              </span>
            </ProjectLink>
          )
        })}
      </div>
    </div>
  )
}

// ── Load-detection Gantt (portfolio capacity) ───────────────────────────────
// Same visual language as the Milestones Timeline above, but grouped by
// project or by owner, with a peak-concurrency chip per group so overloaded
// weeks stand out without reading every bar.

const WEEK_MS = 7 * MS_DAY

function startOfWeekUTC(ms: number): number {
  const d = new Date(ms)
  const diff = d.getUTCDate() - d.getUTCDay()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff)
}

function weeklyPeak(items: { startMs: number; endMs: number }[]): number {
  if (items.length === 0) return 0
  const weekStarts = new Set<number>()
  for (const it of items) {
    for (let t = startOfWeekUTC(it.startMs); t <= it.endMs; t += WEEK_MS) weekStarts.add(t)
  }
  let peak = 0
  for (const ws of weekStarts) {
    const we = ws + WEEK_MS
    const count = items.filter((it) => it.startMs < we && it.endMs >= ws).length
    if (count > peak) peak = count
  }
  return peak
}

function peakChipClass(n: number): string {
  if (n >= 4) return 'text-red-700 bg-red-50 border-red-200'
  if (n >= 2) return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-emerald-700 bg-emerald-50 border-emerald-200'
}

function LoadGroup({ label, items, min, totalMs, now, isAdmin }: {
  label: string; items: LoadItem[]; min: number; totalMs: number; now: number; isAdmin: boolean
}) {
  const [open, setOpen] = useState(true)
  const todayPct = ((now - min) / totalMs) * 100
  const peak = weeklyPeak(
    items.map((it) => ({
      startMs: it.startDate ? toLocalDate(it.startDate).getTime() : toLocalDate(it.endDate).getTime(),
      endMs: toLocalDate(it.endDate).getTime(),
    }))
  )
  const sorted = [...items].sort((a, b) => {
    const av = a.startDate ? toLocalDate(a.startDate).getTime() : toLocalDate(a.endDate).getTime()
    const bv = b.startDate ? toLocalDate(b.startDate).getTime() : toLocalDate(b.endDate).getTime()
    return av - bv
  })

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">({items.length})</span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${peakChipClass(peak)}`}>
          ×{peak} peak overlap
        </span>
      </button>
      {open && (
      <div className="relative divide-y divide-border/60 rounded-lg border border-border">
        <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary/50 z-10" style={{ left: `${todayPct}%` }} />
        {sorted.map((it) => {
          const startMs = it.startDate ? toLocalDate(it.startDate).getTime() : toLocalDate(it.endDate).getTime()
          const endMs = toLocalDate(it.endDate).getTime()
          const left = ((startMs - min) / totalMs) * 100
          const width = Math.max(((Math.max(endMs, startMs) - startMs) / totalMs) * 100, 1)
          return (
            <ProjectLink
              key={`${it.kind}-${it.id}`}
              href={`/projects/${it.projectId}`}
              isAdmin={isAdmin}
              className="relative flex items-center gap-3 px-3 py-2 hover:bg-muted/40 transition-colors"
            >
              <span className="w-52 shrink-0 truncate text-xs">
                {it.kind === 'milestone' && <span className="text-muted-foreground">↳ </span>}
                <span className="font-medium text-foreground">{it.name}</span>
                {it.kind === 'milestone' && <span className="text-muted-foreground"> · {it.projectName}</span>}
              </span>
              <span className="relative h-2 flex-1">
                <span
                  className={`absolute top-0 h-2 rounded-full ${it.kind === 'milestone' ? 'opacity-70' : ''}`}
                  style={{ left: `${left}%`, width: `${width}%`, background: PROJECT_STATUS_COLORS[it.status] }}
                  title={`${fmtShort(new Date(startMs))} → ${fmtShort(new Date(endMs))}`}
                />
              </span>
            </ProjectLink>
          )
        })}
      </div>
      )}
    </div>
  )
}

function LoadGantt({ items, nowIso, isAdmin }: { items: LoadItem[]; nowIso: string; isAdmin: boolean }) {
  const [groupBy, setGroupBy] = useState<'project' | 'owner'>('project')
  const [ownerFilter, setOwnerFilter] = useState('')
  const now = new Date(nowIso).getTime()

  const owners = [...new Map(items.map((it) => [it.ownerId, it.ownerName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
  const filteredItems = ownerFilter ? items.filter((it) => it.ownerId === ownerFilter) : items

  let min = Infinity
  let max = -Infinity
  for (const it of filteredItems) {
    const s = it.startDate ? toLocalDate(it.startDate).getTime() : toLocalDate(it.endDate).getTime()
    const e = toLocalDate(it.endDate).getTime()
    if (s < min) min = s
    if (e > max) max = e
  }
  if (!Number.isFinite(min)) { min = now; max = now }
  min = Math.min(min, now) - MS_DAY
  max = Math.max(max, now) + MS_DAY
  const totalMs = Math.max(max - min, MS_DAY)

  const groups = new Map<string, { label: string; items: LoadItem[] }>()
  for (const it of filteredItems) {
    const key = groupBy === 'project' ? it.projectId : it.ownerId
    const label = groupBy === 'project' ? it.projectName : it.ownerName
    if (!groups.has(key)) groups.set(key, { label, items: [] })
    groups.get(key)!.items.push(it)
  }
  const groupList = [...groups.entries()].sort((a, b) => b[1].items.length - a[1].items.length)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              onClick={() => setGroupBy('project')}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${groupBy === 'project' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              By Project
            </button>
            <button
              onClick={() => setGroupBy('owner')}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${groupBy === 'owner' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              By Owner
            </button>
          </div>
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="h-7 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All owners</option>
            {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{fmtShort(new Date(min))}</span>
          <ArrowRight className="h-3 w-3" />
          <span>{fmtShort(new Date(max))}</span>
        </div>
      </div>

      {groupList.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No dated projects or milestones to plot yet.</p>
      ) : (
        <div className="space-y-4">
          {groupList.map(([key, g]) => (
            <LoadGroup key={key} label={g.label} items={g.items} min={min} totalMs={totalMs} now={now} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Owner workload — active vs done, distinct from the task-assignee-based
// "Project Workload" chart above (this counts projects owned, not tasks). ──

function OwnerActiveDoneBar({ rows }: { rows: OwnerRollupRow[] }) {
  const max = Math.max(...rows.map((r) => r.totalProjects - r.cancelled), 1)
  if (rows.length === 0) return <div className="py-4 text-xs text-muted-foreground text-center">No data</div>
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const active = r.notStarted + r.inProgress + r.blocked
        const total = active + r.done
        return (
          <div key={r.ownerId} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-xs text-muted-foreground truncate text-right">{r.ownerName}</span>
            <div className="flex-1 rounded-full bg-muted h-2.5 overflow-hidden flex">
              <div className="h-full" style={{ width: `${(active / max) * 100}%`, background: 'var(--primary)' }} />
              <div className="h-full" style={{ width: `${(r.done / max) * 100}%`, background: 'var(--muted-foreground)' }} />
            </div>
            <span className="w-10 shrink-0 text-xs font-semibold text-foreground tabular-nums text-right">{total}</span>
          </div>
        )
      })}
      <div className="flex items-center gap-3 pt-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" /> Active</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> Done</span>
      </div>
    </div>
  )
}

// ── Daily update-frequency strip — pairs with the Progress Trend line chart
// to show WHEN updates were posted, not just the resulting avg %. ──────────

function UpdatesStrip({ points }: { points: ProjectAnalyticsData['projectProgressTrend'] }) {
  const max = Math.max(...points.map((p) => p.updates), 1)
  return (
    <div className="flex items-end gap-px h-8">
      {points.map((p) => (
        <div
          key={p.date}
          className="flex-1 rounded-sm bg-primary/40"
          style={{ height: p.updates > 0 ? `${Math.max((p.updates / max) * 100, 12)}%` : '2px' }}
          title={`${p.date}: ${p.updates} update${p.updates === 1 ? '' : 's'}`}
        />
      ))}
    </div>
  )
}

// ── Manager rollup ───────────────────────────────────────────────────────────

function RollupBars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-xs text-muted-foreground">{value}%</span>
    </div>
  )
}

function OwnerTable({ rows, caption }: { rows: OwnerRollupRow[]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="bg-muted/40 text-left">
            <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{caption}</th>
            <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</th>
            <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">In Progress</th>
            <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Done</th>
            <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Overdue</th>
            <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Due ≤7d</th>
            <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Avg Progress</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ownerId} className="border-t border-border">
              <td className="px-3 py-1.5 font-medium">{r.ownerName}</td>
              <td className="px-3 py-1.5 font-mono">{r.totalProjects}</td>
              <td className="px-3 py-1.5 font-mono">{r.inProgress}</td>
              <td className="px-3 py-1.5 font-mono">{r.done}</td>
              <td className={`px-3 py-1.5 font-mono ${r.overdue > 0 ? 'font-semibold text-red-600' : ''}`}>{r.overdue}</td>
              <td className={`px-3 py-1.5 font-mono ${r.dueSoon > 0 ? 'font-semibold text-amber-600' : ''}`}>{r.dueSoon}</td>
              <td className="px-3 py-1.5"><RollupBars value={r.avgProgressPct} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ManagerRollupPanel({ rollup }: { rollup: ManagerRollup }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">{rollup.managerName}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {rollup.reports.length} report{rollup.reports.length === 1 ? '' : 's'}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-4 text-xs">
          <span className="font-mono">{rollup.stats.totalProjects} projects</span>
          <span className="font-mono">{rollup.stats.done} done</span>
          <span className={`font-mono ${rollup.stats.overdue > 0 ? 'font-semibold text-red-600' : ''}`}>{rollup.stats.overdue} overdue</span>
          <span className="font-mono">{rollup.stats.avgProgressPct}% avg</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-border p-3">
          <OwnerTable rows={rollup.reports} caption={`Reports to ${rollup.managerName}`} />
        </div>
      )}
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function ProjectsDashboard({ data, isAdmin }: { data: ProjectAnalyticsData; isAdmin: boolean }) {
  return (
    <div className="space-y-4">

      {/* ── Projects KPI strip ── */}
      <Section title="Projects" icon={FolderKanban}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-muted/40 p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Active</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums">{data.projectsActive}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums">
              {data.projectsByStatus.reduce((sum, s) => sum + s.count, 0)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Milestones Due Soon</p>
            <p className={`mt-0.5 text-2xl font-bold tabular-nums ${data.milestonesDueSoon > 0 ? 'text-amber-600' : ''}`}>
              {data.milestonesDueSoon}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Milestones Overdue</p>
            <p className={`mt-0.5 text-2xl font-bold tabular-nums ${data.milestonesOverdue > 0 ? 'text-red-600' : ''}`}>
              {data.milestonesOverdue}
            </p>
          </div>
        </div>

        {data.projectsByStatus.length > 0 && (
          <>
            <Divider />
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted gap-px">
              {data.projectsByStatus.map((s) => {
                const total = data.projectsByStatus.reduce((sum, r) => sum + r.count, 0) || 1
                return (
                  <div
                    key={s.status}
                    style={{ width: `${(s.count / total) * 100}%`, background: PROJECT_STATUS_COLORS[s.status] }}
                  />
                )
              })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
              {data.projectsByStatus.map((s) => (
                <div key={s.status} className="flex items-center gap-1.5 text-xs">
                  <span className="h-2 w-2 rounded-full" style={{ background: PROJECT_STATUS_COLORS[s.status] }} />
                  <span className="text-muted-foreground">{PROJECT_STATUS_LABELS[s.status] ?? s.status}</span>
                  <span className="font-semibold">{s.count}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {isAdmin && (
          <Link href="/projects" className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            View all projects <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </Section>

      {/* ── Status Mix + Projects by Owner ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Status Mix" icon={PieChart}>
          <DonutChart
            data={data.projectsByStatus.map((s) => ({
              label: PROJECT_STATUS_LABELS[s.status] ?? s.status,
              value: s.count,
              color: PROJECT_STATUS_COLORS[s.status],
            }))}
          />
        </Section>

        <Section title="Projects by Owner" icon={UserCheck}>
          <OwnerActiveDoneBar rows={data.allOwnerRows.slice(0, 10)} />
        </Section>
      </div>

      {/* ── Progress Trend ── */}
      <Section title="Project Progress Trend" icon={TrendingUp}>
        {data.projectProgressTrend.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No daily updates posted yet — the trend appears once updates start coming in.
          </p>
        ) : (
          <div className="space-y-1">
            <LineAreaChart
              data={data.projectProgressTrend}
              height={170}
              series={[{ key: 'avg', label: 'Avg % Complete', color: 'var(--primary)', fill: 'var(--primary)' }]}
            />
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Updates posted per day</p>
            <UpdatesStrip points={data.projectProgressTrend} />
          </div>
        )}
      </Section>

      {/* ── Workload + Overdue Milestone Aging ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Project Workload" icon={Users}>
          {data.projectOwnerWorkload.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No open project tasks assigned yet</p>
          ) : (
            <HorizBar
              data={data.projectOwnerWorkload.map((w, i) => ({
                label: w.assigneeName,
                value: w.count,
                color: PALETTE[i % PALETTE.length],
              }))}
            />
          )}
        </Section>

        <Section title="Overdue Milestones by Age" icon={Clock}>
          {data.milestoneOverdueAging.d1 + data.milestoneOverdueAging.d7 + data.milestoneOverdueAging.d30 + data.milestoneOverdueAging.d30plus === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No overdue milestones</p>
          ) : (
            <AgingBar aging={data.milestoneOverdueAging} />
          )}
        </Section>
      </div>

      {/* ── Delivery Timeline — all open work (not just overdue), bucketed by due window ── */}
      <Section title="Delivery Timeline" icon={CalendarRange}>
        <BarChart
          data={[
            { label: 'Overdue',  value: data.deliveryBuckets.overdue,  color: '#dc2626' },
            { label: 'Due ≤7d',  value: data.deliveryBuckets.due7,     color: '#d97706' },
            { label: '8–30d',    value: data.deliveryBuckets.due30,    color: 'var(--primary)' },
            { label: '30d+',     value: data.deliveryBuckets.dueLater, color: 'var(--muted-foreground)' },
            { label: 'No date',  value: data.deliveryBuckets.noDate,   color: '#cbd5e1' },
          ]}
        />
      </Section>

      {/* ── Milestones Timeline ── */}
      {data.milestonesTimeline.length > 0 && (
        <Section title="Milestones Timeline" icon={GanttChartSquare}>
          <MilestonesTimeline milestones={data.milestonesTimeline} nowIso={data.nowIso} isAdmin={isAdmin} />
        </Section>
      )}

      {/* ── Load-detection Gantt ── */}
      {data.loadItems.length > 0 && (
        <Section title="Capacity & Load" icon={Layers}>
          <LoadGantt items={data.loadItems} nowIso={data.nowIso} isAdmin={isAdmin} />
        </Section>
      )}

      {/* ── Team Performance — every owner, flat, always visible ── */}
      {data.allOwnerRows.length > 0 && (
        <Section title="Team Performance" icon={Users}>
          <OwnerTable rows={data.allOwnerRows} caption="Owner" />
        </Section>
      )}

      {/* ── Manager Rollup ── */}
      <Section title="Manager Rollup" icon={Users}>
        {data.managerRollups.length === 0 && data.unmanagedOwners.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No projects have been assigned an owner yet.</p>
        ) : (
          <div className="space-y-3">
            {data.managerRollups.length === 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                No project owner has a manager set (Profile → Reports to). Set reporting lines in{' '}
                <Link href="/admin/users" className="text-primary hover:underline">Admin → Users</Link> to see rollups here.
              </div>
            )}
            {data.managerRollups.map((r) => (
              <ManagerRollupPanel key={r.managerId} rollup={r} />
            ))}
            {data.unmanagedOwners.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Project owners with no manager set
                </p>
                <OwnerTable rows={data.unmanagedOwners} caption="Owner" />
              </div>
            )}
          </div>
        )}
      </Section>

    </div>
  )
}
