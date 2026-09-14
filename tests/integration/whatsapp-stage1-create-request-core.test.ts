/**
 * Stage 1 (WhatsApp discovery → implementation) — proves the extraction in
 * lib/requests/create-request-core.ts did not regress the web channel, and
 * that it actually fixes the two confirmed gaps in Email Intake's own ticket
 * creation (no SLA, no Business Rules — see
 * CITYKART_DESK_WHATSAPP_TECHNICAL_DISCOVERY.md §11/§21):
 *
 *   1. Web parity — createRequest() still produces a fully governed ticket
 *      (SLA, Business-Rule assignment, activity) and still enforces the
 *      mandatory-field gate.
 *   2. Core parity — calling createRequestCore() directly (no browser
 *      session, admin client — the shape a WhatsApp webhook handler would
 *      use) produces an IDENTICALLY governed ticket to the web path.
 *   3. Email Intake regression fix — approveAndCreate() now routes through
 *      the same core: previously-null SLA deadlines are now set, and
 *      Business Rules assignment now fires, for both the 'request' and
 *      'approval' work-item types.
 *
 * Isolated fixture set — deliberately not sharing tests/setup/fixtures.ts or
 * fixtures-d03.ts's actual fixtures (reuses only their exported user/client
 * helpers), so this suite can freely configure an SLA policy, a mandatory
 * select field, and a Business Rule without touching any other suite's data.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createTestUser, clientForToken, getAdmin, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createRequest } from '@/lib/actions/requests'
import { createRequestCore } from '@/lib/requests/create-request-core'
import { approveAndCreate } from '@/lib/actions/intake/work'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

const EXISTING_ORG_ID = '00000000-0000-0000-0000-000000000001'
const EXISTING_DEPARTMENT_ID = '10000000-0000-0000-0000-000000000001'
const RUN_TAG = `whatsapp-stage1-${Date.now()}`
const TEAM_PREFIX = `S${Date.now().toString(36).slice(-4).toUpperCase()}`

const REQUIRED_SELECT_FIELD_ID = 'issue_type'
const TITLE_FIELD_ID = 'summary'

type Fx = {
  orgId: string
  teamId: string
  serviceId: string
  intakeServiceId: string
  slaPolicyId: string
  requester: TestUser
  otherRequester: TestUser
  agent: TestUser
  businessRuleId: string
  channelId: string
  cleanup: () => Promise<void>
}

async function setup(): Promise<Fx> {
  const admin = getAdmin()

  // The Email Intake tests below need the 'intake' module enabled for this
  // org to call approveAndCreate() at all (requireModuleEnabled('intake') —
  // see lib/actions/moduleGuard.ts) — this shared local/UAT org currently
  // has it OFF. Recorded so it can be restored exactly as found in cleanup(),
  // rather than leaving this shared org's module config altered.
  const { data: priorIntakeAccess } = await admin
    .from('org_module_access')
    .select('enabled')
    .eq('org_id', EXISTING_ORG_ID)
    .eq('module', 'intake')
    .maybeSingle()
  await admin
    .from('org_module_access')
    .upsert({ org_id: EXISTING_ORG_ID, module: 'intake', enabled: true }, { onConflict: 'org_id,module' })

  const { data: team, error: teamError } = await admin
    .from('teams')
    .insert({
      name: `Stage1 Test Team ${RUN_TAG}`,
      slug: `stage1-team-${RUN_TAG}`,
      prefix: TEAM_PREFIX,
      department_id: EXISTING_DEPARTMENT_ID,
      org_id: EXISTING_ORG_ID,
    })
    .select('id')
    .single()
  if (teamError || !team) throw new Error(`[stage1 fixtures] team: ${teamError?.message}`)

  const { data: slaPolicy, error: slaError } = await admin
    .from('sla_policies')
    .insert({
      org_id: EXISTING_ORG_ID,
      name: `Stage1 SLA Policy ${RUN_TAG}`,
      // Distinct hours per tier so a test can tell "which tier actually got
      // used" apart just from the resolved deadline.
      config: {
        low: { response_hours: 24, resolution_hours: 48 },
        medium: { response_hours: 8, resolution_hours: 16 },
        urgent: { response_hours: 1, resolution_hours: 2 },
      },
    })
    .select('id')
    .single()
  if (slaError || !slaPolicy) throw new Error(`[stage1 fixtures] sla policy: ${slaError?.message}`)

  const { data: service, error: serviceError } = await admin
    .from('services')
    .insert({
      name: `Stage1 Test Service ${RUN_TAG}`,
      slug: `stage1-service-${RUN_TAG}`,
      team_id: team.id,
      org_id: EXISTING_ORG_ID,
      default_priority: 'low',
      sla_policy_id: slaPolicy.id,
      form_fields: [],
      form_sections: [
        {
          id: 'sec1',
          title: 'Details',
          order: 0,
          fields: [
            // Labeled "Subject" (not e.g. "Summary") deliberately — Email
            // Intake's buildFormData() autofill only recognizes a handful of
            // label patterns for text fields (see lib/actions/intake/work.ts),
            // and the SLA/assignment-parity tests below need this required
            // field to actually get filled by that heuristic so they aren't
            // incidentally testing the (separately covered) mandatory-field
            // rejection path instead.
            { id: TITLE_FIELD_ID, type: 'text', label: 'Subject', required: true, order: 0 },
            { id: REQUIRED_SELECT_FIELD_ID, type: 'select', label: 'Issue Type', required: true, order: 1,
              options: [{ value: 'hardware', label: 'Hardware' }, { value: 'software', label: 'Software' }] },
            { id: 'tech_only', type: 'text', label: 'Tech Only', required: true, order: 2, requester_can_view: false },
          ],
        },
      ],
    })
    .select('id')
    .single()
  if (serviceError || !service) throw new Error(`[stage1 fixtures] service: ${serviceError?.message}`)

  // A second, simpler service for the Email Intake tests: only a required
  // text field with an autofillable label — no required select field, since
  // buildFormData()'s entity/text autofill deliberately never fills
  // select/radio/checkbox fields ("can't infer reliably — left for the
  // reviewer", see lib/actions/intake/work.ts). Using the same serviceA
  // (with its required Issue Type select) would make every intake
  // conversion below fail the mandatory-field gate — a real, documented,
  // deliberate Stage 1 limitation (see create-request-core.ts's comment on
  // this), but not what THESE tests are trying to demonstrate; the gate
  // itself is already covered by the mandatory-field tests above.
  const { data: intakeService, error: intakeServiceError } = await admin
    .from('services')
    .insert({
      name: `Stage1 Intake-Friendly Service ${RUN_TAG}`,
      slug: `stage1-intake-service-${RUN_TAG}`,
      team_id: team.id,
      org_id: EXISTING_ORG_ID,
      default_priority: 'low',
      sla_policy_id: slaPolicy.id,
      form_fields: [],
      form_sections: [
        { id: 'sec1', title: 'Details', order: 0,
          fields: [{ id: TITLE_FIELD_ID, type: 'text', label: 'Subject', required: true, order: 0 }] },
      ],
    })
    .select('id')
    .single()
  if (intakeServiceError || !intakeService) throw new Error(`[stage1 fixtures] intake service: ${intakeServiceError?.message}`)

  const [requester, otherRequester, agent] = await Promise.all([
    createTestUser('stage1-requester', 'Stage1 Requester'),
    createTestUser('stage1-other-requester', 'Stage1 Other Requester'),
    createTestUser('stage1-agent', 'Stage1 Agent'),
  ])

  const { error: agentProfileError } = await admin
    .from('profiles')
    .update({ role: 'agent', department_id: EXISTING_DEPARTMENT_ID })
    .eq('id', agent.id)
  if (agentProfileError) throw new Error(`[stage1 fixtures] promote agent: ${agentProfileError.message}`)

  const { error: teamMemberError } = await admin
    .from('team_members')
    .insert({ team_id: team.id, user_id: agent.id, org_id: EXISTING_ORG_ID })
  if (teamMemberError) throw new Error(`[stage1 fixtures] add agent to team: ${teamMemberError.message}`)

  // The reviewer for the Email Intake tests also needs agent-tier — reuse `agent`.

  const { data: rule, error: ruleError } = await admin
    .from('business_rules')
    .insert({
      org_id: EXISTING_ORG_ID,
      name: `Stage1 auto-assign ${RUN_TAG}`,
      trigger: ['created'],
      // Team-scoped (not service-scoped) so the same rule covers both test
      // services below.
      conditions: [{ field: 'team_id', operator: 'equals', value: team.id }],
      actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [agent.id] } }],
      execution_order: 0,
    })
    .select('id')
    .single()
  if (ruleError || !rule) throw new Error(`[stage1 fixtures] business rule: ${ruleError?.message}`)

  const { data: channel, error: channelError } = await admin
    .from('intake_channels')
    .insert({ org_id: EXISTING_ORG_ID, type: 'api', name: `Stage1 API Channel ${RUN_TAG}` })
    .select('id')
    .single()
  if (channelError || !channel) throw new Error(`[stage1 fixtures] intake channel: ${channelError?.message}`)

  return {
    orgId: EXISTING_ORG_ID,
    teamId: team.id,
    serviceId: service.id,
    intakeServiceId: intakeService.id,
    slaPolicyId: slaPolicy.id,
    requester,
    otherRequester,
    agent,
    businessRuleId: rule.id,
    channelId: channel.id,
    cleanup: async () => {
      await admin.from('requests').delete().eq('service_id', service.id)
      await admin.from('requests').delete().eq('service_id', intakeService.id)
      const { data: msgs } = await admin.from('intake_messages').select('id').eq('channel_id', channel.id)
      const msgIds = (msgs ?? []).map((m: { id: string }) => m.id)
      if (msgIds.length) {
        await admin.from('intake_reviews').delete().in('message_id', msgIds)
        await admin.from('intake_messages').delete().in('id', msgIds)
      }
      await admin.from('intake_channels').delete().eq('id', channel.id)
      await admin.from('business_rules').delete().eq('id', rule.id)
      await admin.from('team_members').delete().eq('team_id', team.id)
      await admin.from('services').delete().eq('id', service.id)
      await admin.from('services').delete().eq('id', intakeService.id)
      await admin.from('sla_policies').delete().eq('id', slaPolicy.id)
      await admin.from('teams').delete().eq('id', team.id)
      for (const u of [requester, otherRequester, agent]) {
        const { error } = await admin.auth.admin.deleteUser(u.id)
        if (error) console.error('[stage1 fixtures] cleanup: failed to delete test user', error.message)
      }
      // Restore this shared org's 'intake' module flag exactly as found.
      await admin
        .from('org_module_access')
        .upsert(
          { org_id: EXISTING_ORG_ID, module: 'intake', enabled: priorIntakeAccess?.enabled ?? false },
          { onConflict: 'org_id,module' }
        )
    },
  }
}

async function createIntakeReview(fx: Fx, subject: string): Promise<string> {
  const admin = getAdmin()
  const { data: msg, error: msgError } = await admin
    .from('intake_messages')
    .insert({
      org_id: fx.orgId,
      channel_id: fx.channelId,
      subject,
      body_text: subject,
      external_message_id: `${RUN_TAG}-${subject}`,
    })
    .select('id')
    .single()
  if (msgError || !msg) throw new Error(`[stage1] intake message: ${msgError?.message}`)

  const { data: review, error: reviewError } = await admin
    .from('intake_reviews')
    .insert({ org_id: fx.orgId, message_id: msg.id })
    .select('id')
    .single()
  if (reviewError || !review) throw new Error(`[stage1] intake review: ${reviewError?.message}`)
  return review.id
}

describe('Stage 1 — shared ticket-creation core (web / core-direct / Email Intake parity)', () => {
  let fx: Fx
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setup()
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  it('web path (createRequest): valid submission creates a fully governed ticket', async () => {
    actAs(fx.requester)
    const fd = new FormData()
    fd.set('service_id', fx.serviceId)
    fd.set('form_data', JSON.stringify({ [TITLE_FIELD_ID]: 'Laptop will not boot', [REQUIRED_SELECT_FIELD_ID]: 'hardware' }))

    const result = await createRequest(fd)
    expect(result.error).toBeUndefined()
    expect(result.requestId).toBeTruthy()

    const { data: row } = await admin
      .from('requests')
      .select('request_no, requester_id, service_id, priority, status, assigned_to, response_due_at, resolution_due_at, form_data')
      .eq('id', result.requestId!)
      .single()

    expect(row?.request_no).toMatch(/^CKSD-\d{6}$/)
    expect(row?.requester_id).toBe(fx.requester.id)
    expect(row?.service_id).toBe(fx.serviceId)
    // No tagged sub-category → falls back to the service's default_priority.
    expect(row?.priority).toBe('low')
    expect(row?.form_data).toMatchObject({ [REQUIRED_SELECT_FIELD_ID]: 'hardware' })
    // SLA resolved from the 'low' tier of the policy (24h response / 48h resolution).
    expect(row?.response_due_at).toBeTruthy()
    expect(row?.resolution_due_at).toBeTruthy()
    // Business Rule ('created' trigger, service_id match) auto-assigned the
    // agent — the "assign" rule action only ever sets assigned_to, unlike the
    // interactive assignRequest() action, which additionally transitions
    // open→assigned; status stays whatever it started as.
    expect(row?.assigned_to).toBe(fx.agent.id)
    expect(row?.status).toBe('open')

    const { data: activity } = await admin
      .from('request_activity')
      .select('action')
      .eq('request_id', result.requestId!)
      .eq('action', 'created')
    expect(activity?.length).toBe(1)
  })

  it('web path (createRequest): missing mandatory select field is rejected before any insert', async () => {
    actAs(fx.requester)
    const fd = new FormData()
    fd.set('service_id', fx.serviceId)
    fd.set('form_data', JSON.stringify({ [TITLE_FIELD_ID]: 'Missing issue type' }))

    const before = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceId)
    const result = await createRequest(fd)
    expect(result.requestId).toBeUndefined()
    expect(result.error).toMatch(/Issue Type is required/i)

    const after = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceId)
    expect(after.count).toBe(before.count)
  })

  it('web path (createRequest): a technician-only field (requester_can_view=false) never blocks requester submission', async () => {
    actAs(fx.requester)
    const fd = new FormData()
    fd.set('service_id', fx.serviceId)
    fd.set('form_data', JSON.stringify({ [TITLE_FIELD_ID]: 'Tech field is not my problem', [REQUIRED_SELECT_FIELD_ID]: 'software' }))
    const result = await createRequest(fd)
    expect(result.error).toBeUndefined()
    expect(result.requestId).toBeTruthy()
  })

  it('core-direct call (no browser session, admin client — the shape a WhatsApp webhook would use): identical governed behavior to the web path', async () => {
    const result = await createRequestCore({
      client: admin,
      orgId: fx.orgId,
      requesterId: fx.otherRequester.id,
      actingUserId: fx.otherRequester.id,
      serviceId: fx.serviceId,
      formData: { [TITLE_FIELD_ID]: 'Printer offline', [REQUIRED_SELECT_FIELD_ID]: 'hardware' },
      source: 'whatsapp',
      useAdminForWrites: true,
    })
    expect(result.error).toBeUndefined()
    expect(result.requestId).toBeTruthy()
    expect(result.requestNo).toMatch(/^CKSD-\d{6}$/)

    const { data: row } = await admin
      .from('requests')
      .select('requester_id, priority, status, assigned_to, response_due_at, resolution_due_at')
      .eq('id', result.requestId!)
      .single()
    expect(row?.requester_id).toBe(fx.otherRequester.id)
    expect(row?.priority).toBe('low')
    expect(row?.response_due_at).toBeTruthy()
    expect(row?.resolution_due_at).toBeTruthy()
    expect(row?.assigned_to).toBe(fx.agent.id) // same Business Rule fired
    expect(row?.status).toBe('open') // "assign" rule action never touches status — see the web-path test above
  })

  it('core-direct call: the same mandatory-field gate rejects an incomplete submission', async () => {
    const result = await createRequestCore({
      client: admin,
      orgId: fx.orgId,
      requesterId: fx.otherRequester.id,
      actingUserId: fx.otherRequester.id,
      serviceId: fx.serviceId,
      formData: { [TITLE_FIELD_ID]: 'No issue type given' },
      source: 'whatsapp',
      useAdminForWrites: true,
    })
    expect(result.requestId).toBeUndefined()
    expect(result.error).toMatch(/Issue Type is required/i)
  })

  it('Email Intake (approveAndCreate, type=request): now receives SLA deadlines and Business Rule assignment — previously both were silently skipped', async () => {
    actAs(fx.agent)
    const reviewId = await createIntakeReview(fx, `${RUN_TAG}-intake-request`)

    const result = await approveAndCreate(
      reviewId,
      { final_type: 'request', final_department: null, final_category: null, final_subcategory: null, final_priority: 'urgent' },
      { type: 'request', title: 'Intake-sourced ticket', description: 'From an email', service_id: fx.intakeServiceId, team_id: fx.teamId }
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.workType !== 'request') throw new Error('expected a request to be created')
    expect(result.workId).toBeTruthy()

    const { data: row } = await admin
      .from('requests')
      .select('status, priority, response_due_at, resolution_due_at, assigned_to, intake_message_id, source_metadata, description')
      .eq('id', result.workId)
      .single()

    // The trusted reviewer-confirmed priority is honored (NOT the service's
    // 'low' default) — decision.final_priority passed through as
    // priorityOverride, exactly preserving Email Intake's pre-existing,
    // human-reviewed priority behavior.
    expect(row?.priority).toBe('urgent')
    // Regression fix #1: SLA is now actually resolved (was always null before).
    expect(row?.response_due_at).toBeTruthy()
    expect(row?.resolution_due_at).toBeTruthy()
    // Regression fix #2: Business Rules now fire for intake-created tickets.
    expect(row?.assigned_to).toBe(fx.agent.id)
    expect(row?.status).toBe('open')
    expect(row?.intake_message_id).toBeTruthy()
    expect((row?.source_metadata as Record<string, unknown> | null)?.created_via).toBe('email_intake')
    expect(row?.description).toBe('From an email')

    const { data: activity } = await admin
      .from('request_activity')
      .select('action')
      .eq('request_id', result.workId)
      .eq('action', 'created')
    expect(activity?.length).toBe(1)
  })

  it('Email Intake (approveAndCreate, type=approval): creates the approvals row and enters pending_approval when a workflow exists', async () => {
    const { data: workflow, error: wfError } = await admin
      .from('approval_workflows')
      .insert({ name: `Stage1 workflow ${RUN_TAG}`, org_id: fx.orgId })
      .select('id')
      .single()
    if (wfError || !workflow) throw new Error(wfError?.message)
    const { error: stepError } = await admin
      .from('approval_workflow_steps')
      .insert({ workflow_id: workflow.id, step_order: 1, approver_type: 'any_manager' })
    if (stepError) throw new Error(stepError.message)
    // Bind it directly to the service so approveAndCreate() resolves THIS
    // workflow deterministically — this shared local DB already has other
    // ad-hoc workflows in the org, so the "any default workflow" fallback
    // (used when a service has none bound) is not reliable to assert against
    // here. Cleared automatically when the workflow row is deleted below
    // (services.approval_workflow_id is ON DELETE SET NULL).
    await admin.from('services').update({ approval_workflow_id: workflow.id }).eq('id', fx.intakeServiceId)

    actAs(fx.agent)
    const reviewId = await createIntakeReview(fx, `${RUN_TAG}-intake-approval`)
    const result = await approveAndCreate(
      reviewId,
      { final_type: 'approval', final_department: null, final_category: null, final_subcategory: null, final_priority: 'medium' },
      { type: 'approval', title: 'Needs sign-off', description: '', service_id: fx.intakeServiceId, team_id: fx.teamId }
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.workType !== 'approval') throw new Error('expected an approval-type request')

    const { data: row } = await admin.from('requests').select('status, response_due_at').eq('id', result.workId).single()
    expect(row?.status).toBe('pending_approval')
    expect(row?.response_due_at).toBeTruthy() // still gets SLA, same fix as the 'request' case

    const { data: approvals } = await admin.from('approvals').select('id, status, workflow_id').eq('request_id', result.workId)
    expect(approvals).toHaveLength(1)
    expect(approvals?.[0].status).toBe('pending')
    expect(approvals?.[0].workflow_id).toBe(workflow.id)

    await admin.from('approvals').delete().eq('request_id', result.workId)
    await admin.from('approval_workflow_steps').delete().eq('workflow_id', workflow.id)
    await admin.from('approval_workflows').delete().eq('id', workflow.id)
  })

  it('Email Intake (approveAndCreate, type=approval): never leaves a ticket stuck in pending_approval with zero approvals rows', async () => {
    // Deliberately does not control whether the org has a fallback workflow
    // configured (this local DB already has ad-hoc ones from manual UAT) —
    // the invariant under test holds either way: status only ever becomes
    // 'pending_approval' together with a real `approvals` row it can
    // actually be resolved through, never on its own. Before this Stage 1
    // fix, the old direct-insert code set status:'pending_approval'
    // unconditionally, so an org with zero workflows at all would strand the
    // ticket in that state forever — the same "stepless workflow" failure
    // class the web path's submitForApproval() is explicitly hardened
    // against (see lib/actions/requests.ts's "Product Decision D" comment).
    actAs(fx.agent)
    const reviewId = await createIntakeReview(fx, `${RUN_TAG}-intake-approval-invariant`)
    const result = await approveAndCreate(
      reviewId,
      { final_type: 'approval', final_department: null, final_category: null, final_subcategory: null, final_priority: 'medium' },
      { type: 'approval', title: 'Never stuck', description: '', service_id: fx.intakeServiceId, team_id: fx.teamId }
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.workType !== 'approval') throw new Error('expected an approval-type request')

    const { data: row } = await admin.from('requests').select('status, response_due_at').eq('id', result.workId).single()
    const { data: approvals } = await admin.from('approvals').select('id').eq('request_id', result.workId)

    expect(row?.response_due_at).toBeTruthy() // SLA fix applies regardless of the workflow outcome
    if (row?.status === 'pending_approval') {
      expect(approvals ?? []).not.toHaveLength(0)
    } else {
      expect(row?.status).toBe('open')
      expect(approvals ?? []).toHaveLength(0)
    }

    if (approvals?.length) await admin.from('approvals').delete().eq('request_id', result.workId)
  })
})
