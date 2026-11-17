'use client'

import { useRef, useState } from 'react'
import { useAlertDialog } from '../_components/useAlertDialog'
import { finishMoveRunAction, moveRunChunkAction, prepareMoveRunAction, startMoveRunAction } from '@/lib/actions/zohoTransfer'
import type { RunPrepared } from '@/lib/zoho/transfer/batch'
import type { MoveFilters } from '@/lib/zoho/transfer/data'

const CHUNK = 25
const fmt = (n: number) => n.toLocaleString('en-IN')
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }) : '—')

type Phase = 'idle' | 'preparing' | 'prepared' | 'confirm' | 'running' | 'paused' | 'done'

/**
 * "Move everything that matches these filters". It does NOT move one huge batch: it asks the server to move 25 tickets at a time, and between two chunks it checks
 * Pause / Stop. A run is recorded (who, when, how many, what failed). Nothing is sent to anybody.
 */
export function RunPanel({ filters, canMove }: { filters: MoveFilters; canMove: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [prep, setPrep] = useState<RunPrepared | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState({ moved: 0, failed: 0, handled: 0 })
  const [failures, setFailures] = useState<{ no: number; reason: string }[]>([])
  const [stopped, setStopped] = useState(false)
  const flag = useRef<'run' | 'pause' | 'stop'>('run')
  const runId = useRef<string | null>(null)
  const pos = useRef(0)
  const dlg = useAlertDialog(phase === 'confirm', () => setPhase('prepared'))

  if (!canMove) return null

  async function prepare() {
    setError(null); setPhase('preparing')
    const r = await prepareMoveRunAction(filters)
    if (r.error || !r.prepared) { setError(r.error ?? 'Could not read the tickets.'); setPhase('idle'); return }
    setPrep(r.prepared); setPhase('prepared')
  }

  async function loop() {
    if (!prep) return
    setPhase('running'); flag.current = 'run'
    const numbers = prep.numbers
    while (pos.current < numbers.length) {
      if ((flag.current as string) !== 'run') break
      const chunk = numbers.slice(pos.current, pos.current + CHUNK)
      const res = await moveRunChunkAction(runId.current!, chunk)
      pos.current += chunk.length
      if (res.error && !res.results) { setError(res.error); flag.current = 'stop'; break }
      const ok = res.results?.filter((r) => r.ok).length ?? 0
      const bad = (res.results ?? []).filter((r) => !r.ok).map((r) => ({ no: r.zohoNo, reason: r.reason ?? 'Not moved.' }))
      setDone((d) => ({ moved: d.moved + ok, failed: d.failed + bad.length, handled: pos.current }))
      if (bad.length) setFailures((f) => [...f, ...bad].slice(0, 200))
      if (res.runStopped) { flag.current = 'stop'; break }
    }
    if ((flag.current as string) === 'pause') { setPhase('paused'); return }
    const finished = pos.current >= numbers.length
    setStopped(!finished)
    await finishMoveRunAction(runId.current!, !finished)
    setPhase('done')
  }

  async function begin() {
    if (!prep) return
    setError(null)
    const r = await startMoveRunAction(filters, prep.numbers.length)
    if (r.error || !r.runId) { setError(r.error ?? 'Could not start the run.'); return }
    runId.current = r.runId; pos.current = 0
    setDone({ moved: 0, failed: 0, handled: 0 }); setFailures([]); setStopped(false)
    void loop()
  }

  const total = prep?.numbers.length ?? 0
  const pct = total ? Math.min(100, Math.round((done.handled / total) * 100)) : 0

  return (
    <section aria-label="Move everything that matches" className="rounded-lg border border-border bg-card p-3">
      <h2 className="text-sm font-semibold text-foreground">Move everything that matches these filters</h2>
      <p className="text-[11px] text-muted-foreground">Moves the tickets {CHUNK} at a time with a Pause / Stop button, and keeps a record of the run. No mail, WhatsApp, push or survey is sent.</p>

      {error && <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      {(phase === 'idle' || phase === 'preparing') && (
        <div className="mt-2">
          <button type="button" onClick={prepare} disabled={phase === 'preparing'} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60">
            {phase === 'preparing' ? 'Reading every matching ticket…' : 'Check what would move'}
          </button>
        </div>
      )}

      {prep && (phase === 'prepared' || phase === 'confirm') && (
        <div className="mt-3 space-y-2 text-xs">
          <p className="text-foreground">
            <strong>{fmt(prep.ready)}</strong> of <strong>{fmt(prep.matching)}</strong> matching tickets can be moved ({fmt(prep.readyOpen)} open, {fmt(prep.readyFinished)} finished).
            {prep.blocked > 0 && <> <strong>{fmt(prep.blocked)}</strong> cannot yet.</>}
            {prep.ready > 0 && <> Created {day(prep.oldestReady)} to {day(prep.newestReady)}.</>}
          </p>
          {prep.truncated && <p className="text-amber-800 dark:text-amber-300">The filters match more than {fmt(prep.scanned)} tickets; only the newest {fmt(prep.scanned)} were looked at. Narrow the dates or the status and run again for the rest.</p>}
          {prep.reasons.length > 0 && (
            <ul className="flex flex-wrap gap-2">{prep.reasons.map((r) => <li key={r.code} className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{r.title}: {fmt(r.count)}</li>)}</ul>
          )}
          {prep.readyOpen > 0 && <p className="text-muted-foreground">The {fmt(prep.readyOpen)} open tickets keep their Zoho created time, so many are already late. They stay <strong>silent</strong> (no alert, reminder or scheduled rule) until you switch moved tickets on.</p>}
          {prep.ready === 0 ? <p className="text-muted-foreground">Nothing to move with these filters.</p> : phase === 'prepared' ? (
            <div className="flex gap-2">
              <button type="button" data-return-focus onClick={() => setPhase('confirm')} className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground">Move these {fmt(prep.ready)} tickets…</button>
              <button type="button" onClick={() => { setPrep(null); setPhase('idle') }} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Cancel</button>
            </div>
          ) : (
            <div ref={dlg} role="alertdialog" aria-label="Confirm the run" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">Move {fmt(prep.ready)} Zoho tickets into CK Desk now?</p>
              <p className="mt-1">They become real CK Desk tickets (<code>ZOHO-…</code>) with their Zoho created time, in {Math.ceil(prep.ready / CHUNK)} steps of {CHUNK}. You can pause or stop at any time; what is already moved stays moved.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={begin} className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground">Yes, start moving</button>
                <button type="button" data-autofocus onClick={() => setPhase('prepared')} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Back</button>
              </div>
            </div>
          )}
        </div>
      )}

      {(phase === 'running' || phase === 'paused' || phase === 'done') && prep && (
        <div className="mt-3 space-y-2 text-xs" role="status" aria-live="polite">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
          <p className="text-foreground">
            {phase === 'done' ? (stopped ? 'Stopped.' : 'Finished.') : phase === 'paused' ? 'Paused.' : 'Moving…'} <strong>{fmt(done.handled)}</strong> of <strong>{fmt(total)}</strong> handled —
            <span className="text-emerald-700 dark:text-emerald-400"> {fmt(done.moved)} moved</span>{done.failed > 0 && <span className="text-red-700 dark:text-red-400">, {fmt(done.failed)} not moved</span>}.
          </p>
          <div className="flex gap-2">
            {phase === 'running' && <button type="button" onClick={() => { flag.current = 'pause' }} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Pause after this step</button>}
            {phase === 'paused' && <button type="button" onClick={() => void loop()} className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground">Resume</button>}
            {(phase === 'running' || phase === 'paused') && <button type="button" onClick={() => { flag.current = 'stop'; if (phase === 'paused') { setStopped(true); void finishMoveRunAction(runId.current!, true); setPhase('done') } }} className="rounded-md border border-red-300 px-3 py-1.5 text-red-800 hover:bg-red-50 dark:text-red-300">Stop</button>}
            {phase === 'done' && <button type="button" onClick={() => { setPrep(null); setPhase('idle') }} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Close</button>}
          </div>
          {failures.length > 0 && (
            <details className="rounded-md border border-border p-2"><summary className="cursor-pointer font-medium text-red-800 dark:text-red-300">Tickets not moved ({failures.length}{done.failed > failures.length ? '+' : ''})</summary>
              <ul className="mt-1 space-y-0.5">{failures.map((f) => <li key={f.no}>Zoho {f.no}: {f.reason}</li>)}</ul></details>
          )}
        </div>
      )}
    </section>
  )
}
