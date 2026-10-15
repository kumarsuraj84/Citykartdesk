import { Sparkles, ChevronRight } from 'lucide-react'
import type { TicketSummary } from '@/lib/requests/ticket-summary'

/** "Catch me up": one click opens a short summary of the ticket for a technician or manager (what happened, what is pending). Plain HTML: no script needed. */
export function TicketSummaryCard({ summary }: { summary: TicketSummary }) {
  return (
    <details className="group rounded-xl border border-primary/20 bg-primary/5" data-testid="ticket-summary">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        Catch me up
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">what happened · what is pending</span>
      </summary>
      <div className="space-y-3 border-t border-primary/10 px-4 py-3 text-xs text-foreground">
        <p className="font-medium">{summary.headline}</p>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">What happened so far</p>
          <ul className="list-disc space-y-0.5 pl-4">{summary.happened.map((t, n) => <li key={n}>{t}</li>)}</ul>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">What is pending</p>
          <ul className="list-disc space-y-0.5 pl-4">{summary.pending.map((t, n) => <li key={n}>{t}</li>)}</ul>
        </div>
        <p className="text-[10px] text-muted-foreground">Made from this ticket&apos;s own history. Internal notes are counted but never quoted.</p>
      </div>
    </details>
  )
}
