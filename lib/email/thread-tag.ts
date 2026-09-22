// Marks an outbound ticket email so a reply to it can be matched back to that ticket —
// two independent signals, so either one covers the other's rare failure (the same
// belt-and-suspenders approach Zoho Desk/Zendesk/Freshdesk all use):
//   1. The ticket number in the subject line, e.g. "[CKSD-000032]" — survives almost
//      any reply, since mail clients keep the original subject (just add "Re: ").
//   2. A tagged Reply-To address, e.g. "citykartdesk+CKSD-000032@citykartstores.com" —
//      Gmail delivers "+tag" mail to the base mailbox and keeps the tag intact, so this
//      still works even if the subject line gets edited, forwarded, or mangled.
// See lib/email/inbound.ts for how a reply is matched back using these.

const SUBJECT_TAG_RE = /\[([A-Z]{2,10}-\d{3,8})\]/

export function subjectTag(requestNo: string): string {
  return `[${requestNo}]`
}

/** Adds the subject tag if it isn't already there (never double-tags a re-sent email). */
export function withSubjectTag(subject: string, requestNo: string): string {
  const tag = subjectTag(requestNo)
  return subject.includes(tag) ? subject : `${tag} ${subject}`
}

/** The request number embedded in a subject line, if any (from either the requester's
 *  own email or a reply to it — replies normally keep the tag, "Re: [CKSD-000032] ..."). */
export function parseRequestNoFromSubject(subject: string): string | null {
  return SUBJECT_TAG_RE.exec(subject)?.[1] ?? null
}

/** Only Gmail supports "+tag" delivery the way this needs — safe to skip for anything else. */
export function isGmailHost(host: string): boolean {
  return /(^|\.)gmail\.com$/i.test(host) || /(^|\.)google\.com$/i.test(host)
}

/** "citykartdesk@citykartstores.com" + "CKSD-000032" -> "citykartdesk+CKSD-000032@citykartstores.com" */
export function taggedReplyAddress(mailbox: string, requestNo: string): string | null {
  const at = mailbox.indexOf('@')
  if (at < 1) return null
  return `${mailbox.slice(0, at)}+${requestNo}${mailbox.slice(at)}`
}

/** The request number tagged onto a "user+CKSD-000032@domain"-style address, if any. */
export function parseRequestNoFromAddress(address: string): string | null {
  const m = /^[^+@]+\+([A-Z]{2,10}-\d{3,8})@/i.exec(address.trim())
  return m ? m[1].toUpperCase() : null
}
