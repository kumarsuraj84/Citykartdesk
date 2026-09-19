'use client'

import { useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, X, Loader2 } from 'lucide-react'
import { listPasswordResetTargets, resetPasswordsBatch } from '@/lib/actions/admin/users'
import { BULK_RESET_BATCH_SIZE, chunk } from '@/lib/users/bulk-reset'

type Failure = { id: string; name?: string; error: string }
type Phase = 'form' | 'running' | 'done'

const CONFIRM_WORD = 'RESET'

export function BulkPasswordResetDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('form')
  const [ids, setIds] = useState<string[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [typed, setTyped] = useState('')
  const [progress, setProgress] = useState(0)
  const [succeeded, setSucceeded] = useState(0)
  const [failures, setFailures] = useState<Failure[]>([])
  const [fatal, setFatal] = useState<string | null>(null)

  // Hydration-safe: false on the server, the real value in the browser.
  const plainHttp = useSyncExternalStore(
    () => () => {},
    () => window.location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(window.location.hostname),
    () => false
  )

  async function openDialog() {
    setOpen(true)
    setPhase('form')
    setIds(null)
    setLoadError(null)
    setPassword('')
    setRepeat('')
    setTyped('')
    setProgress(0)
    setSucceeded(0)
    setFailures([])
    setFatal(null)
    const r = await listPasswordResetTargets()
    if (r.error) setLoadError(r.error)
    else setIds(r.ids ?? [])
  }

  function close() {
    if (phase === 'running') return
    setOpen(false)
    if (phase === 'done') router.refresh()
  }

  const total = ids?.length ?? 0
  const passwordError =
    password.length > 0 && password.length < 8 ? 'At least 8 characters.' : repeat.length > 0 && repeat !== password ? 'The two passwords don’t match.' : null
  const canStart = phase === 'form' && total > 0 && password.length >= 8 && repeat === password && typed.trim().toUpperCase() === CONFIRM_WORD

  async function start() {
    if (!ids || !canStart) return
    setPhase('running')
    setProgress(0)
    setSucceeded(0)
    setFailures([])
    setFatal(null)

    let ok = 0
    const failed: Failure[] = []
    for (const batch of chunk(ids, BULK_RESET_BATCH_SIZE)) {
      const r = await resetPasswordsBatch(batch, password)
      if (r.error) {
        setFatal(r.error)
        break
      }
      ok += r.succeeded ?? 0
      failed.push(...(r.failed ?? []))
      setSucceeded(ok)
      setFailures([...failed])
      setProgress((p) => p + batch.length)
    }
    setPassword('')
    setRepeat('')
    setPhase('done')
  }

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0

  return (
    <>
      <button onClick={openDialog} className="btn-glossy-light btn-glossy-light-hover">
        <KeyRound className="h-3.5 w-3.5" />
        Reset all passwords
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-base font-semibold text-foreground">Reset all passwords</h2>
              <button onClick={close} disabled={phase === 'running'} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-3 text-sm">
              {loadError && <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{loadError}</p>}

              {phase === 'form' && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {ids === null && !loadError ? (
                      'Checking who is affected…'
                    ) : (
                      <>
                        This sets one temporary password on <strong className="text-foreground">{total} active {total === 1 ? 'user' : 'users'}</strong>{' '}
                        (users, agents and managers). <strong className="text-foreground">Admins and platform owners, including you, are not changed.</strong>{' '}
                        Each person must then choose their own new password the next time they open the portal — signed-in people
                        are asked on their next page load.
                      </>
                    )}
                  </p>

                  <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    Until each person changes it, anyone who knows this temporary password can sign in as them. Share it privately
                    and only with the people concerned.
                  </p>
                  {plainHttp && (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                      This page isn’t using HTTPS, so what you type here travels unencrypted. Do this from inside the office network
                      (the server’s local address), not over the public internet.
                    </p>
                  )}

                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Temporary password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Repeat it</span>
                    <input
                      type="password"
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value)}
                      autoComplete="new-password"
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </label>
                  {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      Type <span className="font-mono text-foreground">{CONFIRM_WORD}</span> to confirm
                    </span>
                    <input
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      autoComplete="off"
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </label>

                  <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                    <button onClick={close} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">
                      Cancel
                    </button>
                    <button onClick={start} disabled={!canStart} className="btn-gradient px-3 py-1.5 text-xs disabled:opacity-50">
                      Reset {total} {total === 1 ? 'password' : 'passwords'}
                    </button>
                  </div>
                </>
              )}

              {phase === 'running' && (
                <div className="space-y-2 py-2">
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Resetting… {progress} of {total}. Please keep this window open.
                  </p>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: pct + '%' }} />
                  </div>
                </div>
              )}

              {phase === 'done' && (
                <div className="space-y-3">
                  {fatal && <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">Stopped early: {fatal}</p>}
                  <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Done — <strong>{succeeded}</strong> {succeeded === 1 ? 'password was' : 'passwords were'} reset. Each person will be
                    asked to choose their own password at next login.
                  </p>
                  {failures.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-destructive">{failures.length} could not be reset:</p>
                      <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-muted-foreground">
                        {failures.map((f) => (
                          <li key={f.id}>{f.name ?? f.id} — {f.error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex justify-end border-t border-border pt-3">
                    <button onClick={close} className="btn-gradient px-3 py-1.5 text-xs">Close</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
