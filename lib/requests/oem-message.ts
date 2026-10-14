import { withSubjectTag } from '@/lib/email/thread-tag'

/**
 * What the ticket's conversation shows when a ticket is e-mailed to an OEM: the short line it always had, followed by the e-mail itself (subject as
 * the OEM sees it, who it went to, and the full message), so nobody has to ask what was actually sent. Plain text; the page shows it as written.
 */
export function oemSentComment(p: { oemName: string; emails: string[]; subject: string; requestNo: string; body: string }): string {
  const to = p.emails.join(', ')
  return [
    `Ticket sent to ${p.oemName} (${to}) for servicing.`,
    '',
    `Subject: ${withSubjectTag(p.subject, p.requestNo)}`,
    `To: ${to}`,
    '',
    p.body.trim(),
  ].join('\n')
}
