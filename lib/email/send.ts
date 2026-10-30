import { fetchWithTimeout } from '@/lib/http/fetch-timeout'
import nodemailer, { type Transporter } from 'nodemailer'
import { getEmailFrom, getEmailSetup, RESEND_API_KEY, type EmailSetup, type SmtpConfig } from './config'
import { withSubjectTag, isGmailHost, taggedReplyAddress } from './thread-tag'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

// LOCAL TESTING ONLY. With MAIL_SINK_DIR set, nothing is ever sent: every message is written to a file in that folder (to, cc, subject, html) and counts as sent,
// so a whole workflow can be tried on a development machine without a single e-mail leaving it. Ignored in a production build (NODE_ENV=production).
let sinkCounter = 0
async function writeToSink(dir: string, p: EmailPayload): Promise<void> {
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(dir, `${stamp}-${String(++sinkCounter).padStart(3, '0')}.json`)
  await writeFile(file, JSON.stringify({ to: p.to, cc: p.cc ?? [], subject: p.subject, text: p.text ?? '', html: p.html, attachments: (p.attachments ?? []).map((a) => a.filename) }, null, 2), 'utf8')
  console.log('[MAIL SINK] not sent, saved to', file, '| to:', recipientsLabel(p.to), '| subject:', p.subject)
}

export interface EmailPayload {
  /** One address, or several to send ONE message to all of them (they see each other, reply-all works). */
  to: string | string[]
  /** Copied people (company staff on an OEM mail). They get the same single message. */
  cc?: string | string[]
  subject: string
  html: string
  text?: string
  /** `content` is base64. */
  attachments?: { filename: string; content: string }[]
  /** Set on every ticket-related email — see thread-tag.ts. Tags the subject and, on
   *  Gmail, sets a Reply-To so a reply to this email lands back in this ticket's
   *  conversation (lib/email/inbound.ts) instead of being lost or opening a new ticket. */
  threadRequestNo?: string
}

// One pooled connection set per SMTP configuration, so a burst of notifications (e.g. a
// rule emailing every manager) reuses a few authenticated sessions instead of opening a
// new TLS connection per message — mail servers throttle those. When the saved mailbox
// changes, the next send builds a fresh transporter and retires the old one.
let cached: { key: string; transporter: Transporter } | null = null

function getTransporter(c: SmtpConfig): Transporter {
  const key = JSON.stringify([c.host, c.port, c.secure, c.user, c.pass])
  if (cached?.key === key) return cached.transporter
  cached?.transporter.close()

  const auth = c.user && c.pass ? { user: c.user, pass: c.pass } : undefined
  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth,
    // Never send the mailbox credentials over an unencrypted connection.
    requireTLS: !!auth && !c.secure,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    // Fail fast if the SMTP port is blocked instead of hanging the request.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  })
  cached = { key, transporter }
  return transporter
}

function recipientsLabel(to: string | string[]): string {
  return Array.isArray(to) ? to.join(', ') : to
}

/** threadRequestNo -> the actual subject/replyTo to send with (SMTP-provider-specific: only
 *  Gmail supports the "+tag" reply address our inbound sync polls). */
function applyThreadTag(p: EmailPayload, setup: EmailSetup): { subject: string; replyTo?: string } {
  if (!p.threadRequestNo) return { subject: p.subject }
  const subject = withSubjectTag(p.subject, p.threadRequestNo)
  const mailbox = setup.provider === 'smtp' ? setup.smtp?.user : null
  const replyTo =
    mailbox && setup.smtp && isGmailHost(setup.smtp.host)
      ? taggedReplyAddress(mailbox, p.threadRequestNo) ?? undefined
      : undefined
  return { subject, replyTo }
}

/** The bare address of "Name <a@b.com>" or "a@b.com", lower-cased, for comparing with what the mail server reports back. */
export function bareAddress(a: string): string {
  const m = /<([^>]+)>/.exec(a)
  return (m ? m[1] : a).trim().toLowerCase()
}

/** The To recipients the server refused. nodemailer reports a refused recipient in `info.rejected` (strings, or objects with an `address`) and still resolves,
 *  so without reading it a mail that reached nobody counted as sent. */
export function rejectedToRecipients(to: string | string[], rejected: unknown): string[] {
  if (!Array.isArray(rejected) || rejected.length === 0) return []
  const refused = new Set(rejected.map((r) => bareAddress(typeof r === 'string' ? r : String((r as { address?: string })?.address ?? ''))))
  return (Array.isArray(to) ? to : [to]).map(bareAddress).filter((a) => refused.has(a))
}

async function sendViaSmtp(p: EmailPayload, setup: EmailSetup): Promise<{ error?: string }> {
  const from = await getEmailFrom(setup)
  const { subject, replyTo } = applyThreadTag(p, setup)
  const info = await getTransporter(setup.smtp!).sendMail({
    from,
    to: p.to,
    ...(p.cc && p.cc.length ? { cc: p.cc } : {}),
    subject,
    html: p.html,
    text: p.text,
    replyTo,
    // automatic mail: other systems must not auto-answer it (VAPT VA-INT-09)
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    attachments: p.attachments?.map((a) => ({ filename: a.filename, content: a.content, encoding: 'base64' })),
  })
  // A refused To recipient is a failed send for that person even though the call itself succeeded. (Other recipients of the same message may have received it:
  // the caller is told which address failed so a retry can be aimed at it.)
  const refused = rejectedToRecipients(p.to, info?.rejected)
  if (refused.length > 0) return { error: `The mail server refused these recipients: ${refused.join(', ')}` }
  return {}
}

async function sendViaResend(p: EmailPayload, setup: EmailSetup): Promise<{ error?: string }> {
  const from = await getEmailFrom(setup)
  const { subject, replyTo } = applyThreadTag(p, setup)
  const res = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: p.to,
      ...(p.cc && p.cc.length ? { cc: p.cc } : {}),
      subject,
      html: p.html,
      text: p.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
      ...(p.attachments ? { attachments: p.attachments } : {}),
    }),
  })

  if (!res.ok) return { error: await res.text() }
  return {}
}

/** `skipped` is set when nothing was even tried because no mail provider is set up: that is NOT a sent mail, and a caller must not report it as one. */
export type SendResult = { error?: string; skipped?: boolean }

export const MAIL_NOT_SET_UP = 'E-mail is not set up (no mail provider is configured), so this message was not sent.'

export async function sendEmail(p: EmailPayload): Promise<SendResult> {
  try {
    const sinkDir = process.env.NODE_ENV !== 'production' ? (process.env.MAIL_SINK_DIR ?? '').trim() : ''
    if (sinkDir) { await writeToSink(path.resolve(sinkDir), p); return {} }
    const setup = await getEmailSetup()
    if (!setup.provider) {
      // Used to return success here, so callers posted "Ticket sent to OEM", moved the ticket on and never told anyone that no mail had gone out.
      console.log('[EMAIL DISABLED] To:', recipientsLabel(p.to), ' Subject:', p.subject)
      await logEmailAttempt(p, MAIL_NOT_SET_UP)
      return { error: MAIL_NOT_SET_UP, skipped: true }
    }
    const result = setup.provider === 'smtp' ? await sendViaSmtp(p, setup) : await sendViaResend(p, setup)
    await logEmailAttempt(p, result.error)
    return result
  } catch (e) {
    // A timeout can happen AFTER the mail server accepted the message, so an error here does not prove nothing was delivered: a caller that retries a
    // timed-out send can deliver the same mail twice. Callers that must not duplicate (OEM mails) keep their own "already sent" record.
    const error = e instanceof Error ? e.message : String(e)
    await logEmailAttempt(p, error)
    return { error }
  }
}

/** Every send attempt goes in the Admin > Event Log ("system"), so a missing email can be traced. */
async function logEmailAttempt(p: EmailPayload, error?: string): Promise<void> {
  try {
    const { recordEvents } = await import('@/lib/events/record')
    await recordEvents(
      [{ kind: error ? 'server_error' : 'system', target: recipientsLabel(p.to), message: error ? `Email FAILED: ${p.subject} — ${error}` : `Email sent: ${p.subject}` }],
      { orgId: null, userId: null },
    )
  } catch { /* logging must never affect sending */ }
}
