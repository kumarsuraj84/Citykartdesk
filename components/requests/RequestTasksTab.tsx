'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  Circle, Clock, CheckCircle2, XCircle, Plus, Loader2,
  User, CalendarDays, Flag, ChevronRight,
} from 'lucide-react'
import { createTask } from '@/lib/actions/tasks'
import type { TaskWithDetails, TaskStatus, TaskPriority } from '@/types'

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TaskStatus, { Icon: React.ElementType; cls: string; label: string }> = {
  open:        { Icon: Circle,       cls: 'text-slate-400',   label: 'Open' },
  in_progress: { Icon: Clock,        cls: 'text-amber-500',   label: 'In Progress' },
  done:        { Icon: CheckCircle2, cls: 'text-emerald-500', label: 'Done' },
  cancelled:   { Icon: XCircle,      cls: 'text-slate-300',   label: 'Cancelled' },
}

const PRIORITY_STYLES: Record<string, string> = {
  low:    'text-slate-400',
  medium: 'text-blue-500',
  high:   'text-orange-500',
  urgent: 'text-red-500',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['bg-violet-100 text-violet-700','bg-blue-100 text-blue-700','bg-emerald-100 text-emerald-700','bg-amber-100 text-amber-700','bg-rose-100 text-rose-700']
  return (
    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${colors[name.charCodeAt(0) % colors.length]}`}>
      {initials}
    </span>
  )
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  if (total === 0) return null
  const pct = Math.round((done / total) * 100)
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {done}/{total}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface RequestTasksTabProps {
  requestId: string
  requestNo: string
  requestTitle: string
  teamId: string
  initialTasks: TaskWithDetails[]
  canManage: boolean
  /** Tasks is Admin/Owner-only for now — everyone else can see this summary
   * but the row shouldn't link to /tasks, which would redirect them to /home. */
  canOpenTask: boolean
}

export function RequestTasksTab({
  requestId,
  teamId,
  initialTasks,
  canManage,
  canOpenTask,
}: RequestTasksTabProps) {
  const [tasks, setTasks] = useState<TaskWithDetails[]>(initialTasks)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const doneTasks   = tasks.filter((t) => t.status === 'done').length
  const activeTasks = tasks.filter((t) => t.status !== 'cancelled')

  function handleCreate() {
    if (!title.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await createTask({
        title: title.trim(),
        teamId,
        requestId,
      })
      if (result.error) { setError(result.error); return }
      // Optimistic add
      setTasks((prev) => [
        ...prev,
        {
          id: result.data!.id,
          title: title.trim(),
          status: 'open' as TaskStatus,
          priority: 'medium' as TaskPriority,
          due_date: null,
          assignee_id: null,
          assignee: null,
          creator: null,
          created_by: '',
          team_id: teamId,
          request_id: requestId,
          task_type: 'team',
          description: null,
          parent_task_id: null,
          completed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          subtask_count: 0,
        } as unknown as TaskWithDetails,
      ])
      setTitle('')
      setShowForm(false)
    })
  }

  return (
    <div className="space-y-4 p-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Tasks
            </h3>
            {tasks.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {tasks.length}
              </span>
            )}
          </div>
          {activeTasks.length > 0 && (
            <ProgressBar done={doneTasks} total={activeTasks.length} />
          )}
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Task
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') { setShowForm(false); setTitle('') }
            }}
            placeholder="Task title…"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={isPending || !title.trim()}
              className="btn-gradient"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Create
            </button>
            <button
              onClick={() => { setShowForm(false); setTitle('') }}
              className="btn-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      {tasks.length === 0 ? (
        <div className="py-10 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">No tasks linked</p>
          {canManage && (
            <p className="mt-1 text-xs text-muted-foreground/60">
              Create a task to track work items for this request.
            </p>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
          {tasks.map((task) => {
            const cfg = STATUS_CONFIG[task.status]
            const isDone = task.status === 'done'
            const rowContent = (
              <>
                {/* Status icon */}
                <cfg.Icon className={`h-4 w-4 shrink-0 ${cfg.cls}`} />

                {/* Title */}
                <span className={`flex-1 text-sm font-medium truncate ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {task.title}
                </span>

                {/* Meta */}
                <div className="flex items-center gap-3 shrink-0">
                  {task.priority && (
                    <Flag className={`h-3.5 w-3.5 ${PRIORITY_STYLES[task.priority] ?? 'text-muted-foreground'}`} />
                  )}
                  {task.due_date && (
                    <span className={`flex items-center gap-1 text-[11px] tabular-nums ${new Date(task.due_date) < new Date() && !isDone ? 'text-red-500' : 'text-muted-foreground'}`}>
                      <CalendarDays className="h-3 w-3" />
                      {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  {task.assignee ? (
                    <Avatar name={task.assignee.full_name} />
                  ) : (
                    <User className="h-3.5 w-3.5 text-muted-foreground/40" />
                  )}
                  {canOpenTask && (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
              </>
            )
            // Tasks is Admin/Owner-only for now — for everyone else, /tasks
            // redirects to /home, so this row is a read-only summary instead
            // of a dead-end link.
            return canOpenTask ? (
              <Link
                key={task.id}
                href={`/tasks?task=${task.id}`}
                className="flex items-center gap-3 bg-card px-4 py-3 hover:bg-muted/30 transition-colors group"
              >
                {rowContent}
              </Link>
            ) : (
              <div key={task.id} className="flex items-center gap-3 bg-card px-4 py-3">
                {rowContent}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer summary */}
      {tasks.length > 0 && (
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-1">
          {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
            const count = tasks.filter((t) => t.status === status).length
            if (count === 0) return null
            return (
              <span key={status} className="flex items-center gap-1">
                <cfg.Icon className={`h-3 w-3 ${cfg.cls}`} />
                {count} {cfg.label}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
