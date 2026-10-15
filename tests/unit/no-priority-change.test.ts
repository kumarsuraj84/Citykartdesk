import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The priority of a ticket comes from its sub-category (and the SLA that goes with it) or from a Business Rule. Nobody changes it by hand once the ticket exists:
// not a technician, not a manager, not an admin. These checks keep the door shut.
describe('the priority of a ticket cannot be changed by hand', () => {
  const actions = readFileSync('lib/actions/requests.ts', 'utf8')
  const panel = readFileSync('components/requests/RequestSidebarPanel.tsx', 'utf8')
  const table = readFileSync('components/requests/RequestsTable.tsx', 'utf8')

  it('there is no server action that changes a ticket\'s priority (single or bulk)', () => {
    expect(actions).not.toMatch(/export async function changePriority/)
    expect(actions).not.toMatch(/export async function bulkChangePriority/)
    expect(actions).not.toMatch(/priority_changed/)
  })
  it('the side panel only shows the priority (no dropdown, no call to change it)', () => {
    expect(panel).not.toMatch(/changePriority/)
    expect(panel).toMatch(/function PriorityRow\(\{ priority \}/)
  })
  it('the list has no "Change Priority" bulk action', () => {
    expect(table).not.toMatch(/bulkChangePriority/)
    expect(table).not.toMatch(/Change Priority/)
  })
  it('the priority still follows the sub-category (that is how it is set automatically)', () => {
    expect(actions).toMatch(/export async function updateRequestCategory/)
    expect(actions).toMatch(/sla_priority/)
  })
})
