import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import { deleteTestUsers } from './cleanup-user'

// Isolated fixture set for D-03 (getFilteredRequests/getFilteredTasks
// authorization gap). Deliberately separate from tests/setup/fixtures.ts
// (DESK-UAT-001) — that file/its tests must not be touched by this work.

const EXISTING_ORG_ID = '00000000-0000-0000-0000-000000000001'
const TEST_PASSWORD = 'Uat-Desk-003-Test-Pw!'

const RUN_TAG = `uat-desk-003-${Date.now()}`
const TEAM_A_PREFIX = `A${Date.now().toString(36).slice(-4).toUpperCase()}`
const TEAM_B_PREFIX = `B${Date.now().toString(36).slice(-4).toUpperCase()}`

let _admin: ReturnType<typeof createAdminClient> | null = null
export function getAdmin(): ReturnType<typeof createAdminClient> {
  if (!_admin) _admin = createAdminClient()
  return _admin
}

/** A real, per-user authenticated Supabase client — same RLS-relevant JWT a
 *  browser session would carry, built via Authorization header instead of
 *  @supabase/ssr's cookie-chunking format (which only next/headers can
 *  produce). Used as the return value of the mocked @/lib/supabase/server. */
export function clientForToken(accessToken: string): SupabaseClient<Database> {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  )
}

export type TestUser = { id: string; email: string; accessToken: string }

export async function createTestUser(label: string, fullName: string): Promise<TestUser> {
  const admin = getAdmin()
  const email = `${RUN_TAG}-${label}@example.test`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error || !data.user) throw new Error(`[fixtures-d03] failed to create user ${label}: ${error?.message}`)

  // A fresh, throwaway client for this one sign-in — NOT the shared `admin`
  // client. supabase-js wires a client's .auth session into that same
  // client's PostgREST Authorization header, so calling signInWithPassword()
  // on the service-role `admin` client would silently downgrade every
  // subsequent admin.from(...) call on it to this test user's own privileges.
  const anon = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (signInError || !signIn.session) throw new Error(`[fixtures-d03] failed to sign in ${label}: ${signInError?.message}`)

  return { id: data.user.id, email, accessToken: signIn.session.access_token }
}

export type D03Fixtures = {
  orgId: string
  departmentId: string
  teamA: { id: string; serviceId: string }
  teamB: { id: string; serviceId: string }
  requesterA: TestUser
  requesterB: TestUser
  agentA: TestUser
  agentB: TestUser
  manager: TestUser
  admin: TestUser
  platformOwner: TestUser
  requestA: { id: string }
  requestB: { id: string }
  taskA: { id: string }
  taskB: { id: string }
  cleanup: () => Promise<void>
}

/** Two fully independent teams (A/B), each with their own service, agent,
 *  and requester, plus one manager, one admin, and one platform_owner (org
 *  scoped, not team-scoped, per this codebase's existing RLS convention —
 *  see requests_update's `current_user_role() IN ('manager','admin',
 *  'platform_owner')` clause). One request and one team task seeded on each
 *  team. Built fresh per run, torn down in afterAll. */
export async function setupD03Fixtures(): Promise<D03Fixtures> {
  const admin = getAdmin()

  const { data: department, error: departmentError } = await admin
    .from('departments')
    .insert({ name: `D-03 Test Department ${RUN_TAG}`, org_id: EXISTING_ORG_ID })
    .select('id').single()
  if (departmentError || !department) throw new Error(`[fixtures-d03] department: ${departmentError?.message}`)
  const departmentId = department.id

  const [teamARow, teamBRow] = await Promise.all([
    admin.from('teams').insert({
      name: `D-03 Team A ${RUN_TAG}`,
      slug: `d03-team-a-${RUN_TAG}`,
      prefix: TEAM_A_PREFIX,
      department_id: departmentId,
      org_id: EXISTING_ORG_ID,
    }).select('id').single(),
    admin.from('teams').insert({
      name: `D-03 Team B ${RUN_TAG}`,
      slug: `d03-team-b-${RUN_TAG}`,
      prefix: TEAM_B_PREFIX,
      department_id: departmentId,
      org_id: EXISTING_ORG_ID,
    }).select('id').single(),
  ])
  if (teamARow.error || !teamARow.data) throw new Error(`[fixtures-d03] team A: ${teamARow.error?.message}`)
  if (teamBRow.error || !teamBRow.data) throw new Error(`[fixtures-d03] team B: ${teamBRow.error?.message}`)
  const teamAId = teamARow.data.id
  const teamBId = teamBRow.data.id

  const [serviceARow, serviceBRow] = await Promise.all([
    admin.from('services').insert({
      name: `D-03 Service A ${RUN_TAG}`,
      slug: `d03-service-a-${RUN_TAG}`,
      team_id: teamAId,
      org_id: EXISTING_ORG_ID,
      form_fields: [],
      form_sections: [],
    }).select('id').single(),
    admin.from('services').insert({
      name: `D-03 Service B ${RUN_TAG}`,
      slug: `d03-service-b-${RUN_TAG}`,
      team_id: teamBId,
      org_id: EXISTING_ORG_ID,
      form_fields: [],
      form_sections: [],
    }).select('id').single(),
  ])
  if (serviceARow.error || !serviceARow.data) throw new Error(`[fixtures-d03] service A: ${serviceARow.error?.message}`)
  if (serviceBRow.error || !serviceBRow.data) throw new Error(`[fixtures-d03] service B: ${serviceBRow.error?.message}`)
  const serviceAId = serviceARow.data.id
  const serviceBId = serviceBRow.data.id

  const [requesterA, requesterB, agentA, agentB, manager, adminUser, platformOwner] = await Promise.all([
    createTestUser('requester-a', 'D03 Requester A'),
    createTestUser('requester-b', 'D03 Requester B'),
    createTestUser('agent-a', 'D03 Agent A'),
    createTestUser('agent-b', 'D03 Agent B'),
    createTestUser('manager', 'D03 Manager'),
    createTestUser('admin', 'D03 Admin'),
    createTestUser('platform-owner', 'D03 Platform Owner'),
  ])

  const roleUpdates = await Promise.all([
    admin.from('profiles').update({ role: 'agent', department_id: departmentId }).eq('id', agentA.id),
    admin.from('profiles').update({ role: 'agent', department_id: departmentId }).eq('id', agentB.id),
    admin.from('profiles').update({ role: 'manager', department_id: departmentId }).eq('id', manager.id),
    admin.from('profiles').update({ role: 'admin', department_id: departmentId }).eq('id', adminUser.id),
    admin.from('profiles').update({ role: 'platform_owner', department_id: departmentId }).eq('id', platformOwner.id),
  ])
  for (const { error } of roleUpdates) {
    if (error) throw new Error(`[fixtures-d03] role update failed: ${error.message}`)
  }

  const teamMemberInserts = await Promise.all([
    admin.from('team_members').insert({ team_id: teamAId, user_id: agentA.id, org_id: EXISTING_ORG_ID }),
    admin.from('team_members').insert({ team_id: teamBId, user_id: agentB.id, org_id: EXISTING_ORG_ID }),
    // Manager is deliberately a member of Team A only — resolveReportAccess()
    // scopes managers to their own team_members' teams for the 'requests'
    // entity, so this makes "manager sees Team A, not Team B" a meaningful,
    // non-vacuous test instead of an always-empty one.
    admin.from('team_members').insert({ team_id: teamAId, user_id: manager.id, org_id: EXISTING_ORG_ID }),
  ])
  for (const { error } of teamMemberInserts) {
    if (error) throw new Error(`[fixtures-d03] team_members insert failed: ${error.message}`)
  }

  const [requestARow, requestBRow] = await Promise.all([
    admin.from('requests').insert({
      request_no: '',
      title: `D-03 Request A ${RUN_TAG}`,
      requester_id: requesterA.id,
      service_id: serviceAId,
      team_id: teamAId,
      assigned_to: agentA.id,
      status: 'open',
    }).select('id').single(),
    admin.from('requests').insert({
      request_no: '',
      title: `D-03 Request B ${RUN_TAG}`,
      requester_id: requesterB.id,
      service_id: serviceBId,
      team_id: teamBId,
      assigned_to: agentB.id,
      status: 'open',
    }).select('id').single(),
  ])
  if (requestARow.error || !requestARow.data) throw new Error(`[fixtures-d03] request A: ${requestARow.error?.message}`)
  if (requestBRow.error || !requestBRow.data) throw new Error(`[fixtures-d03] request B: ${requestBRow.error?.message}`)

  const [taskARow, taskBRow] = await Promise.all([
    admin.from('tasks').insert({
      title: `D-03 Task A ${RUN_TAG}`,
      task_type: 'team',
      team_id: teamAId,
      assignee_id: agentA.id,
      created_by: agentA.id,
      org_id: EXISTING_ORG_ID,
    }).select('id').single(),
    admin.from('tasks').insert({
      title: `D-03 Task B ${RUN_TAG}`,
      task_type: 'team',
      team_id: teamBId,
      assignee_id: agentB.id,
      created_by: agentB.id,
      org_id: EXISTING_ORG_ID,
    }).select('id').single(),
  ])
  if (taskARow.error || !taskARow.data) throw new Error(`[fixtures-d03] task A: ${taskARow.error?.message}`)
  if (taskBRow.error || !taskBRow.data) throw new Error(`[fixtures-d03] task B: ${taskBRow.error?.message}`)

  return {
    orgId: EXISTING_ORG_ID,
    departmentId,
    teamA: { id: teamAId, serviceId: serviceAId },
    teamB: { id: teamBId, serviceId: serviceBId },
    requesterA,
    requesterB,
    agentA,
    agentB,
    manager,
    admin: adminUser,
    platformOwner,
    requestA: { id: requestARow.data.id },
    requestB: { id: requestBRow.data.id },
    taskA: { id: taskARow.data.id },
    taskB: { id: taskBRow.data.id },
    cleanup: async () => {
      const fixtureUserIds = [requesterA.id, requesterB.id, agentA.id, agentB.id, manager.id, adminUser.id, platformOwner.id]
      await admin.from('tasks').delete().in('team_id', [teamAId, teamBId])
      // Defense in depth beyond team-scoped tasks: a consuming test (e.g.
      // D-09/D-16, which reuse this fixture purely for its ready-made
      // identities) can create a `task_type: 'personal'` task with no
      // team_id at all — tasks.created_by/assignee_id are NO ACTION FKs to
      // profiles(id), so any such task left behind (the test's own cleanup
      // normally deletes it, but an interrupted run won't reach that) would
      // silently block every one of these users' deleteUser() calls below
      // forever. Confirmed as the exact cause of several long-stale
      // "agent-a"/"requester-a" auth users found during Stage 5.1's audit.
      await admin.from('tasks').delete().in('created_by', fixtureUserIds)
      await admin.from('tasks').delete().in('assignee_id', fixtureUserIds)
      await admin.from('requests').delete().in('service_id', [serviceAId, serviceBId])
      await admin.from('team_members').delete().in('team_id', [teamAId, teamBId])
      await admin.from('services').delete().in('id', [serviceAId, serviceBId])
      await admin.from('teams').delete().in('id', [teamAId, teamBId])
      // Stage 3.2/5.1 principle: a cleanup failure is a test failure, not
      // something to log and move on from — throws (via deleteTestUsers,
      // which itself retries each deletion a bounded number of times for
      // transient Auth/Postgres contention under sustained suite load)
      // rather than silently leaking a stale auth user the way this used to.
      await deleteTestUsers(admin, [
        { id: requesterA.id, label: 'requesterA' },
        { id: requesterB.id, label: 'requesterB' },
        { id: agentA.id, label: 'agentA' },
        { id: agentB.id, label: 'agentB' },
        { id: manager.id, label: 'manager' },
        { id: adminUser.id, label: 'adminUser' },
        { id: platformOwner.id, label: 'platformOwner' },
      ])
      // After every profile referencing it (via department_id) is gone.
      await admin.from('departments').delete().eq('id', departmentId)
    },
  }
}

export type SeedRequestLikeOptions = {
  requesterId: string
  teamId: string
  serviceId: string
  assignedTo?: string | null
  status?: Database['public']['Tables']['requests']['Row']['status']
}

/** A generic request seed for suites (beyond D-03 itself) that reuse this
 *  fixture set purely for its ready-made two-team/multi-role setup — e.g.
 *  Item 6's assignment-RBAC tests. Deleted by the D03Fixtures cleanup()
 *  above (scoped by service_id, which every row here belongs to). */
export async function seedRequestLike(fx: D03Fixtures, opts: SeedRequestLikeOptions) {
  const admin = getAdmin()
  const { data, error } = await admin
    .from('requests')
    .insert({
      request_no: '',
      title: `fixtures-d03 seedRequestLike ${Date.now()}`,
      requester_id: opts.requesterId,
      service_id: opts.serviceId,
      team_id: opts.teamId,
      assigned_to: opts.assignedTo ?? null,
      status: opts.status ?? 'open',
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(`[fixtures-d03] seedRequestLike failed: ${error?.message}`)
  return data
}
