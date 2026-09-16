import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import { deleteTestUsers } from './cleanup-user'

const EXISTING_ORG_ID = '00000000-0000-0000-0000-000000000001'
const TEST_PASSWORD = 'Uat-Desk-001-Test-Pw!'

const RUN_TAG = `uat-desk-001-${Date.now()}`
// teams.prefix is globally unique (not org-scoped) and capped at 6 chars —
// derive a short one from the run tag instead of a fixed literal so repeat
// runs (and any left over from a previously-aborted run) never collide.
const TEAM_PREFIX = `Z${Date.now().toString(36).slice(-4).toUpperCase()}`

// Lazy singleton: must not construct until after tests/setup/env.ts has
// loaded .env.local and installed the WebSocket polyfill.
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

async function createTestUser(label: string, fullName: string): Promise<TestUser> {
  const admin = getAdmin()
  const email = `${RUN_TAG}-${label}@example.test`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error || !data.user) throw new Error(`[fixtures] failed to create user ${label}: ${error?.message}`)

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
  if (signInError || !signIn.session) throw new Error(`[fixtures] failed to sign in ${label}: ${signInError?.message}`)

  return { id: data.user.id, email, accessToken: signIn.session.access_token }
}

export type Fixtures = {
  orgId: string
  departmentId: string
  teamId: string
  serviceId: string
  requester: TestUser
  otherRequester: TestUser
  agent: TestUser
  cleanup: () => Promise<void>
}

/** Everything DESK-UAT-001's regression tests need: one team, one service on
 *  it, a plain requester, an unrelated second requester (for the
 *  wrong-requester-can't-reopen check), and one agent on the team. Built
 *  fresh per test run (RUN_TAG-suffixed names) and torn down in afterAll —
 *  no dependency on any pre-existing UAT data beyond the one seeded org. */
export async function setupFixtures(): Promise<Fixtures> {
  const admin = getAdmin()

  const { data: department, error: departmentError } = await admin
    .from('departments')
    .insert({ name: `DESK-UAT-001 Test Department ${RUN_TAG}`, org_id: EXISTING_ORG_ID })
    .select('id')
    .single()
  if (departmentError || !department) throw new Error(`[fixtures] failed to create department: ${departmentError?.message}`)

  const { data: team, error: teamError } = await admin
    .from('teams')
    .insert({
      name: `DESK-UAT-001 Test Team ${RUN_TAG}`,
      slug: `desk-uat-001-team-${RUN_TAG}`,
      prefix: TEAM_PREFIX,
      department_id: department.id,
      org_id: EXISTING_ORG_ID,
    })
    .select('id')
    .single()
  if (teamError || !team) throw new Error(`[fixtures] failed to create team: ${teamError?.message}`)

  const { data: service, error: serviceError } = await admin
    .from('services')
    .insert({
      name: `DESK-UAT-001 Test Service ${RUN_TAG}`,
      slug: `desk-uat-001-service-${RUN_TAG}`,
      team_id: team.id,
      org_id: EXISTING_ORG_ID,
      form_fields: [],
      form_sections: [],
    })
    .select('id')
    .single()
  if (serviceError || !service) throw new Error(`[fixtures] failed to create service: ${serviceError?.message}`)

  const [requester, otherRequester, agent] = await Promise.all([
    createTestUser('requester', 'UAT Requester'),
    createTestUser('other-requester', 'UAT Other Requester'),
    createTestUser('agent', 'UAT Agent'),
  ])

  const { error: agentProfileError } = await admin
    .from('profiles')
    .update({ role: 'agent', department_id: department.id })
    .eq('id', agent.id)
  if (agentProfileError) throw new Error(`[fixtures] failed to promote agent: ${agentProfileError.message}`)

  const { error: teamMemberError } = await admin
    .from('team_members')
    .insert({ team_id: team.id, user_id: agent.id, org_id: EXISTING_ORG_ID })
  if (teamMemberError) throw new Error(`[fixtures] failed to add agent to team: ${teamMemberError.message}`)

  return {
    orgId: EXISTING_ORG_ID,
    departmentId: department.id,
    teamId: team.id,
    serviceId: service.id,
    requester,
    otherRequester,
    agent,
    cleanup: async () => {
      await admin.from('requests').delete().eq('service_id', service.id)
      await admin.from('team_members').delete().eq('team_id', team.id)
      await admin.from('services').delete().eq('id', service.id)
      await admin.from('teams').delete().eq('id', team.id)
      // Stage 3.2/5.1 principle: a cleanup failure is a test failure, not
      // something to log and move on from. This exact sequence (requests
      // deleted before any deleteUser call) reproduces cleanly with zero
      // failures in isolation, so the historical leak here was a transient
      // Auth/Postgres contention failure under the full suite's sustained
      // sequential load, not a structural ordering bug — deleteTestUsers'
      // bounded retry absorbs that, and still throws if it doesn't recover.
      await deleteTestUsers(admin, [
        { id: requester.id, label: 'requester' },
        { id: otherRequester.id, label: 'otherRequester' },
        { id: agent.id, label: 'agent' },
      ])
      // After the agent's own profile (and its department_id FK) is gone.
      await admin.from('departments').delete().eq('id', department.id)
    },
  }
}

export type SeedRequestOptions = {
  requesterId: string
  serviceId: string
  teamId: string
  orgId: string
  assignedTo?: string
  /** Defaults to `now`, i.e. well within the 72h reopen window. */
  resolvedAt?: Date
  status?: Database['public']['Tables']['requests']['Row']['status']
  cancellationReason?: string | null
  reopenDeadlineAt?: Date | null
}

/** Inserts a request already sitting in `resolved` (or another status) with a
 *  resolved_at/reopen_deadline_at pair consistent with the real
 *  updateRequestStatus() reopen-window logic, so tests don't need to drive
 *  the full create → resolve lifecycle through the action just to get a
 *  resolved ticket to reopen. */
export async function seedRequest(opts: SeedRequestOptions) {
  const admin = getAdmin()
  const resolvedAt = opts.resolvedAt ?? new Date()
  const status = opts.status ?? 'resolved'
  const defaultReopenDeadline = status === 'resolved' ? new Date(resolvedAt.getTime() + 72 * 3_600_000) : null
  const reopenDeadline = opts.reopenDeadlineAt !== undefined ? opts.reopenDeadlineAt : defaultReopenDeadline

  const { data, error } = await admin
    .from('requests')
    .insert({
      request_no: '', // overwritten by trg_requests_assign_no before insert
      title: `DESK-UAT-001 regression ${RUN_TAG}`,
      requester_id: opts.requesterId,
      service_id: opts.serviceId,
      team_id: opts.teamId,
      assigned_to: opts.assignedTo ?? null,
      status,
      resolved_at: status === 'resolved' ? resolvedAt.toISOString() : null,
      reopen_deadline_at: reopenDeadline ? reopenDeadline.toISOString() : null,
      cancellation_reason: opts.cancellationReason ?? null,
      resolution_due_at: new Date(resolvedAt.getTime() + 24 * 3_600_000).toISOString(),
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(`[fixtures] failed to seed request: ${error?.message}`)
  return data
}
