'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, PlayCircle } from 'lucide-react'
import { runTicketAutomationAgain } from '@/lib/actions/automation'
import { formatRelativeTime } from '@/lib/utils'

export type StuckRow = {
  requestId: string
  requestNo: string
  title: string
  status: string
  createdAt: string
  interrupted: boolean
  gaveUp: boolean
  /** made before the automatic steps were recorded: the system never retries these by itself */
  older: boolean
  missing: { label: string; detail: string }[]
  blocked: { label: string; detail: string }[]
}

function Row({ row }: { row: StuckRow }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [done, setDone] = useState<string | null>(null)
  function run() {
    start(async () => {
      const res = await runTicketAutomationAgain(row.requestId)
      if (res.error && res.outcomes.length === 0) toast.error(res.error)
      else if (res.outcomes.every((o) => o.after === 'done')) { toast.success(`${row.requestNo}: done`); setDone('Done') }
      else toast.warning(res.message)
      router.refresh()
    })
  }
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <Link href={`/requests/${row.requestId}`} className="font-semibold text-primary hover:underline">{row.requestNo}</Link>
          <span className="ml-2 text-foreground">{row.title}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {row.status.replace('_', ' ')} - made {formatRelativeTime(row.createdAt)}
          {row.interrupted && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">interrupted</span>}
          {row.older && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">older ticket - run by hand only</span>}
          {row.gaveUp && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">automatic retry gave up</span>}
        </p>
        <ul className="mt-1.5 space-y-0.5 text-xs">
          {row.missing.map((m) => <li key={m.label}><span className="font-medium text-destructive">Missing:</span> {m.label} - <span className="text-muted-foreground">{m.detail}</span></li>)}
          {row.blocked.map((m) => <li key={m.label}><span className="font-medium text-amber-700">Cannot be done yet:</span> {m.label} - <span className="text-muted-foreground">{m.detail}</span></li>)}
        </ul>
      </div>
      {done ? <span className="text-xs font-medium text-emerald-700">{done}</span> : (
        <button type="button" onClick={run} disabled={pending} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />} Run
        </button>
      )}
    </li>
  )
}

export function StuckTicketsClient({ broken, unassigned, checked }: { broken: StuckRow[]; unassigned: StuckRow[]; checked: number }) {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Automation did not finish ({broken.length})</h2>
        {broken.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-3 py-4 text-sm text-muted-foreground">Nothing is stuck. All {checked} recent tickets are fine.</p>
        ) : (
          <ul className="space-y-2">{broken.map((r) => <Row key={r.requestId} row={r} />)}</ul>
        )}
      </section>
      <section>
        <h2 className="mb-1 text-sm font-semibold text-foreground">Nobody has these tickets yet ({unassigned.length})</h2>
        <p className="mb-2 text-xs text-muted-foreground">Open and unassigned, and the Business Rules gave them to nobody. This is normal for tickets that wait in a team queue. If you have fixed a rule or added a technician, press Run to give them out again.</p>
        {unassigned.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-3 py-4 text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">{unassigned.map((r) => <Row key={r.requestId} row={r} />)}</ul>
        )}
      </section>
    </div>
  )
}
