// Performance change (migration 158) must not change WHO sees WHICH ticket. For every kind of user, the tickets they get through the API (row security
// on, as the app's own user client) are compared with an independent calculation made in SQL, ticket by ticket, from the written visibility rules
// (own tickets, own team, manager/admin/platform_owner, collaborator, approver of the ticket, tickets of people who report to the user, tickets
// assigned to people who report to the user, all within the user's organization). The test passes before and after the migration: that is the proof.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { asUser, svc, login, ORG_A, type Session } from './helpers'

const psql = (sql: string) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
const tag = Date.now()
const cleanup: (() => unknown)[] = []

async function visibleViaApi(s: Session): Promise<string[]> {
  const ids: string[] = []
  for (let from = 0; ; from += 1000) {
    const r = await asUser<{ id: string }[]>(s, 'GET', `/requests?select=id&order=id.asc&limit=1000&offset=${from}`)
    if (r.status !== 200) throw new Error(`API ${r.status}: ${r.text.slice(0, 200)}`)
    ids.push(...r.json.map((x) => x.id))
    if (r.json.length < 1000) break
  }
  return ids
}

/** The written rules, calculated for an explicit user id (no row security involved). */
function expectedFor(userId: string): string[] {
  const out = psql(`
    with me as (select id, org_id, role from profiles where id = '${userId}'),
    teams as (select coalesce(array_agg(tm.team_id), '{}') ids from team_members tm join teams t on t.id = tm.team_id, me where tm.user_id = me.id and t.org_id = me.org_id),
    subs as (select coalesce(array_agg(p.id), '{}') ids from profiles p, me where p.manager_id = me.id and p.org_id = me.org_id)
    select r.id from requests r, me, teams, subs
    where r.org_id = me.org_id and me.id is not null and (
      r.requester_id = me.id
      or r.team_id = any(teams.ids)
      or me.role in ('manager','admin','platform_owner')
      or exists (select 1 from request_collaborators c where c.request_id = r.id and c.user_id = me.id)
      or exists (select 1 from approvals a join approval_workflow_steps s on s.workflow_id = a.workflow_id where a.request_id = r.id and s.approver_type = 'specific_user' and s.approver_user_id = me.id)
      or r.requester_id = any(subs.ids)
      or r.assigned_to = any(subs.ids))
    order by r.id`)
  return out ? out.split('\n') : []
}

let users: Record<string, Session> = {}
let special: { collabRequest: string; approverRequest: string; subordinateRequest: string }

beforeAll(async () => {
  const names = ['staff1', 'staff2', 'staff3', 'agent1', 'agent2', 'agent3', 'manager1', 'manager2', 'admin1']
  const logged = await Promise.all(names.map((n) => login(`${n}@audit.test`)))
  users = Object.fromEntries(names.map((n, i) => [n, logged[i]]))

  // fixtures that make the less common rules matter (all removed afterwards)
  const svcRow = (await svc<{ id: string; team_id: string }[]>('GET', '/services?select=id,team_id&limit=1')).json[0]
  const mk = async (title: string, requester: string, assignedTo?: string) =>
    (await svc<{ id: string }[]>('POST', '/requests', { title: `${title} ${tag}`, requester_id: requester, service_id: svcRow.id, team_id: svcRow.team_id, org_id: ORG_A, status: 'open', ...(assignedTo ? { assigned_to: assignedTo } : {}) }, { Prefer: 'return=representation' })).json[0].id
  // a ticket of staff3 that staff2 collaborates on
  const collabRequest = await mk('equiv collab', users.staff3.id)
  await svc('POST', '/request_collaborators', { request_id: collabRequest, user_id: users.staff2.id, added_by: users.agent1.id })
  // a ticket where agent3 is a named approver
  const approverRequest = await mk('equiv approver', users.staff3.id)
  const wf = (await svc<{ id: string }[]>('POST', '/approval_workflows', { name: `equiv ${tag}`, org_id: ORG_A }, { Prefer: 'return=representation' })).json[0].id
  await svc('POST', '/approval_workflow_steps', { workflow_id: wf, step_order: 1, approver_type: 'specific_user', approver_user_id: users.agent3.id })
  const approval = (await svc<{ id: string }[]>('POST', '/approvals', { request_id: approverRequest, workflow_id: wf, current_step: 1, status: 'pending' }, { Prefer: 'return=representation' })).json[0].id
  // staff3 reports to manager2: manager2 sees staff3's tickets through the "people who report to me" rule
  const before = await svc<{ manager_id: string | null }[]>('GET', `/profiles?id=eq.${users.staff3.id}&select=manager_id`)
  await svc('PATCH', `/profiles?id=eq.${users.staff3.id}`, { manager_id: users.agent3.id })
  const subordinateRequest = await mk('equiv subordinate', users.staff3.id)
  special = { collabRequest, approverRequest, subordinateRequest }

  cleanup.push(
    () => svc('DELETE', `/approvals?id=eq.${approval}`), () => svc('DELETE', `/approval_workflow_steps?workflow_id=eq.${wf}`), () => svc('DELETE', `/approval_workflows?id=eq.${wf}`),
    () => svc('DELETE', `/request_collaborators?request_id=eq.${collabRequest}`),
    () => svc('DELETE', `/requests?id=in.(${collabRequest},${approverRequest},${subordinateRequest})`),
    () => svc('PATCH', `/profiles?id=eq.${users.staff3.id}`, { manager_id: before.json[0].manager_id }),
  )
}, 120_000)
afterAll(async () => { for (const f of cleanup.reverse()) await Promise.resolve(f()).catch(() => {}) }, 60_000)

describe('every kind of user sees exactly the tickets the visibility rules give them', () => {
  for (const name of ['staff1', 'staff2', 'staff3', 'agent1', 'agent2', 'agent3', 'manager1', 'manager2', 'admin1']) {
    it(`${name}`, async () => {
      const api = await visibleViaApi(users[name])
      const expected = expectedFor(users[name].id)
      expect(api.length).toBe(expected.length)
      expect(api).toEqual(expected)
    }, 120_000)
  }

  it('the special rules are actually exercised (the comparison is not vacuous)', async () => {
    const staff2 = new Set(await visibleViaApi(users.staff2))
    expect(staff2.has(special.collabRequest)).toBe(true) // collaborator
    const agent3 = new Set(await visibleViaApi(users.agent3))
    expect(agent3.has(special.approverRequest)).toBe(true) // named approver
    expect(agent3.has(special.subordinateRequest)).toBe(true) // reports-to rule
    const staff1 = new Set(await visibleViaApi(users.staff1))
    expect(staff1.has(special.collabRequest) || staff1.has(special.approverRequest)).toBe(false) // an unrelated requester sees neither
  }, 120_000)
})
