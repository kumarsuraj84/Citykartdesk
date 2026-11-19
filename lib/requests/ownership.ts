/**
 * Who may WORK on a ticket (change its status, comment as the technician, edit its details, send it for approval, add files, reassign it).
 *
 * The rule (owner's decision, 2026-11-19):
 *  - Every technician of the ticket's group can SEE the ticket with everything in it (details, status, history, conversation, internal notes), whoever it belongs to.
 *  - But only the technician it is assigned to can work on it. Another technician of the group, or any technician when it is unassigned, must press "Pick up" first:
 *    that makes the ticket theirs (the previous owner is told) and from then on they can do everything.
 *  - Managers, administrators and platform owners can always work on any ticket (they step in on a stuck ticket without picking it up).
 *  - People added to the ticket as collaborators keep their access (they may comment) - see `canCommentOn`.
 *  - The requester is not a technician and is not affected: this only limits technicians.
 *  - Vendor technicians work through their own screens and only on tickets assigned to them, so they are owners by definition and are not handled here.
 *
 * Pure (no database): the server actions and the ticket page both call it, so the screen and the server always agree.
 */

export const MANAGER_ROLES = ['manager', 'admin', 'platform_owner'] as const

export type OwnershipInput = {
  /** the viewer's role */
  role: string
  /** the viewer's id */
  userId: string
  /** the groups (teams) the viewer belongs to */
  teamIds: readonly string[]
  /** the ticket's group */
  requestTeamId: string | null
  /** who the ticket is assigned to now (null = nobody) */
  assignedTo: string | null
}

export type TicketAccess = {
  /** manager, administrator or platform owner */
  isManager: boolean
  /** a technician of the ticket's group */
  isGroupTechnician: boolean
  /** can see the ticket the way staff see it (group technician or manager) */
  isStaff: boolean
  /** the ticket is assigned to this viewer */
  isOwner: boolean
  /** may change the ticket: a manager, or the technician it is assigned to */
  canWork: boolean
  /** a group technician who is not the owner: sees everything, changes nothing until "Pick up" */
  mustPickUp: boolean
}

export function ticketAccess(i: OwnershipInput): TicketAccess {
  const isManager = (MANAGER_ROLES as readonly string[]).includes(i.role)
  const isGroupTechnician = i.role === 'agent' && !!i.requestTeamId && i.teamIds.includes(i.requestTeamId)
  const isStaff = isManager || isGroupTechnician
  const isOwner = i.assignedTo !== null && i.assignedTo === i.userId
  const canWork = isManager || (isGroupTechnician && isOwner)
  return { isManager, isGroupTechnician, isStaff, isOwner, canWork, mustPickUp: isGroupTechnician && !canWork }
}

/** The line shown (and returned by the server) to a technician who has to pick the ticket up first. */
export function pickUpMessage(ownerName: string | null | undefined): string {
  const name = (ownerName ?? '').trim()
  return name
    ? `This ticket belongs to ${name}. Pick it up first to work on it.`
    : 'Nobody has picked this ticket up yet. Pick it up first to work on it.'
}

/**
 * A comment: the owner and managers (as before), a collaborator (keeps the access they had), and of course the requester. A group technician who is not the owner
 * and is not a collaborator may not comment before picking the ticket up.
 */
export function canCommentOn(access: TicketAccess, opts: { isCollaborator: boolean; isRequester: boolean }): boolean {
  if (!access.mustPickUp) return true
  return opts.isCollaborator || opts.isRequester
}
