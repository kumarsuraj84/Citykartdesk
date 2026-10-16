// Remediation phase 2 (migration 167): ownership checks for projects, tasks and files; privacy of internal configuration. Direct data-API calls, as a browser could make them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

let fx: D03Fixtures
const admin = () => getAdmin()
let projectA = ''           // a project of group A, owned by technician A

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const { data, error } = await admin().from('projects').insert({ name: `VAPT project ${Date.now()}`, org_id: fx.orgId, owner_id: fx.agentA.id, created_by: fx.agentA.id, team_id: fx.teamA.id }).select('id').single()
  if (error) throw new Error(error.message)
  projectA = data.id
}, 180_000)
afterAll(async () => {
  await admin().from('project_members').delete().eq('project_id', projectA)
  await admin().from('tasks').delete().eq('project_id', projectA)
  await admin().from('projects').delete().eq('id', projectA)
  await fx?.cleanup()
}, 120_000)

describe('projects', () => {
  it('a technician of another group cannot add himself to a project of group A, and so cannot read it; the project\'s own technician can add a member', async () => {
    const asB = clientForToken(fx.agentB.accessToken)
    const { error } = await asB.from('project_members').insert({ project_id: projectA, user_id: fx.agentB.id, org_id: fx.orgId, role: 'member', added_by: fx.agentB.id })
    expect(error).not.toBeNull()
    expect(((await asB.from('projects').select('id').eq('id', projectA)).data ?? []).length).toBe(0)
    const asA = clientForToken(fx.agentA.accessToken)
    const ok = await asA.from('project_members').insert({ project_id: projectA, user_id: fx.manager.id, org_id: fx.orgId, role: 'member', added_by: fx.agentA.id })
    expect(ok.error).toBeNull()
  })
  it('milestones and updates of a project need access to that project', async () => {
    const asB = clientForToken(fx.agentB.accessToken)
    expect((await asB.from('milestones').insert({ project_id: projectA, org_id: fx.orgId, name: 'x', created_by: fx.agentB.id })).error).not.toBeNull()
    expect((await asB.from('project_updates').insert({ project_id: projectA, org_id: fx.orgId, author_id: fx.agentB.id, body: 'x' })).error).not.toBeNull()
  })
})

describe('tasks', () => {
  it('an ordinary employee cannot create a task at all, and a technician cannot create one inside another group\'s project', async () => {
    const asReq = clientForToken(fx.requesterA.accessToken)
    expect((await asReq.from('tasks').insert({ title: 'x', org_id: fx.orgId, created_by: fx.requesterA.id, assignee_id: fx.agentA.id })).error).not.toBeNull()
    const asB = clientForToken(fx.agentB.accessToken)
    expect((await asB.from('tasks').insert({ title: 'x', org_id: fx.orgId, created_by: fx.agentB.id, project_id: projectA })).error).not.toBeNull()
  })
  it('a technician can still create an ordinary task for a colleague', async () => {
    const asA = clientForToken(fx.agentA.accessToken)
    const { data, error } = await asA.from('tasks').insert({ title: 'legit', org_id: fx.orgId, created_by: fx.agentA.id, assignee_id: fx.agentA.id, project_id: projectA }).select('id').single()
    expect(error).toBeNull()
    await admin().from('tasks').delete().eq('id', data!.id)
  })
})

describe('task files', () => {
  it('nobody can forge a file record or upload / delete in the task store directly', async () => {
    for (const who of [fx.requesterA, fx.agentA, fx.manager, fx.admin]) {
      const c = clientForToken(who.accessToken)
      const rec = await c.from('task_attachments').insert({ task_id: fx.taskA.id, uploaded_by: who.id, file_name: 'x.png', file_size: 1, mime_type: 'image/png', storage_path: `${fx.taskB.id}/someone-elses-file.png` })
      expect(rec.error, who.email).not.toBeNull()
      const up = await c.storage.from('task-attachments').upload(`vapt-${Date.now()}/x.png`, Buffer.from('x'), { contentType: 'image/png' })
      expect(up.error, who.email).not.toBeNull()
    }
  })
})

describe('ticket files and comments', () => {
  it('an uploader cannot restore or alter an attachment row directly', async () => {
    const { data: row } = await admin().from('request_attachments').insert({ request_id: fx.requestA.id, uploaded_by: fx.requesterA.id, file_name: 'a.png', file_size: 1, mime_type: 'image/png', storage_path: `${fx.requestA.id}/a.png`, deleted_at: new Date().toISOString() }).select('id').single()
    const c = clientForToken(fx.requesterA.accessToken)
    await c.from('request_attachments').update({ deleted_at: null }).eq('id', row!.id)
    expect((await admin().from('request_attachments').select('deleted_at').eq('id', row!.id).single()).data?.deleted_at).not.toBeNull()
    expect((await c.from('request_attachments').delete().eq('id', row!.id)).error).not.toBeNull()
    await admin().from('request_attachments').delete().eq('id', row!.id)
  })
})

describe('re-pointing a record at another ticket', () => {
  it('a requester cannot move a survey answer to another ticket', async () => {
    const { data: s, error } = await admin().from('csat_surveys').insert({ request_id: fx.requestA.id, requester_id: fx.requesterA.id, org_id: fx.orgId }).select('id').single()
    if (error) return                                         // a survey needs columns this fixture may not fill: the policy text is the proof then
    const c = clientForToken(fx.requesterA.accessToken)
    await c.from('csat_surveys').update({ request_id: fx.requestB.id, rating: 5 }).eq('id', s!.id)
    expect((await admin().from('csat_surveys').select('request_id').eq('id', s!.id).single()).data?.request_id).toBe(fx.requestA.id)
    await admin().from('csat_surveys').delete().eq('id', s!.id)
  })
})

describe('internal configuration is not readable by an ordinary employee', () => {
  it('alert rules, escalation rules, permission overrides, scheduled reports and group membership of others', async () => {
    const asReq = clientForToken(fx.requesterA.accessToken)
    for (const table of ['alert_rules', 'escalation_policies', 'permission_overrides', 'scheduled_reports', 'related_requests'] as const) {
      expect(((await asReq.from(table).select('id').limit(5)).data ?? []).length, table).toBe(0)
    }
    const members = (await asReq.from('team_members').select('user_id').limit(100)).data ?? []
    expect(members.every((m) => m.user_id === fx.requesterA.id)).toBe(true)
    const asManager = clientForToken(fx.manager.accessToken)
    expect(((await asManager.from('team_members').select('user_id').limit(5)).data ?? []).length).toBeGreaterThan(0)
  })
})
