'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, Plus, User, Calendar, Users } from 'lucide-react'
import { createProject } from '@/lib/actions/projects'

interface NewProjectPanelProps {
  profiles: { id: string; full_name: string }[]
  teams: { id: string; name: string }[]
  currentUserId: string
  onCreated?: (id: string) => void
}

export function NewProjectPanel({ profiles, teams, currentUserId, onCreated }: NewProjectPanelProps) {
  const router = useRouter()
  const [open, setOpen]               = useState(false)
  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [ownerId, setOwnerId]         = useState(currentUserId)
  const [teamId, setTeamId]           = useState('')
  const [startDate, setStartDate]     = useState('')
  const [targetDate, setTargetDate]   = useState('')
  const [error, setError]             = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()

  const [openDrop, setOpenDrop] = useState<'owner' | 'team' | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => nameRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); reset() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!openDrop) return
    const onDown = () => setOpenDrop(null)
    setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openDrop])

  function reset() {
    setName(''); setDescription(''); setOwnerId(currentUserId); setTeamId('')
    setStartDate(''); setTargetDate(''); setError(null); setOpenDrop(null)
  }

  function handleClose() { setOpen(false); reset() }

  function handleSubmit() {
    if (!name.trim()) { setError('Project name is required.'); return }
    setError(null)
    startTransition(async () => {
      const result = await createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        ownerId,
        teamId: teamId || undefined,
        startDate: startDate || undefined,
        targetDate: targetDate || undefined,
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

  const currentOwner = profiles.find((p) => p.id === ownerId)
  const currentTeam  = teams.find((t) => t.id === teamId)

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-gradient">
        <Plus className="h-3.5 w-3.5" />
        New Project
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div
              className="relative w-full max-w-[640px] rounded-2xl bg-card shadow-2xl border border-border"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <h2 className="text-sm font-semibold text-foreground">New Project</h2>
                <button
                  onClick={handleClose}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-6 pt-5 pb-4 space-y-4">
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
                  placeholder="Project name…"
                  className="w-full text-base font-medium text-foreground placeholder:text-muted-foreground/50 bg-transparent border-none outline-none"
                />

                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add a description (optional)"
                  rows={3}
                  className="w-full resize-none text-sm text-foreground placeholder:text-muted-foreground/40 bg-transparent border-none outline-none"
                />

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
                  {/* Owner */}
                  <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setOpenDrop(openDrop === 'owner' ? null : 'owner')}
                      className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                    >
                      <User className="h-3 w-3" />
                      {currentOwner?.full_name ?? 'Owner'}
                    </button>
                    {openDrop === 'owner' && (
                      <div className="absolute left-0 top-full z-50 mt-1 w-44 max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-lg py-1">
                        {profiles.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => { setOwnerId(p.id); setOpenDrop(null) }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 ${p.id === ownerId ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                          >
                            {p.full_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Team */}
                  <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setOpenDrop(openDrop === 'team' ? null : 'team')}
                      className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                    >
                      <Users className="h-3 w-3" />
                      {currentTeam?.name ?? 'No team'}
                    </button>
                    {openDrop === 'team' && (
                      <div className="absolute left-0 top-full z-50 mt-1 w-44 max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-lg py-1">
                        <button
                          onClick={() => { setTeamId(''); setOpenDrop(null) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
                        >
                          No team
                        </button>
                        {teams.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => { setTeamId(t.id); setOpenDrop(null) }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 ${t.id === teamId ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                          >
                            {t.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Start date */}
                  <label className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    Start
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bg-transparent text-xs text-foreground outline-none"
                    />
                  </label>

                  {/* Target date */}
                  <label className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    Target
                    <input
                      type="date"
                      value={targetDate}
                      onChange={(e) => setTargetDate(e.target.value)}
                      className="bg-transparent text-xs text-foreground outline-none"
                    />
                  </label>
                </div>

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-400">{error}</p>
                )}
              </div>

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
                    disabled={isPending || !name.trim()}
                    className="btn-gradient disabled:opacity-40"
                  >
                    {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {isPending ? 'Creating…' : 'Create Project'}
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
