import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

// Isolated fixture set for D-04 (project/milestone object-level
// authorization). Independent of the DESK-UAT-001 and D-03 fixtures/tests.

const EXISTING_ORG_ID = '00000000-0000-0000-0000-000000000001'
const EXISTING_DEPARTMENT_ID = '10000000-0000-0000-0000-000000000001'
const TEST_PASSWORD = 'Uat-Desk-004-Test-Pw!'

const RUN_TAG = `uat-desk-004-${Date.now()}`

let _admin: ReturnType<typeof createAdminClient> | null = null
export function getAdmin(): ReturnType<typeof createAdminClient> {
  if (!_admin) _admin = createAdminClient()
  return _admin
}

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

async function createTestUser(label: string, fullName: string): Promise<TestUser> {
  const admin = getAdmin()
  const email = `${RUN_TAG}-${label}@example.test`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error || !data.user) throw new Error(`[fixtures-d04] failed to create user ${label}: ${error?.message}`)

  const anon = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (signInError || !signIn.session) throw new Error(`[fixtures-d04] failed to sign in ${label}: ${signInError?.message}`)

  return { id: data.user.id, email, accessToken: signIn.session.access_token }
}

export type D04Fixtures = {
  orgId: string
  projectId: string
  milestoneId: string
  projectOwner: TestUser
  projectMember: TestUser
  unrelatedAgent: TestUser
  manager: TestUser
  admin: TestUser
  cleanup: () => Promise<void>
}

/** One project (team_id left null — ownership/membership is the only
 *  in-scope dimension being tested here, not team scoping), owned by
 *  projectOwner, with projectMember legitimately added via project_members,
 *  one milestone on it, an unrelatedAgent with no connection to the project
 *  at all, and a manager/admin for the "broader role scope still works"
 *  checks. Built fresh per run, torn down in afterAll. */
export async function setupD04Fixtures(): Promise<D04Fixtures> {
  const admin = getAdmin()

  const [projectOwner, projectMember, unrelatedAgent, manager, adminUser] = await Promise.all([
    createTestUser('project-owner', 'D04 Project Owner'),
    createTestUser('project-member', 'D04 Project Member'),
    createTestUser('unrelated-agent', 'D04 Unrelated Agent'),
    createTestUser('manager', 'D04 Manager'),
    createTestUser('admin', 'D04 Admin'),
  ])

  const roleUpdates = await Promise.all([
    admin.from('profiles').update({ role: 'agent', department_id: EXISTING_DEPARTMENT_ID }).eq('id', projectOwner.id),
    admin.from('profiles').update({ role: 'agent', department_id: EXISTING_DEPARTMENT_ID }).eq('id', projectMember.id),
    admin.from('profiles').update({ role: 'agent', department_id: EXISTING_DEPARTMENT_ID }).eq('id', unrelatedAgent.id),
    admin.from('profiles').update({ role: 'manager', department_id: EXISTING_DEPARTMENT_ID }).eq('id', manager.id),
    admin.from('profiles').update({ role: 'admin', department_id: EXISTING_DEPARTMENT_ID }).eq('id', adminUser.id),
  ])
  for (const { error } of roleUpdates) {
    if (error) throw new Error(`[fixtures-d04] role update failed: ${error.message}`)
  }

  const { data: project, error: projectError } = await admin
    .from('projects')
    .insert({
      name: `D-04 Test Project ${RUN_TAG}`,
      org_id: EXISTING_ORG_ID,
      owner_id: projectOwner.id,
      created_by: projectOwner.id,
    })
    .select('id')
    .single()
  if (projectError || !project) throw new Error(`[fixtures-d04] project: ${projectError?.message}`)

  const { error: memberError } = await admin.from('project_members').insert({
    project_id: project.id,
    user_id: projectMember.id,
    org_id: EXISTING_ORG_ID,
    role: 'member',
    added_by: projectOwner.id,
  })
  if (memberError) throw new Error(`[fixtures-d04] project_members: ${memberError.message}`)

  const { data: milestone, error: milestoneError } = await admin
    .from('milestones')
    .insert({
      project_id: project.id,
      org_id: EXISTING_ORG_ID,
      name: `D-04 Test Milestone ${RUN_TAG}`,
      created_by: projectOwner.id,
    })
    .select('id')
    .single()
  if (milestoneError || !milestone) throw new Error(`[fixtures-d04] milestone: ${milestoneError?.message}`)

  return {
    orgId: EXISTING_ORG_ID,
    projectId: project.id,
    milestoneId: milestone.id,
    projectOwner,
    projectMember,
    unrelatedAgent,
    manager,
    admin: adminUser,
    cleanup: async () => {
      await admin.from('milestones').delete().eq('project_id', project.id)
      await admin.from('project_members').delete().eq('project_id', project.id)
      await admin.from('projects').delete().eq('id', project.id)
      const users = [projectOwner, projectMember, unrelatedAgent, manager, adminUser]
      const deletions = await Promise.all(users.map((u) => admin.auth.admin.deleteUser(u.id)))
      for (const { error } of deletions) {
        if (error) console.error('[fixtures-d04] cleanup: failed to delete test user', error.message)
      }
    },
  }
}
