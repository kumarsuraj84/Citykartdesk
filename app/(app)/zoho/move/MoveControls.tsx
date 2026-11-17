'use client'

import { useState, useTransition } from 'react'
import { useAlertDialog } from '../_components/useAlertDialog'
import { moveZohoTicketsAction, type MoveActionResult } from '@/lib/actions/zohoTransfer'

/**
 * The "Move" step. The ticket check boxes are in the table (they belong to the form `move-form`); this reads the ticked ones, asks once more, then moves.
 * Two steps on purpose: first "Move N tickets", then "Yes, move them now". Nothing is sent to anyone.
 */
export function MoveControls({ canMove, readyCount, limit, unmatched = 0 }: { canMove: boolean; readyCount: number; limit: number; unmatched?: number }) {
  const [ticked, setTicked] = useState<number[]>([])
  const [asking, setAsking] = useState(false)
  const [res, setRes] = useState<MoveActionResult | null>(null)
  const [pending, start] = useTransition()
  const dlg = useAlertDialog(asking, () => setAsking(false))

  function readTicks(): number[] {
    const f = document.getElementById('move-form') as HTMLFormElement | null
    return f ? [...new FormData(f).getAll('n')].map((v) => Number(v)).filter((n) => Number.isSafeInteger(n)) : []
  }
  function ask() { setRes(null); const t = readTicks(); setTicked(t); setAsking(t.length > 0 && t.length <= limit); if (t.length === 0) setRes({ error: 'Tick at least one ticket in the first column.' }); else if (t.length > limit) setRes({ error: `Tick at most ${limit} tickets at a time.` }) }
  function go() { setAsking(false); start(async () => setRes(await moveZohoTicketsAction(ticked))) }

  if (!canMove) return <p className="text-[11px] text-muted-foreground">Only an administrator can move tickets. You can preview them.</p>
  const moved = res?.results?.filter((r) => r.ok) ?? []
  const failed = res?.results?.filter((r) => !r.ok) ?? []
  return (
    <div className="space-y-2">
      {!asking && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" data-return-focus onClick={ask} disabled={pending || readyCount === 0} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {pending ? 'Moving…' : 'Move the ticked tickets'}
          </button>
          <span className="text-[11px] text-muted-foreground">Tick the ready tickets below (up to {limit} at a time). Nobody is emailed or notified.</span>
        </div>
      )}
      {asking && (
        <div ref={dlg} role="alertdialog" aria-label="Confirm the move" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">Move {ticked.length} Zoho ticket{ticked.length === 1 ? '' : 's'} into CK Desk now?</p>
          {unmatched > 0 && <p className="mt-1 font-semibold">Careful: {unmatched} {unmatched === 1 ? 'person is' : 'people are'} not matched yet (see the yellow box above). An empty inactive profile will be made for each one.</p>}
          <p className="mt-1">They become real CK Desk tickets (<code>ZOHO-…</code>) with the Zoho created time. No mail, WhatsApp, push or survey is sent. This cannot be undone from this screen.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={go} className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground">Yes, move them now</button>
            <button type="button" data-autofocus onClick={() => setAsking(false)} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}
      {res?.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{res.error}</p>}
      {res?.results && (
        <div role="status" className="space-y-1 rounded-md border border-border bg-card p-3 text-xs">
          <p className="font-semibold text-foreground">{moved.length} moved{failed.length ? `, ${failed.length} not moved` : ''}.</p>
          <ul className="space-y-0.5">
            {moved.map((r) => <li key={r.zohoNo} className="text-emerald-800 dark:text-emerald-300">✓ Zoho {r.zohoNo} → <strong>{r.requestNo}</strong>{r.notes.length ? <span className="text-muted-foreground"> — {r.notes.join(' ')}</span> : null}</li>)}
            {failed.map((r) => <li key={r.zohoNo} className="text-red-800 dark:text-red-300">✗ Zoho {r.zohoNo}: {r.reason}</li>)}
          </ul>
          <p className="text-[11px] text-muted-foreground">Refresh the preview to see the tickets marked as moved.</p>
        </div>
      )}
    </div>
  )
}
