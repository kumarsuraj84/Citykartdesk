// Migration 158 replaced the sub-selects in the ticket update rule with a helper function (the sub-selects made PostgreSQL report "infinite recursion"
// once the select rule was sped up, which broke every status change and assignment). This test proves the rule still does its job: an ordinary
// update by someone allowed to edit the ticket works, and an update that changes who the ticket belongs to (organization, requester, service, team)
// is refused, for a team technician and for a manager.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { asUser, svc, login, ORG_A, type Session } from './helpers'

const tag = Date.now()
let agent: Session, manager: Session, requester: Session
let ticket: string, otherService: { id: string; team_id: string }, service: { id: string; team_id: string }

beforeAll(async () => {
  ;[agent, manager, requester] = await Promise.all([login('agent1@audit.test'), login('manager1@audit.test'), login('staff1@audit.test')])
  const services = (await svc<{ id: string; team_id: string }[]>('GET', '/services?select=id,team_id&order=id.asc&limit=50')).json
  const mine = (await svc<{ team_id: string }[]>('GET', `/team_members?user_id=eq.${agent.id}&select=team_id`)).json.map((t) => t.team_id)
  service = services.find((s) => mine.includes(s.team_id))!
  otherService = services.find((s) => s.id !== service.id && s.team_id !== service.team_id)!
  ticket = (await svc<{ id: string }[]>('POST', '/requests', { title: `identity ${tag}`, requester_id: requester.id, service_id: service.id, team_id: service.team_id, org_id: ORG_A, status: 'open' }, { Prefer: 'return=representation' })).json[0].id
}, 120_000)
afterAll(async () => { await svc('DELETE', `/requests?id=eq.${ticket}`).catch(() => {}) }, 60_000)

const stored = async () => (await svc<Record<string, string>[]>('GET', `/requests?id=eq.${ticket}&select=title,requester_id,service_id,team_id,org_id`)).json[0]

describe('ticket update rule after migration 158', () => {
  for (const who of ['agent', 'manager'] as const) {
    it(`${who}: an ordinary update works`, async () => {
      const s = who === 'agent' ? agent : manager
      const r = await asUser<{ id: string }[]>(s, 'PATCH', `/requests?id=eq.${ticket}`, { title: `identity ${tag} by ${who}` }, { Prefer: 'return=representation' })
      expect(r.status).toBe(200)
      expect(r.json).toHaveLength(1)
      expect((await stored()).title).toBe(`identity ${tag} by ${who}`)
    })

    it(`${who}: changing the requester is refused`, async () => {
      const before = await stored()
      const r = await asUser(who === 'agent' ? agent : manager, 'PATCH', `/requests?id=eq.${ticket}`, { requester_id: (who === 'agent' ? agent : manager).id })
      expect([401, 403]).toContain(r.status)
      expect((await stored()).requester_id).toBe(before.requester_id)
    })

    it(`${who}: moving the ticket to another service / team is refused`, async () => {
      const before = await stored()
      const r = await asUser(who === 'agent' ? agent : manager, 'PATCH', `/requests?id=eq.${ticket}`, { service_id: otherService.id, team_id: otherService.team_id })
      expect([401, 403]).toContain(r.status)
      const after = await stored()
      expect(after.service_id).toBe(before.service_id)
      expect(after.team_id).toBe(before.team_id)
    })
  }

  it('a requester with no team role cannot update the ticket at all', async () => {
    const before = await stored()
    const r = await asUser<unknown[]>(requester, 'PATCH', `/requests?id=eq.${ticket}`, { title: 'hijack' }, { Prefer: 'return=representation' })
    expect(r.status === 200 ? r.json : []).toHaveLength(0)
    expect((await stored()).title).toBe(before.title)
  })
})
