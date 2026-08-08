'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, Plus } from 'lucide-react'
import { createMilestone } from '@/lib/actions/projects'

export function NewMilestonePanel({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [open, setOpen]           = useState(false)
  const [name, setName]           = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [error, setError]         = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => nameRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function reset() {
    setName(''); setStartDate(''); setEndDate(''); setError(null)
  }

  function handleClose() { setOpen(false); reset() }

  function handleSubmit() {
    if (!name.trim()) { setError('Enhancement name is required.'); return }
    if (!startDate || !endDate) { setError('Start and end dates are required.'); return }
    setError(null)
    startTransition(async () => {
      const result = await createMilestone({ projectId, name: name.trim(), startDate, endDate })
      if (result.error) {
        setError(result.error)
      } else {
        reset()
        setOpen(false)
        router.refresh()
      }
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Enhancement
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div
              className="relative w-full max-w-[440px] rounded-2xl bg-card shadow-2xl border border-border"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                <h2 className="text-sm font-semibold text-foreground">New Enhancement</h2>
                <button
                  onClick={handleClose}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-3">
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
                  placeholder="Enhancement name…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="flex items-center gap-2">
                  <label className="flex-1 space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Start</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </label>
                  <label className="flex-1 space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">End</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </label>
                </div>

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-400">{error}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isPending || !name.trim()}
                  className="btn-gradient disabled:opacity-40"
                >
                  {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isPending ? 'Creating…' : 'Create Enhancement'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
