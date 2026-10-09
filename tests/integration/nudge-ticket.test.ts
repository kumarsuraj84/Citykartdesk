/**
 * Smart Dashboard "Nudge": a reminder to the technician handling a ticket. Against the real database:
 * who gets it (the technician, or the group leads when nobody has it), the bell + the e-mail, the cooldown,
 * and who may send one at all.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

const sent: { to: string; subject: string; html: string }[] = []
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; html: string }) => { sent.push(p); return {} }),
}))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const currentProfile = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: vi.fn(async () => currentProfile.value), getEnabledModules: vi.fn(async () => ['requests']) }))

import { nudgeTicket } from '@/lib/actions/executiveDashboard'

const settle = () => new Promise((r) => setTimeout(r, 700))

describe('Nudge from the Smart Dashboard', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  async function profileOf(id: string) {
    const { data } = await admin.from('profiles').select('*, team_members(team_id, is_lead, joined_at, team:teams(*))').eq('id', id).single()
    return data
  }
  const openTicket = (o: { assignedTo?: string | null; status?: string } = {}) =>
    seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: o.assignedTo === undefined ? fx.agentA.id : o.assignedTo, status: (o.status ?? 'in_progress') as never })

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    fx = await setupD03Fixtures()
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)
  beforeEach(async () => { sent.length = 0; currentProfile.value = await profileOf(fx.admin.id) })

  it('reminds the technician handling the ticket, by bell and by e-mail, with the manager\'s message', async () => {
    const req = await openTicket()
    const res = await nudgeTicket(req.id, 'The store has been waiting since morning.')
    expect(res).toMatchObject({ sent: 1 })
    await settle()

    const { data: bell } = await admin.from('notifications').select('user_id, title, body, metadata').eq('request_id', req.id).eq('type', 'sla_warning')
    expect(bell).toHaveLength(1)
    expect(bell![0].user_id).toBe(fx.agentA.id)
    expect(bell![0].body).toContain('The store has been waiting since morning.')

    const mail = sent.find((m) => m.to.toLowerCase() === fx.agentA.email.toLowerCase())
    expect(mail, 'the technician got no e-mail').toBeTruthy()
    expect(mail!.subject).toMatch(/^Reminder from/)
    expect(mail!.html).toContain('The store has been waiting since morning.')
    expect(mail!.html).not.toMatch(/SLA/i) // it is a reminder, not an SLA alert
  })

  it('refuses a second nudge on the same ticket within the cooldown, and says when it was sent', async () => {
    const req = await openTicket()
    expect(await nudgeTicket(req.id, '')).toMatchObject({ sent: 1 })
    const again = await nudgeTicket(req.id, '')
    expect('error' in again && again.error).toMatch(/already nudged/i)
    const { data: bell } = await admin.from('notifications').select('id').eq('request_id', req.id).eq('type', 'sla_warning')
    expect(bell).toHaveLength(1)
  })

  it('cannot nudge a ticket that is not waiting on a technician', async () => {
    for (const status of ['resolved', 'waiting_user'] as const) {
      const req = await openTicket({ status })
      const res = await nudgeTicket(req.id, '')
      expect('error' in res && res.error).toMatch(/no one to nudge/i)
    }
  })

  it('a ticket nobody has picked up goes to the group leads; with no lead there is no one to nudge', async () => {
    await admin.from('team_members').update({ is_lead: false }).eq('team_id', fx.teamA.id)
    const noLead = await openTicket({ assignedTo: null, status: 'open' })
    expect('error' in (await nudgeTicket(noLead.id, '')) ).toBe(true)

    await admin.from('team_members').update({ is_lead: true }).eq('team_id', fx.teamA.id).eq('user_id', fx.agentA.id)
    const withLead = await openTicket({ assignedTo: null, status: 'open' })
    expect(await nudgeTicket(withLead.id, '')).toMatchObject({ sent: 1 })
    const { data: bell } = await admin.from('notifications').select('user_id').eq('request_id', withLead.id).eq('type', 'sla_warning')
    expect(bell!.map((b: { user_id: string }) => b.user_id)).toEqual([fx.agentA.id])
  })

  it('you cannot nudge yourself', async () => {
    const req = await openTicket()
    currentProfile.value = await profileOf(fx.agentA.id)
    const res = await nudgeTicket(req.id, '')
    expect('error' in res && res.error).toMatch(/no one else/i)
  })

  it('a requester cannot nudge, and nobody can nudge a ticket outside what they can see', async () => {
    const req = await openTicket()
    currentProfile.value = await profileOf(fx.requesterA.id)
    const asRequester = await nudgeTicket(req.id, '')
    expect('error' in asRequester && asRequester.error).toMatch(/permission/i)

    // a technician of group B does not see group A's ticket
    currentProfile.value = await profileOf(fx.agentB.id)
    const outside = await nudgeTicket(req.id, '')
    expect('error' in outside && outside.error).toMatch(/not available/i)
  })

  it('the message is trimmed to 300 characters', async () => {
    const req = await openTicket()
    await nudgeTicket(req.id, 'x'.repeat(500))
    const { data: bell } = await admin.from('notifications').select('metadata').eq('request_id', req.id).eq('type', 'sla_warning')
    expect(((bell![0].metadata as { note: string }).note).length).toBe(300)
  })
})
