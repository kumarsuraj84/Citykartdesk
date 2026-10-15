// Removes the synthetic UAT users/teams/services that 95-uat-fixture-keep.test.ts left in the disposable audit database for the browser UAT.
import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { getAdmin } from '../setup/fixtures-d03'
import { deleteTestUsers } from '../setup/cleanup-user'

it('removes the UAT fixture set', async () => {
  const admin = getAdmin()
  const users = JSON.parse(readFileSync('security-assessment-2026-10/02-VAPT/work/uat-users.json', 'utf8')) as Record<string, string>
  void users                                         // the file only proves the keep step ran; every leftover UAT fixture set is removed
  const tag = 'uat-desk-003-'
  const { data: profiles } = await admin.from('profiles').select('id').in('id', (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.filter((u) => (u.email ?? '').includes(tag)).map((u) => u.id))
  const ids = (profiles ?? []).map((p: { id: string }) => p.id)
  const { data: teams } = await admin.from('teams').select('id').like('name', `%${tag}%`)
  const teamIds = (teams ?? []).map((t: { id: string }) => t.id)
  const { data: services } = await admin.from('services').select('id').in('team_id', teamIds.length ? teamIds : ['00000000-0000-0000-0000-000000000000'])
  const serviceIds = (services ?? []).map((s: { id: string }) => s.id)
  const { data: reqs } = await admin.from('requests').select('id').in('service_id', serviceIds.length ? serviceIds : ['00000000-0000-0000-0000-000000000000'])
  const reqIds = (reqs ?? []).map((r: { id: string }) => r.id)
  if (teamIds.length) await admin.from('tasks').delete().in('team_id', teamIds)
  await admin.from('tasks').delete().in('created_by', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  await admin.from('tasks').delete().in('assignee_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  if (reqIds.length) {
    const { data: ap } = await admin.from('approvals').select('workflow_id').in('request_id', reqIds)
    const wf = [...new Set((ap ?? []).map((a: { workflow_id: string }) => a.workflow_id))]
    if (wf.length) { await admin.from('approval_workflow_steps').delete().in('workflow_id', wf); await admin.from('approval_workflows').delete().in('id', wf) }
    await admin.from('requests').delete().in('id', reqIds)
  }
  if (teamIds.length) await admin.from('team_members').delete().in('team_id', teamIds)
  if (serviceIds.length) await admin.from('services').delete().in('id', serviceIds)
  if (teamIds.length) await admin.from('teams').delete().in('id', teamIds)
  await deleteTestUsers(admin, ids.map((id, i) => ({ id, label: `uat-${i}` })))
  await admin.from('departments').delete().like('name', `%${tag}%`)
  const { data: left } = await admin.from('profiles').select('id').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  expect(left ?? []).toEqual([])
}, 180_000)
