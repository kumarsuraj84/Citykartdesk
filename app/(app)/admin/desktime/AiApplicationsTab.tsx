'use client'

import { useState, useTransition } from 'react'
import { Bot, Plus, Trash2 } from 'lucide-react'
import { addAiApplication, toggleAiApplication, removeAiApplication } from '@/lib/actions/admin/desktime'
import type { AiApplication } from '@/lib/queries/desktime'

export function AiApplicationsTab({ apps, isAdmin }: { apps: AiApplication[]; isAdmin: boolean }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await addAiApplication(name.trim())
      if (result.error) { setError(result.error); return }
      setName('')
    })
  }

  function handleToggle(id: string, isActive: boolean) {
    startTransition(async () => {
      const result = await toggleAiApplication(id, isActive)
      if (result.error) setError(result.error)
    })
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      const result = await removeAiApplication(id)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">AI applications</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Any tracked application whose name contains one of these words counts as AI hours. Keep this list updated as new tools are adopted.
      </p>

      {isAdmin && (
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Cursor"
            className="max-w-xs rounded-lg border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button type="submit" disabled={isPending || !name.trim()} className="btn-gradient disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </form>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {apps.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No AI applications configured yet.</li>}
        {apps.map((app) => (
          <li key={app.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className={app.is_active ? 'text-sm text-foreground' : 'text-sm text-muted-foreground line-through'}>{app.name}</span>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={app.is_active}
                disabled={!isAdmin || isPending}
                onChange={(e) => handleToggle(app.id, e.target.checked)}
                className="rounded"
              />
              {isAdmin && (
                <button
                  onClick={() => handleRemove(app.id)}
                  disabled={isPending}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-red-600 transition-colors disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
