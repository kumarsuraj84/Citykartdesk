import Link from 'next/link'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { zohoDbStatus } from '@/lib/zoho/db'
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
  | { kind: 'ticket'; ticket: ZohoTicketDetail }
  | { kind: 'no-such-ticket'; ticketNo: number }
  | { kind: 'hits'; hits: Hit[]; text: string }
  | { kind: 'failed'; reason: string }

async function lookUp(typed: string, text: string): Promise<Result> {
  const ticketNo = typed ? parseZohoTicketNo(typed) : null
  try {
    if (typed && ticketNo === null) return { kind: 'not-a-number', typed }
    if (ticketNo !== null) {
      const ticket = await getZohoTicket(ticketNo)
      return ticket ? { kind: 'ticket', ticket } : { kind: 'no-such-ticket', ticketNo }
    }
    if (text) return { kind: 'hits', hits: await searchZohoTickets(text), text }
    return { kind: 'nothing-asked' }
  } catch (e) {
    return { kind: 'failed', reason: e instanceof Error ? e.message : 'The Zoho database could not be read.' }
  }
}

function Hits({ hits, text }: { hits: Hit[]; text: string }) {
  if (hits.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Nothing matched &ldquo;{text}&rdquo; in the subject, the person who raised it, or the technician.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Ticket</th>
            <th className="px-3 py-2 font-medium">Subject</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Raised by</th>
            <th className="px-3 py-2 font-medium">Raised on</th>
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
      return <ZohoTicketView ticket={result.ticket} />
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
      return <Hits hits={result.hits} text={result.text} />
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
  const result: Result = status.ready ? await lookUp(typed, text) : { kind: 'failed', reason: status.reason }

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
