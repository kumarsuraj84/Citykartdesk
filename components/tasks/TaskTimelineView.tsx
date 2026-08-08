'use client'

import type { TaskWithDetails, TaskStatus } from '@/types'

interface TaskTimelineViewProps {
  tasks: TaskWithDetails[]
  onTaskClick: (id: string) => void
}

const STATUS_BAR_CLASS: Record<TaskStatus, string> = {
  open:        'bg-blue-400',
  in_progress: 'bg-amber-400',
  done:        'bg-emerald-400',
  cancelled:   'bg-slate-400',
}

const MS_DAY = 24 * 60 * 60 * 1000

function toDate(iso: string): Date {
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''))
}

function fmt(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function TaskTimelineView({ tasks, onTaskClick }: TaskTimelineViewProps) {
  const dated = tasks.filter((t) => t.start_date || t.due_date)

  if (dated.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-16 text-center">
        <p className="text-sm font-semibold text-foreground">No dated tasks</p>
        <p className="text-xs text-muted-foreground">Set a start or due date on a task to see it here.</p>
      </div>
    )
  }

  // ── Compute the date range the timeline spans, with a little padding ──────
  let min = Infinity
  let max = -Infinity
  for (const t of dated) {
    const start = t.start_date ? toDate(t.start_date).getTime() : null
    const end   = t.due_date   ? toDate(t.due_date).getTime()   : start
    const s = start ?? end!
    const e = end ?? start!
    if (s < min) min = s
    if (e > max) max = e
  }
  min -= MS_DAY
  max += MS_DAY
  const totalMs = Math.max(max - min, MS_DAY)

  const sorted = [...dated].sort((a, b) => {
    const av = a.start_date ? toDate(a.start_date).getTime() : toDate(a.due_date!).getTime()
    const bv = b.start_date ? toDate(b.start_date).getTime() : toDate(b.due_date!).getTime()
    return av - bv
  })

  // Week gridlines across the range, for a bit of visual scale.
  const gridlines: Date[] = []
  for (let t = min; t <= max; t += 7 * MS_DAY) gridlines.push(new Date(t))

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span>{fmt(new Date(min))}</span>
        <span>{fmt(new Date(max))}</span>
      </div>
      <div className="relative divide-y divide-border">
        {/* Gridlines */}
        <div className="pointer-events-none absolute inset-0 flex">
          {gridlines.map((d, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 border-l border-border/50"
              style={{ left: `${((d.getTime() - min) / totalMs) * 100}%` }}
            />
          ))}
        </div>

        {sorted.map((t) => {
          const startMs = t.start_date ? toDate(t.start_date).getTime() : toDate(t.due_date!).getTime()
          const endMs   = t.due_date   ? toDate(t.due_date).getTime()   : startMs
          const left    = ((startMs - min) / totalMs) * 100
          const width   = Math.max(((Math.max(endMs, startMs) - startMs) / totalMs) * 100, 1.2)

          return (
            <button
              key={t.id}
              onClick={() => onTaskClick(t.id)}
              className="relative flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
            >
              <span className="w-40 shrink-0 truncate text-xs font-medium text-foreground">{t.title}</span>
              <span className="relative h-2 flex-1">
                <span
                  className={`absolute top-0 h-2 rounded-full ${STATUS_BAR_CLASS[t.status]}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${t.start_date ? fmt(toDate(t.start_date)) : fmt(toDate(t.due_date!))} → ${t.due_date ? fmt(toDate(t.due_date)) : fmt(toDate(t.start_date!))}`}
                />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
