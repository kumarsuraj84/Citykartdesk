'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Loader2, Circle, Clock, CheckCircle2, XCircle, ChevronRight } from 'lucide-react'
import { createTask } from '@/lib/actions/tasks'
import type { TaskWithDetails, TaskStatus } from '@/types'

// ── Status icons ──────────────────────────────────────────────────────────────

const STATUS_ICON: Record<TaskStatus, { Icon: React.ElementType; cls: string }> = {
  open:        { Icon: Circle,       cls: 'text-slate-400' },
  in_progress: { Icon: Clock,        cls: 'text-amber-500' },
  done:        { Icon: CheckCircle2, cls: 'text-emerald-500' },
  cancelled:   { Icon: XCircle,      cls: 'text-slate-400' },
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function AvatarInitial({ name }: { name: string }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['bg-violet-100 text-violet-700', 'bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700']
  return (
    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${colors[name.charCodeAt(0) % colors.length]}`}>
      {initials}
    </span>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface LinkedTasksPanelProps {
  requestId: string
  requestNo: string
  requestTitle: string
  teamId: string
  initialTasks: TaskWithDetails[]
  canManage: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LinkedTasksPanel({
  requestId,
  requestNo,
  requestTitle,
  teamId,
  initialTasks,
  canManage,
}: LinkedTasksPanelProps) {
  const [tasks, setTasks] = useState<TaskWithDetails[]>(initialTasks)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  function handleCreate() {
    if (!title.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await createTask({
        title: title.trim(),
        requestId,
        teamId,
        taskType: 'team',
      })
      if (result.error) {
        setError(result.error)
      } else if (result.data) {
        // Optimistically add to list with minimal shape
        setTasks((prev) => [
          {
            id: result.data!.id,
            title: title.trim(),
            status: 'open',
            priority: 'medium',
            task_type: 'team',
            parent_task_id: null,
            assignee: null,
            assignee_id: null,
            created_by: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            description: null,
            due_date: null,
            completed_at: null,
            request_id: requestId,
            team_id: teamId,
            creator: { id: '', full_name: '' },
            subtask_count: 0,
          } as unknown as TaskWithDetails,
          ...prev,
        ])
        setTitle('')
        setAdding(false)
      }
    })
  }

  const openCount = tasks.filter((t) => t.status === 'open' || t.status === 'in_progress').length

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Linked Tasks</h2>
          {tasks.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {tasks.length}
            </span>
          )}
        </div>
        {canManage && (
          <button
            onClick={() => { setAdding(true); setError(null) }}
            className="btn-ghost"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        )}
      </div>

      {/* Inline create form */}
      {adding && (
        <div className="border-b border-border px-4 py-3 space-y-2">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') { setAdding(false); setTitle(''); setError(null) }
            }}
            placeholder={`Task for ${requestNo}…`}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={isPending || !title.trim()}
              className="btn-gradient"
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {isPending ? 'Creating…' : 'Create Task'}
            </button>
            <button
              onClick={() => { setAdding(false); setTitle(''); setError(null) }}
              className="btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="divide-y divide-border/60">
        {tasks.length === 0 && !adding ? (
          <div className="px-4 py-5 text-center">
            <p className="text-xs text-muted-foreground">No tasks linked to this request.</p>
            {canManage && (
              <button
                onClick={() => setAdding(true)}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Create the first task
              </button>
            )}
          </div>
        ) : (
          tasks.map((task) => {
            const { Icon, cls } = STATUS_ICON[task.status] ?? STATUS_ICON.open
            const isDone = task.status === 'done' || task.status === 'cancelled'
            return (
              <Link
                key={task.id}
                href={`/tasks?task=${task.id}`}
                className="group flex items-start gap-2.5 px-4 py-2.5 hover:bg-muted/40 transition-colors"
              >
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${cls}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-medium leading-snug ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {task.title}
                  </p>
                  {task.assignee && (
                    <div className="mt-1 flex items-center gap-1">
                      <AvatarInitial name={task.assignee.full_name} />
                      <span className="text-[10px] text-muted-foreground">{task.assignee.full_name}</span>
                    </div>
                  )}
                </div>
                <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
              </Link>
            )
          })
        )}
      </div>

      {/* Footer summary */}
      {tasks.length > 0 && (
        <div className="border-t border-border/60 px-4 py-2">
          <p className="text-[10px] text-muted-foreground">
            {openCount > 0 ? `${openCount} open` : 'All tasks complete'}
            {tasks.length > openCount && openCount > 0 && ` · ${tasks.length - openCount} closed`}
          </p>
        </div>
      )}
    </div>
  )
}
