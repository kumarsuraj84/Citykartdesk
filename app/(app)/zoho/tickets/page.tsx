import Link from 'next/link'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { zohoDbStatus } from '@/lib/zoho/db'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { loadMovedNumbers, loadTransferState } from '@/lib/zoho/transfer/data'
import { getZohoTicket, parseZohoTicketNo, searchZohoTickets } from '@/lib/zoho/queries'
import { NotConnected } from '../_components/NotConnected'
import { TicketSearchForm } from './TicketSearchForm'
import { ZohoTicketView } from './ZohoTicketView'
import { FileSearch } from 'lucide-react'
import type { ZohoTicketDetail } from '@/lib/zoho/report-shapes'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Find a Zoho ticket' }

type Hit = Awaited<ReturnType<typeof searchZohoTickets>>[number]

/** What the page has to show, worked out before any of it is drawn (the reading can fail; drawing must not). */
type Result =
  | { kind: 'nothing-asked' }
  | { kind: 'not-a-number'; typed: string }
  | { kind: 'ticket'; ticket: ZohoTicketDetail; moved: { requestNo: string; requestId: string | null; movedAt: string } | null }
  | { kind: 'no-such-ticket'; ticketNo: number }
  | { kind: 'hits'; hits: Hit[]; text: string; moved: Set<number> }
  | { kind: 'failed'; reason: string }

async function lookUp(typed: string, text: string, orgId: string | null): Promise<Result> {
  const ticketNo = typed ? parseZohoTicketNo(typed) : null
  try {
    if (typed && ticketNo === null) return { kind: 'not-a-number', typed }
    if (ticketNo !== null) {
      const ticket = await getZohoTicket(ticketNo)
      if (!ticket) return { kind: 'no-such-ticket', ticketNo }
      // has it been moved into CK Desk already? (the list of moved tickets lives in CK Desk; Zoho itself is never written to)
      const st = orgId ? await loadTransferState(orgId, ticketNo).catch(() => null) : null
      return { kind: 'ticket', ticket, moved: st && st.state === 'moved' ? { requestNo: st.requestNo, requestId: st.requestId, movedAt: st.movedAt } : null }
    }
    if (text) {
      const hits = await searchZohoTickets(text)
      const moved = orgId && hits.length ? await loadMovedNumbers(orgId, hits.map((h) => h.ticketNo)).catch(() => new Set<number>()) : new Set<number>()
      return { kind: 'hits', hits, text, moved }
    }
    return { kind: 'nothing-asked' }
  } catch (e) {
    return { kind: 'failed', reason: e instanceof Error ? e.message : 'The Zoho database could not be read.' }
  }
}

function Hits({ hits, text, moved }: { hits: Hit[]; text: string; moved: Set<number> }) {
  if (hits.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Nothing matched &ldquo;{text}&rdquo; in the subject, the person who raised it, or the technician.
      </div>
    )
  }
  return (
    <div tabIndex={0} role="region" aria-label="Ticket table (scrolls sideways)" className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Ticket</th>
            <th className="px-3 py-2 font-medium">Subject</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Raised by</th>
            <th className="px-3 py-2 font-medium">Raised on</th>
            <th className="px-3 py-2 font-medium">CK Desk</th>
          </tr>
        </thead>
        <tbody>
          {hits.map((h) => (
            <tr key={h.ticketNo} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
              <td className="px-3 py-2">
                <Link href={`/zoho/tickets?no=${h.ticketNo}`} className="font-mono font-semibold text-primary hover:underline">{h.ticketNo}</Link>
              </td>
              <td className="max-w-md px-3 py-2"><span className="line-clamp-2 text-foreground">{h.subject ?? '(no subject)'}</span></td>
              <td className="px-3 py-2 text-muted-foreground">{h.status}</td>
              <td className="px-3 py-2 text-muted-foreground">{h.requester ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{h.createdAt ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2">{moved.has(h.ticketNo) ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Moved → ZOHO-{h.ticketNo}</span> : <span className="text-[11px] text-muted-foreground">not moved</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        {hits.length === 1 ? 'One match.' : `The newest ${hits.length} matches. Narrow the words to see fewer.`}
      </p>
    </div>
  )
}

function Body({ result }: { result: Result }) {
  switch (result.kind) {
    case 'failed':
      return <NotConnected reason={result.reason} />
    case 'not-a-number':
      return (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">&ldquo;{result.typed}&rdquo; is not a Zoho ticket number.</p>
          <p className="mt-1">A Zoho ticket number is only digits, for example <span className="font-mono">129571</span>. If you do not have the number, search by words below.</p>
        </div>
      )
    case 'ticket':
      return (
        <div className="space-y-3">
          {result.moved && (
            <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
              <strong>Moved to CK Desk</strong> as{' '}
              {result.moved.requestId ? <Link href={`/requests/${result.moved.requestId}`} className="font-mono font-semibold underline">{result.moved.requestNo}</Link> : <span className="font-mono font-semibold">{result.moved.requestNo}</span>}
              {' '}on {new Date(result.moved.movedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}. Everything on this ticket, with its whole conversation, is in CK Desk now.
            </div>
          )}
          <ZohoTicketView ticket={result.ticket} />
        </div>
      )
    case 'no-such-ticket':
      return (
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="font-medium text-foreground">No Zoho ticket {result.ticketNo}.</p>
          <p className="mt-1 text-muted-foreground">
            Either that number was never used, or the ticket is one of the 37,873 that Zoho archived - those were never readable through its connection and are not in this
            copy. Try searching by words instead.
          </p>
        </div>
      )
    case 'hits':
      return <Hits hits={result.hits} text={result.text} moved={result.moved} />
    default:
      return (
        <EmptyState
          icon={FileSearch}
          title="Type a Zoho ticket number"
          description="For example 129571. Or search by words from the subject, the store code, or the technician's name."
        />
      )
  }
}

export default async function ZohoTicketPage({ searchParams }: { searchParams: Promise<{ no?: string; q?: string }> }) {
  const sp = await searchParams
  const typed = (sp.no ?? '').trim()
  const text = (sp.q ?? '').trim()

  const status = zohoDbStatus()
  const profile = await getCurrentProfile()
  const result: Result = status.ready ? await lookUp(typed, text, (profile?.org_id as string | undefined) ?? null) : { kind: 'failed', reason: status.reason }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Find a Zoho ticket"
        description="Type the Zoho ticket number. Everything the old system held for that ticket is shown, together with its whole conversation."
      />
      {status.ready && <TicketSearchForm defaultNo={typed} defaultText={text} />}
      <Body result={result} />
    </div>
  )
}
