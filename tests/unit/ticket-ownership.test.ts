import { describe, it, expect } from 'vitest'
import { ticketAccess, pickUpMessage, canCommentOn } from '@/lib/requests/ownership'

const T1 = 'team-1', T2 = 'team-2'
const base = { userId: 'me', teamIds: [T1], requestTeamId: T1 }

describe('who may work on a ticket', () => {
  it('the technician it is assigned to can work', () => {
    const a = ticketAccess({ ...base, role: 'agent', assignedTo: 'me' })
    expect(a).toMatchObject({ isOwner: true, canWork: true, mustPickUp: false, isStaff: true })
  })

  it('another technician of the group sees it but must pick it up first', () => {
    const a = ticketAccess({ ...base, role: 'agent', assignedTo: 'x' })
    expect(a).toMatchObject({ isGroupTechnician: true, isStaff: true, canWork: false, mustPickUp: true })
  })

  it('an unassigned ticket must be picked up by whoever wants to work on it', () => {
    const a = ticketAccess({ ...base, role: 'agent', assignedTo: null })
    expect(a).toMatchObject({ canWork: false, mustPickUp: true, isOwner: false })
  })

  it('managers, administrators and platform owners can always work, picked up or not', () => {
    for (const role of ['manager', 'admin', 'platform_owner']) {
      expect(ticketAccess({ ...base, role, teamIds: [], assignedTo: 'x' })).toMatchObject({ canWork: true, mustPickUp: false, isManager: true })
      expect(ticketAccess({ ...base, role, teamIds: [], assignedTo: null }).canWork).toBe(true)
    }
  })

  it('a technician of another group is not staff on this ticket and cannot work on it', () => {
    const a = ticketAccess({ ...base, role: 'agent', teamIds: [T2], assignedTo: 'me' })
    expect(a).toMatchObject({ isGroupTechnician: false, isStaff: false, canWork: false, mustPickUp: false })
  })

  it('an ordinary user (the requester) is not a technician and is not limited by this rule', () => {
    const a = ticketAccess({ ...base, role: 'user', teamIds: [], assignedTo: 'x' })
    expect(a).toMatchObject({ isStaff: false, canWork: false, mustPickUp: false })
  })

  it('a ticket with no group never counts a technician as a group member', () => {
    expect(ticketAccess({ ...base, role: 'agent', requestTeamId: null, assignedTo: 'me' }).canWork).toBe(false)
  })
})

describe('the message and the comment rule', () => {
  it('names the owner, or says nobody has picked it up', () => {
    expect(pickUpMessage('Ajay Kumar')).toBe('This ticket belongs to Ajay Kumar. Pick it up first to work on it.')
    expect(pickUpMessage(null)).toMatch(/Nobody has picked this ticket up yet/)
    expect(pickUpMessage('  ')).toMatch(/Nobody has picked this ticket up yet/)
  })

  it('a collaborator keeps the right to comment, the requester too; a plain group technician does not', () => {
    const a = ticketAccess({ ...base, role: 'agent', assignedTo: 'x' })
    expect(canCommentOn(a, { isCollaborator: false, isRequester: false })).toBe(false)
    expect(canCommentOn(a, { isCollaborator: true, isRequester: false })).toBe(true)
    expect(canCommentOn(a, { isCollaborator: false, isRequester: true })).toBe(true)
    const owner = ticketAccess({ ...base, role: 'agent', assignedTo: 'me' })
    expect(canCommentOn(owner, { isCollaborator: false, isRequester: false })).toBe(true)
  })
})
