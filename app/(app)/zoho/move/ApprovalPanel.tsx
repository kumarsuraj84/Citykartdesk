'use client'

import { useState, useTransition } from 'react'
import { previewMovedApprovalsAction, sendMovedApprovalsAction, type ApprovalPreviewResult, type ApprovalSendResult } from '@/lib/actions/zohoTransfer'

/**
 * Moved tickets that were "pending approval" in Zoho have no approval in CK Desk, so nobody can approve them here.
 * Step 1 shows who Zoho sent each one to (nothing is changed); step 2 creates the CK Desk approval for the tickets you name and tells ONLY the approver (in CK Desk and by e-mail).
 * The ticket stays "Pending approval"; the requester and the technician are not told.
 */
export function ApprovalPanel({ canMove }: { canMove: boolean }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ApprovalPreviewResult | null>(null)
  const [sent, setSent] = useState<ApprovalSendResult | null>(null)
  const [asking, setAsking] = useState(false)
  const [pending, start] = useTransition()
  if (!canMove) return null

  const numbers = () => [...new Set(text.split(/[\s,;]+/).map((t) => t.replace(/^#/, '').replace(/^ZOHO-/i, '')).filter(Boolean).map(Number))]
  const valid = (ns: number[]) => ns.every((n) => Number.isSafeInteger(n) && n > 0)

  function show() {
    const ns = numbers()
    if (!valid(ns)) { setPreview({ error: 'Type the Zoho ticket numbers, separated by spaces or commas (or leave it empty to see them all).' }); return }
    setSent(null); setAsking(false); setPreview(null)
    start(async () => setPreview(await previewMovedApprovalsAction(ns)))
  }
  function send() {
    const ns = numbers()
    setAsking(false)
    start(async () => { const r = await sendMovedApprovalsAction(ns); setSent(r); if (!r.error) setPreview(await previewMovedApprovalsAction(ns)) })
  }
  const ns = numbers()
  const readyNumbers = (preview?.targets ?? []).filter((t) => t.ready && ns.includes(t.zohoNo)).length

  return (
    <details className="rounded-lg border border-border bg-card p-3 text-xs">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">Send the approval from CK Desk (moved tickets waiting for approval)</summary>
      <div className="mt-2 space-y-2">
        <p className="text-muted-foreground">
          Tickets that were waiting for approval in Zoho have no approval in CK Desk yet. This finds the person Zoho sent each one to and creates the real CK Desk approval for them.
          The ticket stays &quot;Pending approval&quot;. <strong>Only the approver is told</strong> (a CK Desk notice and an e-mail); the requester and the technician are not.
          Tickets that already have an approval are left alone.
        </p>
        <label className="block">
          <span className="text-muted-foreground">Zoho ticket numbers (to send: up to 25; leave empty and press &quot;Show&quot; to list all)</span>
          <textarea value={text} onChange={(e) => { setText(e.target.value); setAsking(false) }} rows={2} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" placeholder="for example 144920, 145336" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={show} disabled={pending} className="rounded-md border border-border px-3 py-1.5 font-semibold hover:bg-muted disabled:opacity-50">{pending ? 'Working…' : 'Show who each would go to'}</button>
          <button type="button" onClick={() => setAsking(true)} disabled={pending || ns.length === 0 || !valid(ns) || readyNumbers === 0} className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-50">Send the approval…</button>
        </div>
        {asking && (
          <div role="alertdialog" aria-label="Confirm sending the approval" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-semibold">Send the approval for {readyNumbers} ticket{readyNumbers === 1 ? '' : 's'} now?</p>
            <p className="mt-1">Each approver gets a CK Desk notice and an e-mail asking them to approve or reject. The tickets stay &quot;Pending approval&quot;. This cannot be taken back from this screen.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={send} className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground">Yes, send</button>
              <button type="button" data-autofocus onClick={() => setAsking(false)} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Cancel</button>
            </div>
          </div>
        )}
        {preview?.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{preview.error}</p>}
        {sent?.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{sent.error}</p>}
        {sent?.results && (
          <ul role="status" className="space-y-1 rounded-md border border-border p-3">
            {sent.results.map((r) => (
              <li key={r.zohoNo} className={r.ok ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300'}>
                {r.ok ? <>✓ Zoho {r.zohoNo} (<strong>{r.requestNo}</strong>): approval sent to {r.approverNames.join(', ')}</> : <>✗ Zoho {r.zohoNo}: {r.reason}</>}
              </li>
            ))}
          </ul>
        )}
        {preview?.targets && (
          preview.targets.length === 0
            ? <p className="text-muted-foreground">No moved ticket is waiting for approval{ns.length ? ' among those numbers' : ''}.</p>
            : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[640px] text-left">
                  <thead><tr className="border-b border-border text-muted-foreground"><th className="px-2 py-1 font-medium">Ticket</th><th className="px-2 py-1 font-medium">Title</th><th className="px-2 py-1 font-medium">Zoho sent the approval to</th><th className="px-2 py-1 font-medium">Can be sent?</th></tr></thead>
                  <tbody>
                    {preview.targets.map((t) => (
                      <tr key={t.requestId} className="border-b border-border/60 align-top">
                        <td className="px-2 py-1 font-mono">{t.requestNo}</td>
                        <td className="px-2 py-1">{t.title.length > 60 ? t.title.slice(0, 59) + '…' : t.title}</td>
                        <td className="px-2 py-1">{t.approvers.length ? t.approvers.map((a) => <span key={a.email} className="block">{a.name ?? a.email}<span className="text-muted-foreground"> ({a.email})</span></span>) : '—'}</td>
                        <td className="px-2 py-1">{t.ready ? <span className="text-emerald-700 dark:text-emerald-400">Yes</span> : <span className="text-red-700 dark:text-red-400">No — {t.problems.join('; ')}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}
      </div>
    </details>
  )
}
