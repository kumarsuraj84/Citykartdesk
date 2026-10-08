// Starting a CSAT survey when a ticket is resolved, and the e-mail that goes with it. Used by every way a ticket can be
// resolved (a technician, or a Business Rule), so the survey and the e-mail always come from one place.

import { sendEmail } from '@/lib/email/send'
import { absoluteAppUrl } from '@/lib/email/notify-email'
import { csatResolvedEmail, csatReminderEmail } from '@/lib/email/csat-templates'
import { CSAT_LINK_DAYS, signCsatToken } from './token'
import { getCsatSettings } from './settings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }

const DAY = 86_400_000

export interface CsatTicket {
  id: string
  requestNo: string
  title: string
  orgId: string
  requesterId: string
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })

/** The five star links, the reopen link and the ticket link, all tied to this survey by one signed token. */
export function buildCsatLinks(surveyId: string, requestId: string, resolvedAtMs: number): { starUrls: string[]; reopenUrl: string; requestUrl: string } | null {
  const token = signCsatToken(surveyId, resolvedAtMs + CSAT_LINK_DAYS * DAY)
  if (!token) return null
  const base = absoluteAppUrl(`/csat/${token}`)
  return {
    starUrls: [1, 2, 3, 4, 5].map((n) => `${base}?r=${n}`),
    reopenUrl: `${base}?reopen=1`,
    requestUrl: absoluteAppUrl(`/requests/${requestId}`),
  }
}

async function requesterContact(admin: AnyClient, requesterId: string): Promise<{ email: string; firstName: string } | null> {
  try {
    const [{ data: u }, { data: p }] = await Promise.all([
      admin.auth.admin.getUserById(requesterId),
      admin.from('profiles').select('full_name').eq('id', requesterId).maybeSingle(),
    ])
    const email: string | undefined = u?.user?.email
    if (!email) return null
    return { email, firstName: String(p?.full_name ?? '').split(' ')[0] || 'there' }
  } catch {
    return null
  }
}

/**
 * Called right after a ticket becomes Resolved. Creates (or restarts) the survey and sends the single "resolved + how did we do?" e-mail.
 * Returns whether that e-mail went out, so the caller can skip the plain "resolved" e-mail (and still send it as a fallback when not).
 */
export async function issueCsat(admin: AnyClient, ticket: CsatTicket, p: {
  resolutionNote: string
  resolverName: string
  /** ISO time the reopen window ends (null when the window is not used) */
  reopenDeadlineIso: string | null
  /** the ticket had been reopened before this resolution: ask again from scratch */
  wasReopened: boolean
  nowIso?: string
}): Promise<{ surveyId: string | null; emailed: boolean }> {
  const nowIso = p.nowIso ?? new Date().toISOString()
  const settings = await getCsatSettings()
  if (!settings.enabled) return { surveyId: null, emailed: false }

  let surveyId: string | null = null
  try {
    const { data: existing } = await admin.from('csat_surveys').select('id, submitted_at').eq('request_id', ticket.id).maybeSingle()
    if (!existing) {
      const { data: created, error } = await admin.from('csat_surveys')
        .insert({ org_id: ticket.orgId, request_id: ticket.id, requester_id: ticket.requesterId, sent_at: nowIso })
        .select('id').single()
      if (error) throw error
      surveyId = created.id
    } else {
      surveyId = existing.id
      // resolved again after a reopen: the earlier answer was about the earlier attempt, so ask again
      if (p.wasReopened) {
        const fresh = { rating: null, comment: null, submitted_at: null, sent_at: nowIso }
        const { error: resetError } = await admin.from('csat_surveys').update({ ...fresh, reminder_sent_at: null }).eq('id', existing.id)
        if (resetError) await admin.from('csat_surveys').update(fresh).eq('id', existing.id)
      }
    }
  } catch (e) {
    console.error('[csat] survey creation failed', e)
    return { surveyId: null, emailed: false }
  }
  if (!surveyId) return { surveyId: null, emailed: false }

  // a ticket the requester already rated needs no second e-mail
  const { data: row } = await admin.from('csat_surveys').select('submitted_at').eq('id', surveyId).maybeSingle()
  if (row?.submitted_at) return { surveyId, emailed: false }

  const links = buildCsatLinks(surveyId, ticket.id, new Date(nowIso).getTime())
  const who = await requesterContact(admin, ticket.requesterId)
  if (!links || !who) return { surveyId, emailed: false }

  const mail = csatResolvedEmail({
    recipientName: who.firstName, requestNo: ticket.requestNo, requestTitle: ticket.title, requestUrl: links.requestUrl,
    starUrls: links.starUrls, reopenUrl: links.reopenUrl, reopenUntil: p.reopenDeadlineIso ? fmtWhen(p.reopenDeadlineIso) : '',
    resolutionNote: p.resolutionNote.trim(), resolverName: p.resolverName, resolvedOn: fmtWhen(nowIso),
  })
  const res = await sendEmail({ to: who.email, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: ticket.requestNo })
  return { surveyId, emailed: !res.error }
}

/** The one reminder, for a ticket still resolved, not rated and not reopened. */
export async function sendCsatReminder(admin: AnyClient, p: {
  surveyId: string; requestId: string; requestNo: string; title: string; requesterId: string; resolvedAtMs: number; reopenDeadlineIso: string | null
}): Promise<boolean> {
  const links = buildCsatLinks(p.surveyId, p.requestId, p.resolvedAtMs)
  const who = await requesterContact(admin, p.requesterId)
  if (!links || !who) return false
  const mail = csatReminderEmail({
    recipientName: who.firstName, requestNo: p.requestNo, requestTitle: p.title, requestUrl: links.requestUrl,
    starUrls: links.starUrls, reopenUrl: links.reopenUrl, reopenUntil: p.reopenDeadlineIso ? fmtWhen(p.reopenDeadlineIso) : '',
  })
  const res = await sendEmail({ to: who.email, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: p.requestNo })
  return !res.error
}
