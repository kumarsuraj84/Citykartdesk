import { EmailBody } from '@/app/(app)/intake/_components/EmailBody'
import { Mail, StickyNote, History, Paperclip, MessageSquareQuote, CheckCircle2 } from 'lucide-react'
import type { ZohoFieldGroup, ZohoTicketDetail, ZohoTimelineEntry } from '@/lib/zoho/report-shapes'

/**
 * One Zoho ticket, exactly as the old system held it: every field Zoho had, its own words, and the whole conversation.
 * Nothing is matched to CK Desk. The fields are read from the ticket's whole original Zoho record, so a Zoho field we
 * never gave a proper name to is still shown rather than quietly dropped.
 */

const when = (at: string | null) => (at ? new Date(at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'date not recorded')

const size = (bytes: number | null) => {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Fields({ group }: { group: ZohoFieldGroup }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-semibold text-foreground">{group.title}</h2>
        <span className="text-[11px] text-muted-foreground">{group.fields.length} field{group.fields.length === 1 ? '' : 's'}</span>
      </div>
      {group.note && <p className="mt-0.5 text-[11px] text-muted-foreground">{group.note}</p>}
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {group.fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[11px] font-medium text-muted-foreground">{f.label}</dt>
            <dd className={`break-words text-sm text-foreground ${group.mono ? 'font-mono text-xs' : ''}`}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const ICONS = { email: Mail, note: StickyNote, history: History, conversation: Mail } as const

function Entry({ e }: { e: ZohoTimelineEntry }) {
  const Icon = ICONS[e.kind]
  return (
    <li className="relative pl-7">
      <span className="absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background">
        <Icon className="h-3 w-3 text-muted-foreground" />
      </span>
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-xs font-semibold text-foreground">
            {e.heading}
            {e.who && <span className="ml-1.5 font-normal text-muted-foreground">{e.who}</span>}
          </p>
          <p className="text-[11px] text-muted-foreground">{when(e.at)}</p>
        </div>
        {e.subject && <p className="mt-1 text-sm font-medium text-foreground">{e.subject}</p>}
        {e.hasAttachments && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><Paperclip className="h-3 w-3" /> this e-mail had attachments</p>
        )}
        {e.body
          ? (
            <div className="mt-2 border-t border-border/60 pt-2">
              {/* an e-mail or a note can carry the old system's own formatting, so it is shown the way a mail is shown (cleaned, in a sealed frame);
                  a recorded change is one plain sentence, so it is simply written out */}
              {e.kind === 'history'
                ? <p className="whitespace-pre-wrap break-words text-sm text-foreground">{e.body}</p>
                : <EmailBody html={e.body} text={null} />}
            </div>
          )
          : <p className="mt-1 text-xs italic text-muted-foreground">(nothing was written)</p>}
      </div>
    </li>
  )
}

export function ZohoTicketView({ ticket }: { ticket: ZohoTicketDetail }) {
  const c = ticket.counts
  const fieldCount = ticket.groups.reduce((t, g) => t + g.fields.length, 0)

  return (
    <div className="space-y-4">
      {/* the headline: the ticket number, what it was about, and where it got to */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="font-mono text-sm font-semibold text-primary">Zoho ticket {ticket.ticketNo}</p>
          <p className="text-[11px] text-muted-foreground">{fieldCount} fields held for this ticket</p>
        </div>
        <h1 className="mt-1 text-base font-semibold text-foreground">{ticket.subject || '(no subject)'}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {ticket.status}
          {ticket.service && <>{' · '}{ticket.service}</>}
        </p>
      </div>

      {/* what the store actually wrote when raising it */}
      {ticket.message && (
        <div className="rounded-lg border border-border bg-card p-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <MessageSquareQuote className="h-3.5 w-3.5 text-muted-foreground" />
            What was written when the ticket was raised
          </h2>
          <div className="mt-2 border-t border-border/60 pt-2">
            <EmailBody html={ticket.message} text={null} />
          </div>
        </div>
      )}

      {/* what the technician recorded on closing - where our technicians write what they did */}
      {ticket.closure && (
        <div className="rounded-lg border border-border bg-card p-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
            What the technician recorded on closing
          </h2>
          {ticket.closure.code && (
            <p className="mt-1 text-xs text-muted-foreground">Closure code: <span className="font-medium text-foreground">{ticket.closure.code}</span>
              {ticket.closure.by && <>{' · by '}<span className="text-foreground">{ticket.closure.by}</span></>}
            </p>
          )}
          {ticket.closure.comments
            ? <p className="mt-2 whitespace-pre-wrap break-words border-t border-border/60 pt-2 text-sm text-foreground">{ticket.closure.comments}</p>
            : <p className="mt-1 text-xs italic text-muted-foreground">The technician wrote nothing here.</p>}
        </div>
      )}

      {ticket.groups.map((g) => <Fields key={g.key} group={g} />)}

      {ticket.attachments.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <h2 className="text-sm font-semibold text-foreground">Attachments ({ticket.attachments.length})</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">The files are kept on the office storage. This list is what the ticket had.</p>
          <ul className="mt-2 space-y-1">
            {ticket.attachments.map((a, i) => (
              <li key={`${a.fileName}-${i}`} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                  <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate" title={a.fileName}>{a.fileName}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {size(a.size)}
                  {!a.saved && <span className="ml-1.5 text-amber-600 dark:text-amber-500">not saved</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">The whole conversation</h2>
          <p className="text-[11px] text-muted-foreground">
            {c.emails.toLocaleString('en-IN')} e-mail(s) · {c.notes} note(s) · {c.history.toLocaleString('en-IN')} recorded change(s)
            {ticket.timelineTrimmed && ' · only the first part is shown'}
          </p>
        </div>
        {ticket.timeline.length === 0
          ? <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">This ticket has no e-mails, notes or recorded changes.</p>
          : (
            <ul className="space-y-2 border-l border-border/70 pl-2">
              {ticket.timeline.map((e, i) => <Entry key={`${e.kind}-${i}`} e={e} />)}
            </ul>
          )}
      </div>
    </div>
  )
}
