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
