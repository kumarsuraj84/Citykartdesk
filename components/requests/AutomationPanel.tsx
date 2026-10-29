'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, PlayCircle, XCircle } from 'lucide-react'
import { runTicketAutomationAgain } from '@/lib/actions/automation'
import type { AutomationDiagnosis, StepState } from '@/lib/automation/diagnose'

const icon: Record<StepState, React.ReactNode> = {
  done: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />,
  missing: <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />,
  blocked: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />,
  not_needed: <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />,
}

/**
 * For administrators and platform owners only (the ticket page does not even render it for anyone else). Shown only when something the automation should have done did not
 * happen: a checklist in plain words and one button that does ONLY the missing steps. A ticket whose automation worked never shows it.
 */
export function AutomationPanel({ diagnosis }: { diagnosis: AutomationDiagnosis }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const missing = diagnosis.steps.filter((s) => s.state === 'missing')
  const shown = diagnosis.steps.filter((s) => s.state !== 'not_needed')

  function run() {
    start(async () => {
      const res = await runTicketAutomationAgain(diagnosis.requestId)
      setConfirming(false)
      if (res.error && res.outcomes.length === 0) toast.error(res.error)
      else if (res.ok && res.outcomes.every((o) => o.after === 'done')) toast.success(res.message)
      else toast.warning(res.message)
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-50" aria-label="Automation of this ticket">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {diagnosis.interrupted ? 'The automatic steps of this ticket were interrupted' : diagnosis.kind === 'unassigned' ? 'Nobody has this ticket yet' : 'Some automatic steps of this ticket did not happen'}
          </p>
          <p className="mt-0.5 text-xs opacity-80">Only administrators and platform owners see this. The button below does only the steps that are missing; a step that already worked is never repeated.</p>
        </div>
        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} disabled={pending || missing.length === 0}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            <PlayCircle className="h-3.5 w-3.5" /> Run automation again
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs">Run the {missing.length} missing step{missing.length === 1 ? '' : 's'} now?</span>
            <button type="button" onClick={run} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Yes, run
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40">Cancel</button>
          </div>
        )}
      </div>
      <ul className="mt-3 space-y-1.5">
        {shown.map((s) => (
          <li key={s.key} className="flex items-start gap-2">
            {icon[s.state]}
            <span className="min-w-0">
              <span className="font-medium">{s.label}</span>
              <span className="block text-xs opacity-80">{s.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {diagnosis.gaveUp && <p className="mt-2 text-xs opacity-80">The automatic retry tried 3 times and stopped. Fix what is in the way, then press the button.</p>}
    </section>
  )
}
