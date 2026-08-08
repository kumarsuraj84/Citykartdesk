import type { ProjectStats } from '@/lib/queries/projects'

export function ProjectStatsCards({ stats }: { stats: ProjectStats }) {
  const cards: { label: string; value: number; valueCls: string }[] = [
    { label: 'Total',        value: stats.total,      valueCls: 'text-foreground' },
    { label: 'In Progress',  value: stats.inProgress, valueCls: 'text-amber-600 dark:text-amber-400' },
    { label: 'Not Started',  value: stats.notStarted, valueCls: 'text-foreground' },
    { label: 'Blocked',      value: stats.blocked,    valueCls: 'text-red-600 dark:text-red-400' },
    { label: 'Done',         value: stats.done,       valueCls: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Stale > 5d',   value: stats.stale,      valueCls: 'text-red-600 dark:text-red-400' },
  ]

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-border bg-card px-3.5 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</p>
          <p className={`mt-0.5 text-xl font-bold tabular-nums ${c.valueCls}`}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}
