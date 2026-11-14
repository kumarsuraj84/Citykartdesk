import { EmailBody } from '@/app/(app)/intake/_components/EmailBody'
import { Mail, StickyNote, History, Paperclip } from 'lucide-react'
import type { ZohoTicketDetail, ZohoTicketField, ZohoTimelineEntry } from '@/lib/zoho/report-shapes'

/** One Zoho ticket, exactly as the old system held it: its own fields, its own words, and the whole conversation. Nothing is matched to CK Desk. */

const when = (at: string | null) => (at ? new Date(at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'date not recorded')

const size = (bytes: number | null) => {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Fields({ title, fields, note, mono }: { title: string; fields: ZohoTicketField[]; note?: string; mono?: boolean }) {
  if (fields.length === 0) return null
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[11px] font-medium text-muted-foreground">{f.label}</dt>
            <dd className={`break-words text-sm text-foreground ${mono ? 'font-mono text-xs' : ''}`}>{f.value}</dd>
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
  return (
    <div className="space-y-4">
      <Fields title={`Zoho ticket ${ticket.ticketNo}`} fields={ticket.main} />
      <Fields title="Fields of this service" fields={ticket.serviceFields} note="Only the fields this Zoho service actually used. Empty ones are left out." />

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

      <Fields
        title="The original Zoho field names"
        fields={ticket.originalFields}
        note="Kept exactly as ManageEngine stored them, so nothing from Zoho is lost even where we have not given a field a proper name yet."
        mono
      />
    </div>
  )
}
