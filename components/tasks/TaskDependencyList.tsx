'use client'

import { useState, useTransition } from 'react'
import { Link2, X, Plus, Search, ArrowRight } from 'lucide-react'
import { addTaskDependency, removeTaskDependency } from '@/lib/actions/tasks'
import type { TaskDependency } from '@/lib/queries/tasks'

interface TaskDependencyListProps {
  taskId: string
  initialBlockedBy: TaskDependency[]
  initialBlocking: TaskDependency[]
}

export function TaskDependencyList({ taskId, initialBlockedBy, initialBlocking }: TaskDependencyListProps) {
  const [blockedBy, setBlockedBy] = useState(initialBlockedBy)
  const [adding, setAdding]       = useState(false)
  const [query, setQuery]         = useState('')
  const [error, setError]         = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleRemove(depId: string) {
    startTransition(async () => {
      const res = await removeTaskDependency(depId)
      if (res?.error) { setError(res.error); return }
      setBlockedBy((prev) => prev.filter((d) => d.id !== depId))
    })
  }

  function handleAdd() {
    if (!query.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await addTaskDependency(taskId, query.trim())
      if (res?.error) { setError(res.error); return }
      if (res?.data) {
        setBlockedBy((prev) => [...prev, res.data!])
        setQuery('')
        setAdding(false)
      }
    })
  }

  if (blockedBy.length === 0 && initialBlocking.length === 0 && !adding) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">No dependencies</span>
        <button onClick={() => { setAdding(true); setError(null) }} className="btn-ghost">
          <Plus className="h-3 w-3" /> Add blocker
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Link2 className="h-3.5 w-3.5 text-muted-foreground" /> Blocked by
        </span>
        {!adding && (
          <button onClick={() => { setAdding(true); setError(null) }} className="btn-ghost">
            <Plus className="h-3 w-3" /> Add
          </button>
        )}
      </div>

      {blockedBy.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">Not blocked by anything</p>
      )}

      {blockedBy.map((d) => (
        <div key={d.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${d.status === 'done' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{d.title}</span>
          <button onClick={() => handleRemove(d.id)} disabled={isPending} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {adding && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="Task title…"
              className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={isPending || !query.trim()} className="btn-gradient">
              {isPending ? 'Linking…' : 'Link'}
            </button>
            <button onClick={() => { setAdding(false); setQuery(''); setError(null) }} className="btn-soft">
              Cancel
            </button>
          </div>
        </div>
      )}

      {initialBlocking.length > 0 && (
        <div className="pt-1 space-y-1.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /> Blocking
          </span>
          {initialBlocking.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${d.status === 'done' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{d.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
