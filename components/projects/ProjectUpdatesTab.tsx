'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Trash2 } from 'lucide-react'
import { createProjectUpdate, deleteProjectUpdate } from '@/lib/actions/projects'
import type { ProjectUpdateWithAuthor } from '@/types'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ProjectUpdatesTab({
  projectId,
  updates,
  currentUserId,
  isManager,
  currentProgressPct,
}: {
  projectId: string
  updates: ProjectUpdateWithAuthor[]
  currentUserId: string
  isManager: boolean
  currentProgressPct: number
}) {
  const router = useRouter()
  const [date, setDate] = useState(todayISO())
  const [text, setText] = useState('')
  const [pct, setPct] = useState(currentProgressPct)
  const [blockers, setBlockers] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    if (!text.trim()) { setError('Write what happened.'); return }
    setError(null)
    startTransition(async () => {
      const result = await createProjectUpdate({
        projectId,
        updateDate: date,
        updateText: text,
        percentComplete: pct,
        blockers: blockers || undefined,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setText('')
        setBlockers('')
        router.refresh()
      }
    })
  }

  function remove(id: string) {
    if (!confirm('Delete this update?')) return
    startTransition(async () => {
      await deleteProjectUpdate(id, projectId)
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {/* ── Post an update ── */}
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Post an update</h3>

        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Update</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Progress made, decisions taken, next steps…"
              className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            % Complete <span className="font-mono text-primary">{pct}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Blockers (optional)</label>
          <input
            type="text"
            value={blockers}
            onChange={(e) => setBlockers(e.target.value)}
            placeholder="Anything holding this up?"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-400">{error}</p>
        )}

        <button
          onClick={submit}
          disabled={isPending || !text.trim()}
          className="btn-gradient disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
          {isPending ? 'Posting…' : 'Post update'}
        </button>
      </div>

      {/* ── Update feed ── */}
      {updates.length === 0 ? (
        <div className="rounded-lg border border-border bg-card py-10 text-center">
          <p className="text-sm font-medium text-foreground">No updates yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Post the first update to start the log for this project.</p>
        </div>
      ) : (
        <ol className="space-y-2.5">
          {updates.map((u) => (
            <li key={u.id} className="rounded-lg border border-border bg-card p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-primary">{fmtDate(u.update_date)}</span>
                <span className="text-xs text-muted-foreground">· {u.author.full_name}</span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-foreground">
                    {u.percent_snapshot}%
                  </span>
                  {(u.author_id === currentUserId || isManager) && (
                    <button
                      onClick={() => remove(u.id)}
                      className="text-muted-foreground/50 hover:text-destructive transition-colors"
                      title="Delete update"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{u.update_text}</p>
              {u.blockers && (
                <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
                  Blocker: {u.blockers}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
