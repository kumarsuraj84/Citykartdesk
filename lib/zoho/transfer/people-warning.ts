// Pure (no database): which Zoho people on a preview CK Desk cannot recognise yet, so the Move page can say so BEFORE the move makes an empty inactive profile for them.
import type { TicketPlan } from './plan'

export type UnmatchedPerson = { name: string; tickets: number }

const collect = (names: (string | null)[]): UnmatchedPerson[] => {
  const by = new Map<string, UnmatchedPerson>()
  for (const raw of names) {
    if (raw === null) continue
    const key = raw.trim().toLowerCase()
    const hit = by.get(key)
    if (hit) hit.tickets++
    else by.set(key, { name: raw.trim(), tickets: 1 })
  }
  return [...by.values()].sort((a, b) => b.tickets - a.tickets || a.name.localeCompare(b.name))
}

/**
 * Requesters CK Desk will have to make an inactive profile for ("new-inactive"), and Zoho technicians that match nobody (their name in the conversation would also get a profile).
 * Tickets that are already moved are left out: nothing is made for them.
 */
export function unmatchedPeople(plans: TicketPlan[]): { requesters: UnmatchedPerson[]; technicians: UnmatchedPerson[] } {
  const todo = plans.filter((p) => !p.problems.some((x) => x.code === 'already_moved'))
  return {
    requesters: collect(todo.map((p) => (p.requester.how === 'new-inactive' ? p.requester.name || p.requester.email || '(no name in Zoho)' : null))),
    technicians: collect(todo.map((p) => (p.technician.zohoName && p.technician.how === 'none' ? p.technician.zohoName : null))),
  }
}
