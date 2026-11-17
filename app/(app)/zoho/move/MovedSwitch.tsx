'use client'

import { useState, useTransition } from 'react'
import { useAlertDialog } from '../_components/useAlertDialog'
import { setMovedActiveAction } from '@/lib/actions/zohoTransfer'

/** One switch: do tickets moved from Zoho take part in alerts, reminders and scheduled rules? Default OFF (silent). */
export function MovedSwitch({ active, canChange }: { active: boolean; canChange: boolean }) {
  const [on, setOn] = useState(active)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const dlg = useAlertDialog(asking, () => setAsking(false))

  function apply(next: boolean) {
    setError(null)
    start(async () => {
      const r = await setMovedActiveAction(next)
      if (r.error) setError(r.error); else { setOn(next); setAsking(false) }
    })
  }

  return (
    <section aria-label="Moved tickets and notifications" className="rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Moved tickets: alerts and reminders are <span className={on ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>{on ? 'ON' : 'OFF (silent)'}</span></h2>
          <p className="text-[11px] text-muted-foreground">
            {on
              ? 'Tickets with a ZOHO- number take part in the "unassigned" alerts and the scheduled Business Rules like any other ticket.'
              : 'Tickets with a ZOHO- number are left out of the "unassigned" alerts and the scheduled Business Rules, so moving old tickets does not notify anybody. You can still open, search, count and work on them.'}
          </p>
        </div>
        {canChange && !asking && <button type="button" data-return-focus onClick={() => setAsking(true)} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted">{on ? 'Switch OFF' : 'Switch ON…'}</button>}
      </div>
      {asking && (
        <div ref={dlg} role="alertdialog" aria-label="Confirm" className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">{on ? 'Make moved tickets silent again?' : 'Let moved tickets take part in alerts and scheduled rules?'}</p>
          {!on && <p className="mt-1">Old open tickets keep their Zoho created time, so many are already late. Switching this on can notify managers and technicians about all of them at the next run. Only do this when you are ready.</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={pending} onClick={() => apply(!on)} className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-60">{pending ? 'Saving…' : on ? 'Yes, make them silent' : 'Yes, switch ON'}</button>
            <button type="button" data-autofocus onClick={() => setAsking(false)} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-red-700 dark:text-red-400">{error}</p>}
    </section>
  )
}
