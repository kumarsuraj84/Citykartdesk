// VAPT VA-INT-02: an e-mailed reply is accepted only from someone who takes part in the ticket. (Logic level: the audit stack has no mailbox.)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'
import { senderMayReply } from '@/lib/email/inbound-participant'

let fx: D03Fixtures
beforeAll(async () => { fx = await setupD03Fixtures() }, 180_000)
afterAll(async () => { await fx?.cleanup() }, 120_000)

const ticket = async () => (await getAdmin().from('requests').select('id, requester_id, assigned_to, team_id').eq('id', fx.requestA.id).single()).data!

describe('who may reply to a ticket by e-mail', () => {
  it('the requester, the assignee, a technician of the group and a manager may', async () => {
    const t = await ticket()
    for (const id of [fx.requesterA.id, fx.agentA.id, fx.manager.id, fx.admin.id]) expect(await senderMayReply(getAdmin(), t, { kind: 'profile', profileId: id }), id).toBe(true)
  })
  it('an unrelated employee and a technician of another group may not (a guessed ticket number is not enough)', async () => {
    const t = await ticket()
    expect(await senderMayReply(getAdmin(), t, { kind: 'profile', profileId: fx.requesterB.id })).toBe(false)
    expect(await senderMayReply(getAdmin(), t, { kind: 'profile', profileId: fx.agentB.id })).toBe(false)
  })
  it('a collaborator may', async () => {
    const t = await ticket()
    await getAdmin().from('request_collaborators').insert({ request_id: t.id, user_id: fx.requesterB.id, added_by: fx.agentA.id })
    expect(await senderMayReply(getAdmin(), t, { kind: 'profile', profileId: fx.requesterB.id })).toBe(true)
    await getAdmin().from('request_collaborators').delete().eq('request_id', t.id).eq('user_id', fx.requesterB.id)
  })
  it('an OEM may answer only a ticket that was sent to it', async () => {
    const t = await ticket()
    expect(await senderMayReply(getAdmin(), t, { kind: 'oem', name: 'Acme Cooling' })).toBe(false)
    await getAdmin().from('request_comments').insert({ request_id: t.id, author_id: fx.agentA.id, body: 'Ticket sent to Acme Cooling (service@acme.test) for servicing.', is_internal: true })
    expect(await senderMayReply(getAdmin(), t, { kind: 'oem', name: 'Acme Cooling' })).toBe(true)
    expect(await senderMayReply(getAdmin(), t, { kind: 'oem', name: 'Other Vendor' })).toBe(false)
    expect(await senderMayReply(getAdmin(), t, { kind: 'oem', name: '%' })).toBe(false)            // a wildcard in the name matches nothing special
  })
})
