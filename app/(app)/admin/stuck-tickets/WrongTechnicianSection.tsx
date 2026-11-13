'use client'

// Tickets that are stuck with somebody who is no longer a technician (role changed, account switched off, account gone).
// A ticket keeps its technician in its own field, so such a ticket is never looked at by the routing rules again until it is sent back for routing.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserX } from 'lucide-react'
import { safely } from '@/lib/ui/safeAction'
import { releaseRequests, reassignRequests, type StuckAssigneeRow } from '@/lib/actions/admin/assignee-cleanup'

export function WrongTechnicianSection({ rows, technicians, loadError }: {
  rows: StuckAssigneeRow[]
  technicians: { id: string; name: string }[]
  loadError?: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [to, setTo] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])

  const chosen = rows.filter((r) => picked[r.requestId]).map((r) => r.requestId)
  const ids = chosen.length > 0 ? chosen : rows.map((r) => r.requestId)

  function sendBack() {
    setMessage(null); setNotes([])
    start(async () => {
      const res = await safely(() => releaseRequests(ids))
      if (res.error) { setMessage(res.error); return }
      const d = res.data!
      setMessage(`${d.released} ticket(s) taken off, ${d.routed} given to a technician by the Business Rules${d.keptWaiting ? `, ${d.keptWaiting} kept their waiting status` : ''}${d.skipped ? `, ${d.skipped} not changed` : ''}.`)
      setNotes(d.notes)
      setPicked({})
      router.refresh()
    })
  }

  function handOver() {
    if (!to) { setMessage('Choose a technician first.'); return }
    setMessage(null); setNotes([])
    start(async () => {
      const res = await safely(() => reassignRequests(ids, to))
      if (res.error) { setMessage(res.error); return }
      setMessage(`${res.data!.moved} ticket(s) handed over${res.data!.skipped ? `, ${res.data!.skipped} not changed` : ''}.`)
      setNotes(res.data!.notes)
      setPicked({})
      router.refresh()
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <UserX className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-foreground">Tickets whose technician is no longer a technician</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{rows.length}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        These unfinished tickets still belong to somebody whose role was changed, whose account was switched off, or whose account no longer exists.
        A ticket like this is not looked at by the routing rules, so it sits with nobody working on it. <b>Send back for routing</b> takes the technician off and lets the
        Business Rules choose the right technician again. A ticket that is waiting for the requester, an approval or a head-office purchase keeps that status
        and waits for you to choose a technician.
      </p>

      {loadError && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{loadError}</p>}

      {rows.length === 0 && !loadError && <p className="text-xs text-emerald-700">Nothing to do: every unfinished ticket belongs to an active technician.</p>}

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="w-8 py-1.5"></th>
                  <th className="py-1.5 pr-2">Ticket</th>
                  <th className="py-1.5 pr-2">Status</th>
                  <th className="py-1.5 pr-2">Still with</th>
                  <th className="py-1.5">What happens</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.requestId} className="border-b border-border/60 align-top">
                    <td className="py-1.5">
                      <input type="checkbox" checked={!!picked[r.requestId]} onChange={(e) => setPicked((p) => ({ ...p, [r.requestId]: e.target.checked }))} aria-label={`Choose ${r.requestNo ?? 'ticket'}`} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Link href={`/requests/${r.requestId}`} className="font-mono text-primary hover:underline">{r.requestNo ?? r.requestId.slice(0, 8)}</Link>
                      <div className="text-muted-foreground">{r.title}</div>
                    </td>
                    <td className="py-1.5 pr-2">{r.status}</td>
                    <td className="py-1.5 pr-2">
                      {r.assigneeName}
                      <div className="text-muted-foreground">{r.reason}</div>
                    </td>
                    <td className="py-1.5">
                      {r.willBeRouted
                        ? <span className="text-emerald-700">the rules give it to a technician</span>
                        : <span className="text-amber-700">keeps its waiting status — choose a technician</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={sendBack} disabled={pending} className="btn-gradient disabled:opacity-40">
              {pending ? 'Working…' : `Send back for routing (${ids.length})`}
            </button>
            <span className="text-xs text-muted-foreground">or</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
              <option value="">Choose a technician…</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={handOver} disabled={pending || !to} className="btn-soft disabled:opacity-40">
              Hand over ({ids.length})
            </button>
            <span className="text-xs text-muted-foreground">
              {chosen.length > 0 ? `${chosen.length} chosen` : 'nothing chosen: all of them'}
            </span>
          </div>
        </>
      )}

      {message && <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-foreground">{message}</p>}
      {notes.length > 0 && (
        <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-700">
          {notes.slice(0, 15).map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </div>
  )
}
