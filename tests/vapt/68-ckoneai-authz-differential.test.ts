// CKOneAI assistant: what CK Desk's REAL row security lets each person read, compared with the simple per-person filters the assistant's tools use
// (gold_ckdesk: tickets by requester_id, or by assigned_to_id for a technician). Runs on the isolated audit stack only.
//   - a "leak" would be a ticket / approval / survey the tool shows that CK Desk itself would NOT show that person: none is allowed (hard assertions);
//   - an "under-disclosure" is something CK Desk shows but the tool does not: safe, but the owner must know (documented as facts, so a future rule change is noticed).
// The findings are also written to docs/ckoneai-desk/evidence/authz-differential.json.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'
import { clientForToken } from '../setup/fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t68${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const ids: Record<string, string> = {}
const cleanup: (() => Promise<void>)[] = []
type Who = 'requesterA' | 'requesterB' | 'agentA' | 'agentB' | 'manager' | 'admin' | 'platformOwner'
const WHO: Who[] = ['requesterA', 'requesterB', 'agentA', 'agentB', 'manager', 'admin', 'platformOwner']
const findings: Record<string, unknown> = {}

const seesRequests = async (u: { accessToken: string }): Promise<Set<string>> => {
  const { data, error } = await clientForToken(u.accessToken).from('requests').select('id').in('id', Object.values(ids).filter((v) => v.startsWith('req:')).map((v) => v.slice(4)))
  expect(error).toBeNull()
  return new Set((data ?? []).map((r: { id: string }) => r.id))
}
const rid = (k: string) => ids[k].slice(4)

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  const mk = async (key: string, requester: string, team: { id: string; serviceId: string }, assigned: string | null, status = 'in_progress') => {
    const r = (await a.from('requests').insert({ request_no: '', title: `${tag} ${key}`, requester_id: requester, service_id: team.serviceId, team_id: team.id, org_id: fx.orgId, assigned_to: assigned, status, priority: 'low' }).select('id').single()).data
    ids[key] = 'req:' + r.id
  }
  // the fixture already holds requestA (requesterA -> agentA, team A) and requestB (requesterB -> agentB, team B)
  ids.A1 = 'req:' + fx.requestA.id
  ids.B1 = 'req:' + fx.requestB.id
  await mk('A2_unassigned_requesterA', fx.requesterA.id, fx.teamA, null)
  await mk('A3_requesterB_on_teamA_assignedAgentA', fx.requesterB.id, fx.teamA, fx.agentA.id)
  await mk('A4_requesterB_on_teamA_unassigned', fx.requesterB.id, fx.teamA, null)
  await mk('A5_raised_by_agentA_on_teamB_assignedAgentB', fx.agentA.id, fx.teamB, fx.agentB.id)

  // an approval of A2 whose step names agentB (a person of the OTHER team) as the approver
  const wf = (await a.from('approval_workflows').insert({ org_id: fx.orgId, name: `${tag} flow` }).select('id').single()).data
  await a.from('approval_workflow_steps').insert({ workflow_id: wf.id, step_order: 1, approver_type: 'specific_user', approver_user_id: fx.agentB.id })
  const ap = (await a.from('approvals').insert({ request_id: rid('A2_unassigned_requesterA'), workflow_id: wf.id, current_step: 1, status: 'pending', requested_by: fx.requesterA.id }).select('id').single()).data
  ids.approval = ap.id
  cleanup.push(async () => { await a.from('approvals').delete().eq('id', ap.id); await a.from('approval_workflow_steps').delete().eq('workflow_id', wf.id); await a.from('approval_workflows').delete().eq('id', wf.id) })

  // two surveys: A1 (requesterA) rated 5, A3 (requesterB) rated 3
  const now = new Date().toISOString()
  const sv = await a.from('csat_surveys').insert([
    { org_id: fx.orgId, request_id: rid('A1'), requester_id: fx.requesterA.id, rating: 5, sent_at: now, submitted_at: now },
    { org_id: fx.orgId, request_id: rid('A3_requesterB_on_teamA_assignedAgentA'), requester_id: fx.requesterB.id, rating: 3, sent_at: now, submitted_at: now },
  ]).select('id')
  const svIds = (sv.data ?? []).map((r: { id: string }) => r.id)
  cleanup.push(async () => { await a.from('csat_surveys').delete().in('id', svIds) })
}, 240_000)

afterAll(async () => {
  const a = db()
  for (const c of cleanup.reverse()) await c().catch(() => undefined)
  const reqIds = Object.values(ids).filter((v) => v.startsWith('req:')).map((v) => v.slice(4)).filter((x) => x !== fx?.requestA.id && x !== fx?.requestB.id)
  if (reqIds.length) await a.from('requests').delete().in('id', reqIds)
  await fx?.cleanup()
  writeFileSync(path.join(__dirname, '../../docs/ckoneai-desk/evidence/authz-differential.json'), JSON.stringify({ stack: 'isolated audit stack (synthetic data)', generated: new Date().toISOString(), findings }, null, 1))
}, 180_000)

describe('tickets: what CK Desk shows vs the assistant\'s per-person filters', () => {
  it('the assistant never shows a ticket CK Desk would not show that person (no leak), for every kind of person', async () => {
    const table: Record<string, unknown> = {}
    for (const who of WHO) {
      const u = fx[who]
      const rls = await seesRequests(u)
      const raised = new Set(Object.values(ids).filter((v) => v.startsWith('req:')).map((v) => v.slice(4)))
      const { data: mine } = await db().from('requests').select('id, requester_id, assigned_to').in('id', [...raised])
      const requesterTool = new Set<string>(mine.filter((r: { requester_id: string }) => r.requester_id === u.id).map((r: { id: string }) => r.id))
      const assignedTool = new Set<string>(mine.filter((r: { assigned_to: string }) => r.assigned_to === u.id).map((r: { id: string }) => r.id))
      const tool = new Set<string>([...requesterTool, ...assignedTool])
      for (const t of tool) expect(rls.has(t), `${who}: tool shows ${t} that CK Desk hides`).toBe(true)   // hard rule: tool subset of CK Desk
      const label = (set: Set<string>) => Object.entries(ids).filter(([, v]) => set.has(v.slice(4))).map(([k]) => k).sort()
      table[who] = { ck_desk_shows: label(rls), tool_raised_by_me: label(requesterTool), tool_assigned_to_me: label(assignedTool), ck_desk_shows_but_tool_does_not: label(new Set([...rls].filter((x) => !tool.has(x)))) }
    }
    findings.tickets = table
    // facts the CKOneAI session asked for (documented so a rule change is noticed):
    const t = table as Record<Who, { ck_desk_shows: string[]; ck_desk_shows_but_tool_does_not: string[] }>
    const all = ['A1', 'A2_unassigned_requesterA', 'A3_requesterB_on_teamA_assignedAgentA', 'A4_requesterB_on_teamA_unassigned', 'A5_raised_by_agentA_on_teamB_assignedAgentB', 'B1']
    expect(t.requesterA.ck_desk_shows).toEqual(['A1', 'A2_unassigned_requesterA'].sort())                  // a requester sees only what they raised
    expect(t.agentA.ck_desk_shows).toEqual(expect.arrayContaining(['A1', 'A2_unassigned_requesterA', 'A3_requesterB_on_teamA_assignedAgentA', 'A4_requesterB_on_teamA_unassigned']))   // a technician sees the WHOLE team A, assigned or not
    expect(t.agentA.ck_desk_shows).not.toContain('B1')                                                      // ... but not team B
    expect(t.agentB.ck_desk_shows).toContain('A2_unassigned_requesterA')                                    // a named approver sees the ticket they approve, in another team
    for (const m of ['manager', 'admin', 'platformOwner'] as Who[]) expect(t[m].ck_desk_shows.sort(), m).toEqual(all.slice().sort())   // manager, admin and owner: every ticket of the organisation
  })

  it('a ticket raised on a team the person does not belong to is theirs only because they raised it (agent A raised A5 on team B)', async () => {
    const rls = await seesRequests(fx.agentA)
    expect(rls.has(rid('A5_raised_by_agentA_on_teamB_assignedAgentB'))).toBe(true)
    expect(rls.has(fx.requestB.id)).toBe(false)
  })
})

describe('approvals and surveys', () => {
  it('an approval: visible to the requester of the ticket, the team, the named approver, manager and above; never to a stranger', async () => {
    const seen: Record<string, boolean> = {}
    for (const who of WHO) {
      const { data } = await clientForToken(fx[who].accessToken).from('approvals').select('id').eq('id', ids.approval)
      seen[who] = (data ?? []).length === 1
    }
    findings.approval_of_A2_visible_to = seen
    expect(seen.requesterA).toBe(true)   // the person who asked
    expect(seen.agentA).toBe(true)       // a member of the ticket's team
    expect(seen.agentB).toBe(true)       // the named approver, from another team
    expect(seen.manager && seen.admin && seen.platformOwner).toBe(true)
    expect(seen.requesterB).toBe(false)  // a stranger
  })

  it('customer-satisfaction surveys: a technician sees only their own, a manager and above see all: the assistant\'s technician-level summary is WIDER than CK Desk for an agent', async () => {
    const counts: Record<string, number> = {}
    for (const who of WHO) {
      const { data } = await clientForToken(fx[who].accessToken).from('csat_surveys').select('id').eq('org_id', fx.orgId)
      counts[who] = (data ?? []).length
    }
    findings.csat_surveys_visible_count = counts
    expect(counts.requesterA).toBe(1)                       // only their own survey
    expect(counts.requesterB).toBe(1)
    expect(counts.agentA).toBe(0)                           // an agent sees none of them (not even those of their own team's tickets)
    expect(counts.manager).toBeGreaterThanOrEqual(2)
    expect(counts.admin).toBeGreaterThanOrEqual(2)
  })
})

describe('what an aggregate (counts) tool would reveal to a technician', () => {
  it('records the company-wide ticket count an agent can see in CK Desk vs. the whole organisation', async () => {
    const orgTotal = (await db().from('requests').select('id', { count: 'exact', head: true }).eq('org_id', fx.orgId)).count as number
    const seenBy: Record<string, number> = {}
    for (const who of ['agentA', 'agentB', 'manager', 'admin'] as Who[]) {
      seenBy[who] = ((await clientForToken(fx[who].accessToken).from('requests').select('id', { count: 'exact', head: true }).eq('org_id', fx.orgId)).count as number) ?? 0
    }
    findings.ticket_count_visible = { organisation_total: orgTotal, ...seenBy }
    expect(seenBy.admin).toBe(orgTotal)
    expect(seenBy.manager).toBe(orgTotal)
    expect(seenBy.agentA).toBeLessThan(orgTotal)             // an agent sees only their teams' tickets, so company-wide counts for a technician are wider than CK Desk
  })
})
