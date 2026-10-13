// Who a scheduled report may be e-mailed to. Audit finding D-012: the recipient list was stored and used with no checks, so a report holding
// the whole organization's tickets could be sent to any address on the Internet. Now every recipient must be a plain e-mail address that
// belongs to the organization itself (an active user, or an OEM contact kept in Master Data), at most MAX_REPORT_RECIPIENTS of them.

export const MAX_REPORT_RECIPIENTS = 20
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/

export type RecipientCheck = { ok: true; recipients: string[] } | { ok: false; error: string }

/** `isMember` says whether a (lower-case) address belongs to the organization. Duplicates are removed, order is kept. */
export function checkReportRecipients(raw: unknown, isMember: (email: string) => boolean): RecipientCheck {
  if (!Array.isArray(raw)) return { ok: false, error: 'Recipients must be a list of e-mail addresses.' }
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const email = typeof item === 'string' ? item.trim().toLowerCase() : ''
    if (!EMAIL_RE.test(email)) return { ok: false, error: `"${String(item).slice(0, 80)}" is not a valid e-mail address.` }
    if (!isMember(email)) return { ok: false, error: `${email} is not an address of this organisation. Reports can only be sent to your own users and OEM contacts.` }
    if (!seen.has(email)) { seen.add(email); out.push(email) }
  }
  if (out.length > MAX_REPORT_RECIPIENTS) return { ok: false, error: `A report can have at most ${MAX_REPORT_RECIPIENTS} recipients.` }
  return { ok: true, recipients: out }
}
