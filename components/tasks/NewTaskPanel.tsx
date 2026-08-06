'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, Plus, User, Calendar, Flag } from 'lucide-react'
import { createTask } from '@/lib/actions/tasks'
import type { TaskPriority, TaskStatus, TaskType } from '@/types'

interface NewTaskPanelProps {
  profiles: { id: string; full_name: string }[]
  onCreated?: (id: string) => void
}

const STATUS_OPTIONS: { value: TaskStatus; label: string; cls: string }[] = [
  { value: 'open',        label: 'TO DO',       cls: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300' },
  { value: 'in_progress', label: 'IN PROGRESS',  cls: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400' },
  { value: 'done',        label: 'DONE',         cls: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400' },
]

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; flagCls: string }[] = [
  { value: 'high',   label: 'High',   flagCls: 'text-red-500' },
  { value: 'medium', label: 'Medium', flagCls: 'text-amber-500' },
  { value: 'low',    label: 'Low',    flagCls: 'text-slate-400' },
]

export function NewTaskPanel({ profiles, onCreated }: NewTaskPanelProps) {
  const router = useRouter()
  const [open, setOpen]               = useState(false)
  const [title, setTitle]             = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId]   = useState('')
  const [priority, setPriority]       = useState<TaskPriority>('medium')
  const [status, setStatus]           = useState<TaskStatus>('open')
  const [taskType, setTaskType]       = useState<TaskType>('personal')
  const [dueDate, setDueDate]         = useState('')
  const [error, setError]             = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()

  const [openDrop, setOpenDrop] = useState<'status' | 'assignee' | 'priority' | 'due' | null>(null)

  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => titleRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); reset() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // close dropdowns on outside click
  useEffect(() => {
    if (!openDrop) return
    const onDown = () => setOpenDrop(null)
    setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openDrop])

  function reset() {
    setTitle(''); setDescription(''); setAssigneeId('')
    setPriority('medium'); setStatus('open'); setTaskType('personal')
    setDueDate(''); setError(null); setOpenDrop(null)
  }

  function handleClose() { setOpen(false); reset() }

  function handleSubmit() {
    if (!title.trim()) { setError('Task name is required.'); return }
    setError(null)
    startTransition(async () => {
      const result = await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        assigneeId: assigneeId || undefined,
        priority,
        status,
        dueDate: dueDate || undefined,
        taskType,
      })
      if (result.error) {
        setError(result.error)
      } else {
        reset()
        setOpen(false)
        router.refresh()
        if (result.data && onCreated) onCreated(result.data.id)
      }
    })
  }

  const currentStatus   = STATUS_OPTIONS.find((s) => s.value === status)!
  const currentPriority = PRIORITY_OPTIONS.find((p) => p.value === priority)!
  const currentAssignee = profiles.find((p) => p.id === assigneeId)
  const dueDateLabel    = dueDate
    ? new Date(dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'Due date'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-gradient"
      >
        <Plus className="h-3.5 w-3.5" />
        New Task
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

          {/* Modal — wider, centered */}
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div
              className="relative w-full max-w-[640px] rounded-2xl bg-card shadow-2xl border border-border"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <h2 className="text-sm font-semibold text-foreground">New Task</h2>
                <button
                  onClick={handleClose}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Form body */}
              <div className="px-6 pt-5 pb-4 space-y-4">
                {/* Title */}
                <input
                  ref={titleRef}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
                  placeholder="Task name…"
                  className="w-full text-base font-medium text-foreground placeholder:text-muted-foreground/50 bg-transparent border-none outline-none"
                />

                {/* Description */}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add a description (optional)"
                  rows={3}
                  className="w-full resize-none text-sm text-foreground placeholder:text-muted-foreground/40 bg-transparent border-none outline-none"
                />

                {/* Chips row */}
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
                  {/* Status */}
                  <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setOpenDrop(openDrop === 'status' ? null : 'status')}
                      className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-bold tracking-wide transition-colors ${currentStatus.cls}`}
                    >
                      {currentStatus.label}
                    </button>
                    {openDrop === 'status' && (
                      <div className="absolute left-0 top-full z-50 mt-1 w-36 rounded-xl border border-border bg-card shadow-lg py-1">
                        {STATUS_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => { setStatus(opt.value); setOpenDrop(null) }}
                            className={`w-full flex items-center px-3 py-1.5 text-[11px] font-bold tracking-wide hover:bg-muted/50 ${opt.value === status ? 'opacity-100' : 'opacity-70'}`}
                          >
                            <span className={`rounded border px-1.5 py-0.5 ${opt.cls}`}>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Assignee */}
                  <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setOpenDrop(openDrop === 'assignee' ? null : 'assignee')}
                      className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                    >
                      <User className="h-3 w-3" />
                      {currentAssignee?.full_name ?? 'Assignee'}
                    </button>
                    {openDrop === 'assignee' && (
                      <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-xl border border-border bg-card shadow-lg py-1">
                        <button
                          onClick={() => { setAssigneeId(''); setOpenDrop(null) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
                        >
                          Unassigned
                        </button>
                        {profiles.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => { setAssigneeId(p.id); setOpenDrop(null) }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 ${p.id === assigneeId ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                          >
                            {p.full_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Due date */}
                  <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setOpenDrop(openDrop === 'due' ? null : 'due')}
                      className={`flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs transition-colors ${dueDate ? 'text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
                    >
                      <Calendar className="h-3 w-3" />
                      {dueDateLabel}
                    </button>
                    {openDrop === 'due' && (
                      <div className="absolute left-0 top-full z-50 mt-1 rounded-xl border border-border bg-card shadow-lg p-3">
                        <input
                          type="date"
                          value={dueDate}
                          onChange={(e) => { setDueDate(e.target.value); setOpenDrop(null) }}
                          className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          autoFocus
                        />
                      </div>
                    )}
                  </div>

                  {/* Priority */}
                  <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setOpenDrop(openDrop === 'priority' ? null : 'priority')}
                      className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                    >
                      <Flag className={`h-3 w-3 ${priority !== 'medium' ? currentPriority.flagCls : ''}`} />
                      {priority !== 'medium' ? currentPriority.label : 'Priority'}
                    </button>
                    {openDrop === 'priority' && (
                      <div className="absolute left-0 top-full z-50 mt-1 w-32 rounded-xl border border-border bg-card shadow-lg py-1">
                        {PRIORITY_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => { setPriority(opt.value); setOpenDrop(null) }}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 ${opt.value === priority ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                          >
                            <Flag className={`h-3 w-3 ${opt.flagCls}`} />
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Task type toggle (subtle) */}
                  <select
                    value={taskType}
                    onChange={(e) => setTaskType(e.target.value as TaskType)}
                    className="rounded border border-border bg-transparent px-2 py-0.5 text-xs text-muted-foreground focus:outline-none focus:ring-0 cursor-pointer"
                  >
                    <option value="personal">Personal</option>
                    <option value="team">Team</option>
                  </select>
                </div>

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-400">{error}</p>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-border px-6 py-4">
                <p className="text-xs text-muted-foreground">Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to submit</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={isPending || !title.trim()}
                    className="btn-gradient disabled:opacity-40"
                  >
                    {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {isPending ? 'Creating…' : 'Create Task'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
