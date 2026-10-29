import { parseRequestNoFromSubject, parseRequestNoFromAddress } from './thread-tag'

/** The one piece of information we need out of a raw inbound email to try matching it. */
export type InboundEmailHeaders = {
  subject: string
  /** Every address the message was sent To/Cc — a plus-tagged reply address could be in either. */
  toAddresses: string[]
  fromAddress: string
}

/** Finds the ticket number tagged into this email, from either signal — subject first
 *  (the common case), the tagged address as a fallback. Returns null if neither is present. */
export function findTaggedRequestNo(headers: InboundEmailHeaders): string | null {
  const fromSubject = parseRequestNoFromSubject(headers.subject)
  if (fromSubject) return fromSubject
  for (const addr of headers.toAddresses) {
    const tagged = parseRequestNoFromAddress(addr)
    if (tagged) return tagged
  }
  return null
}

export type KnownSender =
  | { kind: 'profile'; profileId: string; name: string }
  | { kind: 'oem'; name: string }
  | { kind: 'unknown' }

/** Looks up who sent this, against a prebuilt map of the org's known people/OEM contacts —
 *  case-insensitive on the email address, exact match only (no substring/domain matching —
 *  a look-alike address must never be trusted). Checked BEFORE we ever add an emailed reply
 *  to a ticket's conversation, so a stranger can't inject text into someone else's ticket
 *  just by putting the right tag in a subject line. */
export function resolveKnownSender(
  fromAddress: string,
  profilesByEmail: Map<string, { id: string; name: string }>,
  oemNameByEmail: Map<string, string>,
): KnownSender {
  const email = fromAddress.trim().toLowerCase()
  const profile = profilesByEmail.get(email)
  if (profile) return { kind: 'profile', profileId: profile.id, name: profile.name }
  const oemName = oemNameByEmail.get(email)
  if (oemName) return { kind: 'oem', name: oemName }
  return { kind: 'unknown' }
}

// ── An OEM's colleagues ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// An OEM often answers from a service desk or a colleague's address rather than the one listed for them. When the mail server has CONFIRMED the
// message really came from that company's own domain (DMARC pass, or a DKIM / SPF pass for that domain), the domain of a listed OEM contact is
// trusted for replies about our tickets. A shared mail domain (gmail.com ...) is never trusted this way, and neither is a domain two different
// OEMs list. Without the confirmation nothing changes: only exactly listed addresses are accepted.

export const SHARED_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'rediffmail.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'mail.com',
])

export const domainOfAddress = (address: string): string => {
  const at = address.lastIndexOf('@')
  return at < 0 ? '' : address.slice(at + 1).trim().toLowerCase()
}

/** company domain -> OEM name, from the OEM contact addresses; shared mail domains and domains claimed by two OEMs are left out */
export function oemNameByDomain(oemNameByEmail: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  const clash = new Set<string>()
  for (const [email, name] of oemNameByEmail) {
    const d = domainOfAddress(email)
    if (!d || SHARED_MAIL_DOMAINS.has(d)) continue
    const known = out.get(d)
    if (known !== undefined && known !== name) clash.add(d)
    out.set(d, name)
  }
  for (const d of clash) out.delete(d)
  return out
}

/** The OEM whose company domain this (authenticated) sender is on, or null */
export function resolveOemByDomain(fromAddress: string, byDomain: Map<string, string>): { kind: 'oem'; name: string } | null {
  const name = byDomain.get(domainOfAddress(fromAddress))
  return name ? { kind: 'oem', name } : null
}

/** Is it worth leaving a note on the ticket about a reply we did not add? Only for a sender at a company we actually deal with (an OEM contact's
 *  domain or a Citykart user's domain): a stranger tagging a subject line must not be able to write on tickets, not even a note. */
export function isPlausibleSender(fromAddress: string, oemNameByEmail: Map<string, string>, profileEmails: Iterable<string>): boolean {
  const d = domainOfAddress(fromAddress)
  if (!d) return false
  for (const e of oemNameByEmail.keys()) if (domainOfAddress(e) === d) return true
  for (const e of profileEmails) if (domainOfAddress(e) === d && !SHARED_MAIL_DOMAINS.has(d)) return true
  return false
}
