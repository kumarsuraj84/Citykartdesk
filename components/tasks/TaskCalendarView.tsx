'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TaskWithDetails, TaskPriority } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskCalendarViewProps {
  tasks: TaskWithDetails[]
  onTaskClick: (id: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function priorityChipClass(priority: TaskPriority): string {
  switch (priority) {
    case 'high':   return 'bg-red-100 text-red-700 border-red-200'
    case 'medium': return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'low':    return 'bg-slate-100 text-slate-600 border-slate-200'
  }
}

/** Returns ISO date string yyyy-mm-dd for a Date in local time */
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Return the Monday-based day grid for a given year+month.
 *  Returns an array of 5–6 weeks, each 7 days (Mon=0 … Sun=6).
 */
function buildCalendarGrid(year: number, month: number): (Date | null)[][] {
  // month is 0-indexed
  const firstDay = new Date(year, month, 1)
  // Monday=0, …, Sunday=6
  const startOffset = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const days: (Date | null)[] = []
  // leading empty cells
  for (let i = 0; i < startOffset; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d))
  // trailing empty cells to fill last row
  while (days.length % 7 !== 0) days.push(null)

  const weeks: (Date | null)[][] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }
  return weeks
}

// ── Task chip ─────────────────────────────────────────────────────────────────

function TaskChip({
  task,
  onClick,
  faded,
}: {
  task: TaskWithDetails
  onClick: () => void
  faded?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full truncate rounded border px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight transition-opacity hover:opacity-80 ${
        faded
          ? 'border-border bg-muted text-muted-foreground cursor-default'
          : priorityChipClass(task.priority)
      }`}
      title={task.title}
      disabled={faded}
    >
      {task.title}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TaskCalendarView({ tasks, onTaskClick }: TaskCalendarViewProps) {
  const today = new Date()
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())

  function toggleDayExpanded(dateStr: string) {
    setExpandedDays(prev => {
      const next = new Set(prev)
      next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr)
      return next
    })
  }

  const todayStr = toLocalDateStr(today)

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }
  function goToday() {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
  }

  // Build a map: dateStr → tasks
  const tasksByDate = tasks.reduce<Record<string, TaskWithDetails[]>>((acc, task) => {
    if (!task.due_date) return acc
    const key = task.due_date.slice(0, 10) // yyyy-mm-dd
    if (!acc[key]) acc[key] = []
    acc[key].push(task)
    return acc
  }, {})

  const unscheduled = tasks.filter((t) => !t.due_date)

  // Overdue: has due_date, not done/cancelled, past today
  const overdueTasks = tasks.filter(
    (t) =>
      t.due_date &&
      t.status !== 'done' &&
      t.status !== 'cancelled' &&
      t.due_date.slice(0, 10) < todayStr
  )

  const weeks = buildCalendarGrid(year, month)

  // Determine if a date is in the current month
  function isCurrentMonth(d: Date) {
    return d.getFullYear() === year && d.getMonth() === month
  }

  return (
    <div className="flex gap-4">
      {/* ── Main calendar ── */}
      <div className="flex-1 overflow-hidden rounded-xl border border-border bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={prevMonth}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-sm font-semibold text-foreground min-w-[130px] text-center">
              {MONTH_NAMES[month]} {year}
            </h2>
            <button
              onClick={nextMonth}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={goToday}
            className="btn-soft"
          >
            Today
          </button>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-border bg-muted/30">
          {WEEKDAYS.map((day) => (
            <div key={day} className="py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {day}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div>
          {weeks.map((week, wi) => (
            <div key={wi} className={`grid grid-cols-7 ${wi < weeks.length - 1 ? 'border-b border-border' : ''}`}>
              {week.map((day, di) => {
                if (!day) {
                  return (
                    <div
                      key={di}
                      className={`min-h-[100px] bg-muted/10 p-1.5 ${di < 6 ? 'border-r border-border' : ''}`}
                    />
                  )
                }

                const dateStr = toLocalDateStr(day)
                const isToday = dateStr === todayStr
                const inMonth = isCurrentMonth(day)
                const dayTasks = tasksByDate[dateStr] ?? []

                return (
                  <div
                    key={di}
                    className={`min-h-[100px] p-1.5 ${di < 6 ? 'border-r border-border' : ''} ${
                      !inMonth ? 'bg-muted/20' : ''
                    }`}
                  >
                    {/* Date number */}
                    <div className="mb-1 flex justify-end">
                      <span
                        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium ${
                          isToday
                            ? 'bg-primary text-primary-foreground'
                            : inMonth
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {day.getDate()}
                      </span>
                    </div>

                    {/* Task chips */}
                    <div className="flex flex-col gap-0.5">
                      {(expandedDays.has(dateStr) ? dayTasks : dayTasks.slice(0, 3)).map((task) => (
                        <TaskChip
                          key={task.id}
                          task={task}
                          onClick={() => onTaskClick(task.id)}
                          faded={!inMonth}
                        />
                      ))}
                      {dayTasks.length > 3 && !expandedDays.has(dateStr) && (
                        <button
                          onClick={() => toggleDayExpanded(dateStr)}
                          className="px-1 text-[9px] text-muted-foreground hover:text-foreground text-left transition-colors"
                        >
                          +{dayTasks.length - 3} more
                        </button>
                      )}
                      {dayTasks.length > 3 && expandedDays.has(dateStr) && (
                        <button
                          onClick={() => toggleDayExpanded(dateStr)}
                          className="px-1 text-[9px] text-muted-foreground hover:text-foreground text-left transition-colors"
                        >
                          Show less
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right sidebar ── */}
      <div className="flex w-56 shrink-0 flex-col gap-3">
        {/* Overdue */}
        {overdueTasks.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="mb-2 text-xs font-semibold text-red-700">
              Overdue ({overdueTasks.length})
            </p>
            <div className="flex flex-col gap-1">
              {overdueTasks.slice(0, 5).map((task) => (
                <button
                  key={task.id}
                  onClick={() => onTaskClick(task.id)}
                  className="truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium text-red-700 hover:bg-red-100 transition-colors"
                  title={task.title}
                >
                  {task.title}
                </button>
              ))}
              {overdueTasks.length > 5 && (
                <span className="px-1.5 text-[9px] text-red-500">+{overdueTasks.length - 5} more</span>
              )}
            </div>
          </div>
        )}

        {/* Unscheduled */}
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">
            Unscheduled ({unscheduled.length})
          </p>
          {unscheduled.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">No unscheduled tasks</p>
          ) : (
            <div className="flex flex-col gap-1">
              {unscheduled.map((task) => (
                <button
                  key={task.id}
                  onClick={() => onTaskClick(task.id)}
                  className={`truncate rounded border px-1.5 py-0.5 text-left text-[10px] font-medium hover:opacity-80 transition-opacity ${priorityChipClass(task.priority)}`}
                  title={task.title}
                >
                  {task.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
