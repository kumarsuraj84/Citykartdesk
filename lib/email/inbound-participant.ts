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

/** An address is covered when it is one of the mailed addresses, or sits on the same company domain as one (a shared mail domain such as gmail.com never counts as one company). */
function coveredByMailed(email: string, mailed: string[]): boolean {
  if (mailed.includes(email)) return true
  const domain = domainOfAddress(email)
  return !!domain && !SHARED_MAIL_DOMAINS.has(domain) && mailed.some((a) => domainOfAddress(a) === domain)
}

/**
 * Who the OEM contacts of a ticket are, from the records the system itself wrote when it mailed the ticket (C-24): the program snapshot (to and cc) and the AC /
 * Genset snapshot (to). Returns null when the ticket has no such record at all (a ticket from before the snapshots existed).
 * The public comment "Ticket sent to the ... OEM" used to be the only source, and anybody who can post a public comment could forge it.
 */
export async function snapshotMailedAddresses(admin: AnyClient, ticketId: string): Promise<string[] | null> {
  const [prog, master] = await Promise.all([
    admin.from('request_program_snapshots').select('mailed_to, mailed_cc').eq('request_id', ticketId),
    admin.from('request_master_snapshots').select('mailed_to').eq('request_id', ticketId),
  ])
  const progRows = (prog?.data ?? []) as { mailed_to: string[] | null; mailed_cc: string[] | null }[]
  const masterRows = (master?.data ?? []) as { mailed_to: string[] | null }[]
  if (progRows.length === 0 && masterRows.length === 0) return null
  const all = [
    ...progRows.flatMap((r) => [...(r.mailed_to ?? []), ...(r.mailed_cc ?? [])]),
    ...masterRows.flatMap((r) => r.mailed_to ?? []),
  ]
  return all.map((a) => a.trim().toLowerCase()).filter(Boolean)
}

export async function senderMayReply(admin: AnyClient, ticket: ReplyTicket, sender: ReplySender): Promise<boolean> {
  if (sender.kind === 'oem') {
    // The system's own record of who the ticket was mailed to decides when there is one. Only a ticket with no such record (older than the snapshots) falls
    // back to the wording of the "Ticket sent to ..." comment below.
    const mailed = await snapshotMailedAddresses(admin, ticket.id)
    if (mailed) {
      const who = (sender.email ?? '').trim().toLowerCase()
      return !!who && coveredByMailed(who, mailed)
    }
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
