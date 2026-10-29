// Who may add a reply to a ticket by e-mail? (VAPT VA-INT-02)
// A reply used to be accepted from ANY active employee (and from anyone at ANY listed OEM) as long as the subject carried the ticket number, which is
// easy to guess. Now the sender must be a person who takes part in this ticket, the same people who could write in the portal:
//   the requester, the assignee, a collaborator, a member of the ticket's technician group, or a manager / admin / platform owner;
//   an OEM only when this ticket was actually sent to that OEM.


// the e-mail sync passes its own minimal client type, so the helper only needs .from()
import { domainOfAddress, SHARED_MAIL_DOMAINS } from '@/lib/email/inbound-match'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (table: string) => any }

export type ReplySender = { kind: 'profile'; profileId: string } | { kind: 'oem'; name: string; email?: string }
export type ReplyTicket = { id: string; requester_id: string | null; assigned_to: string | null; team_id: string | null }

const STAFF_WIDE = new Set(['manager', 'admin', 'platform_owner'])

/** The addresses in the "To:" line of the note "Ticket sent to the AC / Genset OEM for servicing." (lower case). */
export function oemNoteRecipients(body: string): string[] {
  const line = /^To: ?(.*)$/m.exec(body ?? '')
  if (!line) return []
  return (line[1].match(/[^\s,;<>"']+@[^\s,;<>"']+/g) ?? []).map((a) => a.toLowerCase())
}

export async function senderMayReply(admin: AnyClient, ticket: ReplyTicket, sender: ReplySender): Promise<boolean> {
  if (sender.kind === 'oem') {
    // an older note reads "Ticket sent to <OEM name> (...)"
    const { data } = await admin.from('request_comments').select('id').eq('request_id', ticket.id).ilike('body', `%Ticket sent to ${escapeLike(sender.name)}%`).limit(1)
    if ((data ?? []).length > 0) return true
    // the note written for the AC / Genset sheets reads "Ticket sent to the AC OEM for servicing." and lists the addresses it went to: an OEM that was mailed
    // may answer, from that address or from another address of the same company (a shared mail domain such as gmail.com never counts as one company)
    const email = (sender.email ?? '').trim().toLowerCase()
    if (!email) return false
    const { data: notes } = await admin.from('request_comments').select('body').eq('request_id', ticket.id).ilike('body', 'Ticket sent to the % OEM for servicing.%').limit(10)
    const to = ((notes ?? []) as { body: string }[]).flatMap((n) => oemNoteRecipients(n.body))
    if (to.includes(email)) return true
    const domain = domainOfAddress(email)
    return !!domain && !SHARED_MAIL_DOMAINS.has(domain) && to.some((a) => domainOfAddress(a) === domain)
  }
  const id = sender.profileId
  if (id === ticket.requester_id || id === ticket.assigned_to) return true
  const { data: profile } = await admin.from('profiles').select('role, is_active').eq('id', id).maybeSingle()
  if (!profile || profile.is_active === false) return false
  if (STAFF_WIDE.has(profile.role as string)) return true
  const { data: collab } = await admin.from('request_collaborators').select('id').eq('request_id', ticket.id).eq('user_id', id).limit(1)
  if ((collab ?? []).length > 0) return true
  if (ticket.team_id) {
    const { data: member } = await admin.from('team_members').select('user_id').eq('team_id', ticket.team_id).eq('user_id', id).limit(1)
    if ((member ?? []).length > 0) return true
  }
  return false
}

/** % and _ are wildcards in LIKE: an OEM name must match literally. */
function escapeLike(s: string): string { return s.replace(/[\\%_]/g, (c) => `\\${c}`) }
