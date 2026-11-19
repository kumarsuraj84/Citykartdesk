import 'server-only'
/**
 * The server side of the ticket ownership rule (see ./ownership.ts): works out what a signed-in person may do on one ticket, and words the refusal.
 * Used by every server action that changes a ticket on behalf of a technician.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { ticketAccess, pickUpMessage, type TicketAccess } from './ownership'

type ActingProfile = { id: string; role: string; team_members: { team_id: string }[] }
type TicketRow = { team_id: string | null; assigned_to: string | null }

export function accessOf(profile: ActingProfile, request: TicketRow): TicketAccess {
  return ticketAccess({
    role: profile.role,
    userId: profile.id,
    teamIds: profile.team_members.map((m) => m.team_id),
    requestTeamId: request.team_id,
    assignedTo: request.assigned_to,
  })
}

/** "This ticket belongs to X. Pick it up first to work on it." (or "Nobody has picked this ticket up yet ...") */
export async function pickUpRefusal(request: TicketRow): Promise<string> {
  if (!request.assigned_to) return pickUpMessage(null)
  const { data } = await createAdminClient().from('profiles').select('full_name').eq('id', request.assigned_to).maybeSingle()
  // an owner whose name cannot be read is still an owner: never say "nobody" about a ticket that has someone
  return pickUpMessage((data as { full_name?: string | null } | null)?.full_name?.trim() || 'another technician')
}

/** null when the person may work on the ticket, otherwise the sentence to show them. */
export async function workRefusal(profile: ActingProfile, request: TicketRow): Promise<string | null> {
  const access = accessOf(profile, request)
  return access.mustPickUp ? pickUpRefusal(request) : null
}

/** Is this person added to the ticket as a collaborator? (They keep the right to comment.) */
export async function isCollaboratorOf(requestId: string, userId: string): Promise<boolean> {
  const { count } = await createAdminClient().from('request_collaborators').select('id', { count: 'exact', head: true }).eq('request_id', requestId).eq('user_id', userId)
  return (count ?? 0) > 0
}
