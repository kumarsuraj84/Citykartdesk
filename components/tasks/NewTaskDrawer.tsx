'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, Plus } from 'lucide-react'
import { createTask } from '@/lib/actions/tasks'
import type { TaskPriority } from '@/types'

interface NewTaskDrawerProps {
  profiles: { id: string; full_name: string }[]
  onCreated?: (id: string) => void
}

export function NewTaskDrawer({ profiles, onCreated }: NewTaskDrawerProps) {
  const router = useRouter()
  const [open, setOpen]             = useState(false)
  const [title, setTitle]           = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority]     = useState<TaskPriority>('medium')
  const [dueDate, setDueDate]       = useState('')
  const [error, setError]           = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function reset() {
    setTitle('')
    setDescription('')
    setAssigneeId('')
    setPriority('medium')
    setDueDate('')
    setError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required.'); return }
    setError(null)
    startTransition(async () => {
      const result = await createTask({
        title,
        description: description || undefined,
        assigneeId: assigneeId || undefined,
        priority,
        dueDate: dueDate || undefined,
        taskType: 'personal',
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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-gradient"
      >
        <Plus className="h-3.5 w-3.5" />
        New Task
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">New Task</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add more context…"
              rows={4}
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* Assignee */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Assignee</label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Unassigned</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          {/* Due date */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}

          <div className="mt-auto flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !title.trim()}
              className="btn-gradient disabled:opacity-40"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {isPending ? 'Creating…' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
