'use client'

import { useState, useSyncExternalStore } from 'react'
import { safely } from '@/lib/ui/safeAction'
import { ModalFrame } from '@/components/ui/ModalFrame'
import { useRouter } from 'next/navigation'
import { KeyRound, X, Loader2, Download } from 'lucide-react'
import { listPasswordResetTargets, resetPasswordsBatch, type BulkCredential } from '@/lib/actions/admin/users'
import { BULK_RESET_BATCH_SIZE, chunk, type BulkResetMode } from '@/lib/users/bulk-reset'
import { PASSWORD_RULE_TEXT, validateNewPassword } from '@/lib/security/password-policy'
import { toCSV, downloadCSV } from '@/lib/export/csv'

type Failure = { id: string; name?: string; error: string }
type Phase = 'form' | 'running' | 'done'

const CONFIRM_WORD = 'RESET'

export function BulkPasswordResetDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('form')
  const [ids, setIds] = useState<string[] | null>(null)
  const [adminCount, setAdminCount] = useState(0)
  const [vendorCount, setVendorCount] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  // 'random' is the default on purpose (audit A-05). 'shared' is the deliberate choice to announce one password to everybody.
  const [mode, setMode] = useState<BulkResetMode>('random')
  const [sharedPassword, setSharedPassword] = useState('')
  const [sharedAgain, setSharedAgain] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // Each person gets their OWN random temporary password. They come back from the server once and are kept only in this window's memory until it is closed.
  const [credentials, setCredentials] = useState<BulkCredential[]>([])
  const [warning, setWarning] = useState<string | null>(null)
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
    setAdminCount(0)
    setVendorCount(0)
    setLoadError(null)
    setTyped('')
    setMode('random')
    setSharedPassword('')
    setSharedAgain('')
    setShowPassword(false)
    setCredentials([])
    setWarning(null)
    setProgress(0)
    setSucceeded(0)
    setFailures([])
    setFatal(null)
    const r = await safely(() => listPasswordResetTargets())
    if (r.error) setLoadError(r.error)
    else { setIds(r.ids ?? []); setAdminCount(r.admins ?? 0); setVendorCount(r.vendors ?? 0) }
  }

  function close() {
    if (phase === 'running') return
    setCredentials([])   // gone for good once the window is closed
    setSharedPassword('')
    setSharedAgain('')
    setOpen(false)
    if (phase === 'done') router.refresh()
  }

  const total = ids?.length ?? 0
  const policyError = mode === 'shared' && sharedPassword.length > 0 ? validateNewPassword(sharedPassword) : null
  const mismatch = mode === 'shared' && sharedAgain.length > 0 && sharedAgain !== sharedPassword
  const sharedReady = mode === 'random' || (sharedPassword.length > 0 && !policyError && sharedAgain === sharedPassword)
  const canStart = phase === 'form' && total > 0 && sharedReady && typed.trim().toUpperCase() === CONFIRM_WORD

  function downloadCredentials() {
    // the shared CSV writer (lib/export/csv.ts) also stops a cell from being read as a formula by Excel / Sheets
    downloadCSV('reset-one-time-passwords.csv', toCSV(credentials, [
      { key: 'email', label: 'email' }, { key: 'full_name', label: 'full_name' }, { key: 'password', label: 'one_time_password' },
    ]))
  }

  async function start() {
    if (!ids || !canStart) return
    setPhase('running')
    setProgress(0)
    setSucceeded(0)
    setFailures([])
    setFatal(null)
    setCredentials([])
    setWarning(null)

    let ok = 0
    const failed: Failure[] = []
    const issued: BulkCredential[] = []
    const warnings: string[] = []
    const useShared = mode === 'shared' ? sharedPassword : undefined
    for (const batch of chunk(ids, BULK_RESET_BATCH_SIZE)) {
      const r = await safely(() => resetPasswordsBatch(batch, useShared))
      if (r.error) {
        setFatal(r.error)
        break
      }
      ok += r.succeeded ?? 0
      failed.push(...(r.failed ?? []))
      issued.push(...(r.credentials ?? []))
      if (r.warning) warnings.push(r.warning)
      setCredentials([...issued])
      setSucceeded(ok)
      setFailures([...failed])
      setProgress((p) => p + batch.length)
    }
    setWarning(warnings.length > 0 ? warnings.join(' ') : null)
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
        <ModalFrame label="Reset all passwords" onClose={() => { if (phase !== 'running') close() }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
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
                        This resets <strong className="text-foreground">{total} active {total === 1 ? 'account' : 'accounts'}</strong>
                        {' '}— store and office users, technicians and managers
                        {adminCount > 0 && <>, <strong className="text-foreground">{adminCount}</strong> {adminCount === 1 ? 'administrator' : 'administrators'}</>}
                        {vendorCount > 0 && <>, and <strong className="text-foreground">{vendorCount}</strong> OEM / vendor {vendorCount === 1 ? 'login' : 'logins'}</>}.{' '}
                        <strong className="text-foreground">Your own account and every platform owner are never changed.</strong>{' '}
                        Everybody must choose their own new password the next time they open the portal — people already signed in
                        are asked on their next page load, and their current session ends now.
                      </>
                    )}
                  </p>

                  {/* How the new passwords are made. Random is first and is the default: one shared password is weaker (audit A-05). */}
                  <fieldset className="space-y-2 rounded-lg border border-border p-3">
                    <legend className="px-1 text-xs font-medium text-muted-foreground">New password</legend>
                    <label className="flex cursor-pointer gap-2">
                      <input type="radio" name="bulk-reset-mode" className="mt-0.5" checked={mode === 'random'} onChange={() => setMode('random')} />
                      <span className="text-xs">
                        <span className="font-medium text-foreground">A different password for each person</span>
                        <span className="block text-[11px] text-muted-foreground">Safer. You get a file of one-time passwords to hand over privately, shown only once.</span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer gap-2">
                      <input type="radio" name="bulk-reset-mode" className="mt-0.5" checked={mode === 'shared'} onChange={() => setMode('shared')} />
                      <span className="text-xs">
                        <span className="font-medium text-foreground">The same password for everyone — you choose it</span>
                        <span className="block text-[11px] text-muted-foreground">For a roll-out, where one password is announced to the whole company.</span>
                      </span>
                    </label>
                  </fieldset>

                  {mode === 'random' && (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                      The passwords are shown to you <strong>only once</strong>, after the reset, as a file to download. Give each person only their own, privately.
                      They are not stored anywhere readable, so if you close the window without downloading the file, the reset has to be done again.
                    </p>
                  )}

                  {mode === 'shared' && (
                    <>
                      <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-muted-foreground">The password everybody will get</span>
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={sharedPassword}
                            onChange={(e) => setSharedPassword(e.target.value)}
                            autoComplete="new-password"
                            aria-describedby="bulk-reset-rule"
                            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-muted-foreground">Type it again</span>
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={sharedAgain}
                            onChange={(e) => setSharedAgain(e.target.value)}
                            autoComplete="new-password"
                            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                          <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
                          Show what I typed
                        </label>
                        <p id="bulk-reset-rule" className="text-[11px] text-muted-foreground">{PASSWORD_RULE_TEXT}</p>
                        {policyError && <p className="text-[11px] text-destructive">{policyError}</p>}
                        {mismatch && <p className="text-[11px] text-destructive">The two do not match.</p>}
                      </div>
                      <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                        <strong>Please understand what one shared password means.</strong> Until a person changes it, anybody who knows this
                        password can sign in as them — and then set a new password on that account. Announce it only to the people it belongs to,
                        tell everybody to sign in and change it the same day, and never send it together with the list of e-mail addresses.
                      </p>
                    </>
                  )}
                  {plainHttp && (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                      This page isn’t using HTTPS, so what you type here travels unencrypted. Do this from inside the office network
                      (the server’s local address), not over the public internet.
                    </p>
                  )}

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
                  {mode === 'shared' && succeeded > 0 && (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                      Everybody now has the password you typed. Tell them to sign in and change it today — until they do, that one password
                      opens all {succeeded} {succeeded === 1 ? 'account' : 'accounts'}. This reset is recorded in the audit log as a shared one.
                    </p>
                  )}
                  {warning && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">{warning}</p>}
                  {credentials.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">
                        The new passwords are shown <b>only now</b> and are not stored anywhere readable. Download the file and give each person their own password privately.
                        Delete the file once handed over.
                      </p>
                      <button onClick={downloadCredentials} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
                        <Download className="h-3.5 w-3.5" /> Download CSV ({credentials.length})
                      </button>
                    </div>
                  )}
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
                    <button onClick={close} className="btn-gradient px-3 py-1.5 text-xs">{credentials.length > 0 ? 'I have saved the file — close' : 'Close'}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  )
}
