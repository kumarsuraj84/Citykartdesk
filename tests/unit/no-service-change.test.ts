import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Every service has its own mandatory form, so the service of a ticket is never changed (not by a technician, a manager or an admin): a ticket raised against the
// wrong service is cancelled and raised again. Only the category and sub-category can be changed. These checks keep the door shut.
describe('the service of a ticket cannot be changed', () => {
  const actions = readFileSync('lib/actions/requests.ts', 'utf8')
  const panel = readFileSync('components/requests/RequestSidebarPanel.tsx', 'utf8')
  const page = readFileSync('app/(app)/requests/[id]/page.tsx', 'utf8')

  it('there is no server action that changes a ticket\'s service', () => {
    expect(actions).not.toMatch(/export async function reclassifyRequest/)
    expect(actions).not.toMatch(/service_id:\s*newServiceId/)
  })
  it('the side panel only shows the service (no picker, no call to change it)', () => {
    expect(panel).not.toMatch(/reclassifyRequest/)
    expect(panel).toMatch(/function ServiceRow\(\{ serviceName \}/)
  })
  it('the ticket page no longer loads a list of services to move to', () => {
    expect(page).not.toMatch(/getActiveServicesForReclassify/)
    expect(page).not.toMatch(/reclassifyOptions/)
  })
  it('the category and sub-category can still be changed (that is what sends the ticket to the right person)', () => {
    expect(actions).toMatch(/export async function updateRequestCategory/)
  })
})
