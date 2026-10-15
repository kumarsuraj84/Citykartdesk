// "Catch me up": a short summary of a ticket for the technician or manager who opens it, built only from the ticket's own history (no outside service, nothing
// leaves the app). It answers two questions: what happened so far, and what is pending (and with whom). The wording is plain and the same ticket always gives the
// same summary. A later version can have an AI write the sentences from the same facts.

import { STATUS_LABELS, PRIORITY_LABELS } from '@/lib/constants/requests'

export interface SummaryComment {
  at: string
  author: string
  /** an internal note (seen by technicians only) */
  internal: boolean
  /** written by the person who raised the ticket */
  byRequester: boolean
  body: string
}

export interface SummaryActivity {
  at: string
  action: string
  actor: string
  /** status_changed: { from, to } */
  from?: string
  to?: string
}

export interface SummaryApproval {
  status: string
  sentAt: string
  /** the people it is waiting on right now */
  awaiting: string[]
  /** who decided it, if anyone */
  decidedBy?: string
  decision?: string
}

export interface SummaryInput {
  now: Date
  ticketNo: string
  title: string
  status: string
  priority: string
  createdAt: string
  requester: string
  technician: string | null
  group: string | null
  respondedAt: string | null
  responseDueAt: string | null
  resolutionDueAt: string | null
  resolvedAt: string | null
  waitingSince: string | null
  comments: SummaryComment[]
  activity: SummaryActivity[]
  approvals: SummaryApproval[]
  attachmentCount: number
}

export interface TicketSummary {
  headline: string
  happened: string[]
  pending: string[]
}

const DAY = 86_400_000
const HOUR = 3_600_000

/** "just now", "3 hours ago", "yesterday", "5 days ago" */
export function ago(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime()
  if (ms < 2 * 60_000) return 'just now'
  if (ms < HOUR) return `${Math.round(ms / 60_000)} minutes ago`
  if (ms < DAY) { const h = Math.round(ms / HOUR); return `${h} hour${h === 1 ? '' : 's'} ago` }
  const d = Math.floor(ms / DAY)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** "43 hours", "2 days": a length of time */
function span(ms: number): string {
  const a = Math.abs(ms)
  if (a < HOUR) return `${Math.max(1, Math.round(a / 60_000))} minutes`
  if (a < 2 * DAY) { const h = Math.round(a / HOUR); return `${h} hour${h === 1 ? '' : 's'}` }
  return `${Math.floor(a / DAY)} days`
}

const label = (s: string) => (STATUS_LABELS as Record<string, string>)[s] ?? s
const quote = (s: string, n = 140) => { const t = s.replace(/\s+/g, ' ').trim(); return `"${t.length > n ? `${t.slice(0, n).trimEnd()}…` : t}"` }
const names = (list: string[]) => (list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`)

export function buildTicketSummary(i: SummaryInput): TicketSummary {
  const now = i.now
  const open = !['resolved', 'closed', 'cancelled'].includes(i.status)
  const prio = (PRIORITY_LABELS as Record<string, string>)[i.priority] ?? i.priority

  const headline = `${i.ticketNo} is ${label(i.status)}, ${prio} priority${i.technician ? `, with ${i.technician}${i.group ? ` (${i.group})` : ''}` : ', not assigned to a technician yet'}. Raised by ${i.requester} ${ago(i.createdAt, now)}.`

  // ── what happened ──────────────────────────────────────────────────────────
  const happened: string[] = [`Raised by ${i.requester}, ${ago(i.createdAt, now)}${i.attachmentCount > 0 ? ` with ${i.attachmentCount} attachment${i.attachmentCount === 1 ? '' : 's'}` : ''}.`]
  const acts = [...i.activity].sort((a, b) => a.at.localeCompare(b.at))
  const lastAssign = [...acts].reverse().find((a) => a.action === 'assigned')
  if (lastAssign && i.technician) happened.push(`Assigned to ${i.technician} ${ago(lastAssign.at, now)}.`)
  if (i.respondedAt) happened.push(`First response ${ago(i.respondedAt, now)}.`)
  const flow = acts.filter((a) => a.action === 'status_changed' && a.to).slice(-4)
  if (flow.length > 0) happened.push(`Status moved: ${flow.map((a) => `${a.from ? `${label(a.from)} → ` : ''}${label(a.to as string)} (${ago(a.at, now)}, ${a.actor || 'system'})`).join('; ')}.`)
  for (const ap of i.approvals) {
    if (ap.decision) happened.push(`Approval ${ap.decision} by ${ap.decidedBy ?? 'an approver'}.`)
    else happened.push(`Sent for approval ${ago(ap.sentAt, now)} to ${names(ap.awaiting)}.`)
  }
  const publicReplies = i.comments.filter((c) => !c.internal)
  const notes = i.comments.filter((c) => c.internal)
  if (publicReplies.length > 0 || notes.length > 0) {
    happened.push(`${publicReplies.length} public repl${publicReplies.length === 1 ? 'y' : 'ies'}${notes.length > 0 ? ` and ${notes.length} internal note${notes.length === 1 ? '' : 's'}` : ''} so far.`)
  }
  const lastPublic = [...publicReplies].sort((a, b) => a.at.localeCompare(b.at)).pop()
  if (lastPublic) happened.push(`Last public message, ${ago(lastPublic.at, now)}, from ${lastPublic.author}: ${quote(lastPublic.body)}`)
  if (i.resolvedAt && !open) happened.push(`${label(i.status)} ${ago(i.resolvedAt, now)}.`)

  // ── what is pending ────────────────────────────────────────────────────────
  const pending: string[] = []
  const pendingApproval = i.approvals.find((a) => !a.decision && a.awaiting.length > 0)
  if (i.status === 'pending_approval' || pendingApproval) {
    pending.push(`Waiting for approval from ${names(pendingApproval?.awaiting ?? [])}${pendingApproval ? `, sent ${ago(pendingApproval.sentAt, now)}` : ''}.`)
  }
  if (i.status === 'waiting_user') pending.push(`Waiting for ${i.requester} to reply${i.waitingSince ? ` since ${ago(i.waitingSince, now)}` : ''}.`)
  if (i.status === 'hold_purchase_ho') pending.push(`On hold for a purchase from HO${i.waitingSince ? ` since ${ago(i.waitingSince, now)}` : ''}.`)
  if (open && ['open', 'assigned', 'in_progress'].includes(i.status)) {
    pending.push(i.technician ? `${i.technician} has to work on it and resolve it.` : 'Nobody is assigned yet: it needs a technician.')
    if (!i.respondedAt) pending.push(i.responseDueAt && new Date(i.responseDueAt) < now ? `No response has been given yet and the response time is already over by ${span(now.getTime() - new Date(i.responseDueAt).getTime())}.` : 'No response has been given to the requester yet.')
  }
  // the requester wrote last and nobody has answered
  if (open && lastPublic?.byRequester && !['waiting_user', 'pending_approval'].includes(i.status)) {
    const answered = notes.some((n) => n.at > lastPublic.at)
    if (!answered) pending.push(`${i.requester}'s last message has no reply yet.`)
  }
  if (open && i.resolutionDueAt) {
    const left = new Date(i.resolutionDueAt).getTime() - now.getTime()
    pending.push(left < 0 ? `Resolution time is over by ${span(left)} (SLA breached).` : `Resolution is due in ${span(left)}.`)
  }
  if (i.status === 'resolved') pending.push(`Resolved: nothing more is needed unless ${i.requester} reopens it.`)
  if (pending.length === 0) pending.push(open ? 'Nothing is waiting on anyone right now.' : 'Nothing: this ticket is finished.')

  return { headline, happened, pending }
}
