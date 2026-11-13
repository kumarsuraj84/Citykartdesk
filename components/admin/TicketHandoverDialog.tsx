'use client'

// Asked before somebody loses the right to hold tickets (their role is changed away from technician, or their account is switched off):
// what should happen to the unfinished tickets they still have? Without this the tickets stay with a person who cannot work on them and
// the routing rules never look at them again.

import { ModalFrame } from '@/components/ui/ModalFrame'

export type TicketHandoverChoice = 'release' | 'leave'

export function TicketHandoverDialog({ userName, count, requestNos, busy, onChoose, onCancel }: {
  userName: string
  count: number
  requestNos: string[]
  busy?: boolean
  onChoose: (choice: TicketHandoverChoice) => void
  onCancel: () => void
}) {
  return (
    <ModalFrame label="Unfinished tickets of this person" onClose={onCancel} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <h2 className="text-base font-bold text-ink">
          {userName} still has {count} unfinished ticket{count === 1 ? '' : 's'}
        </h2>
        <p className="text-xs text-muted-foreground">
          After this change they can no longer work on tickets. Choose what happens to these tickets.
          {requestNos.length > 0 && <> For example: <span className="font-mono">{requestNos.slice(0, 5).join(', ')}</span>{count > 5 ? ' …' : ''}</>}
        </p>

        <div className="space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose('release')}
            className="w-full rounded-xl border border-border bg-background p-3 text-left hover:bg-muted/40 disabled:opacity-40"
          >
            <div className="text-sm font-semibold text-foreground">Send back for routing</div>
            <div className="text-xs text-muted-foreground">
              The technician is taken off and the Business Rules give each ticket to the right technician again. A ticket that is waiting for
              the requester, an approval or a head-office purchase keeps that status and waits for you to choose a technician.
            </div>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose('leave')}
            className="w-full rounded-xl border border-border bg-background p-3 text-left hover:bg-muted/40 disabled:opacity-40"
          >
            <div className="text-sm font-semibold text-foreground">Leave them for now</div>
            <div className="text-xs text-muted-foreground">
              Nothing changes on the tickets. They are listed under Admin → Stuck tickets, where you can send them back for routing or hand
              them to a technician you choose.
            </div>
          </button>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-soft disabled:opacity-40">
            {busy ? 'Working…' : 'Cancel the whole change'}
          </button>
        </div>
      </div>
    </ModalFrame>
  )
}
