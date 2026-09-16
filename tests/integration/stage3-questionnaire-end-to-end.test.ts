/**
 * Stage 3.1, Step 17 (corrected) — an optional-but-desirable end-to-end
 * proof: drives a draft through the FULL questionnaire pipeline (catalog →
 * sub-category search/selection → description collection → title generation
 * → question plan → answer → review readiness → adapter) and then feeds the
 * adapter's output straight into the real, unmodified (except for the new
 * optional `titleOverride` param) createRequestCore() — admin client,
 * useAdminForWrites, the shape a WhatsApp webhook would use.
 *
 * This is the corrected version of the Stage 3 end-to-end test: it now
 * proves the Stage 3.1 contract instead of the old (incorrect)
 * description-auto-satisfies-a-textarea behavior —
 *
 *   draft.description → requests.description  (exact, independent)
 *   draft.title       → requests.title         (exact, independent — Review/Create parity)
 *   draft.answers     → requests.form_data      (exact, independent)
 *
 * — including a dynamic "Business Justification" textarea field that the
 * description must NOT auto-satisfy; it has to be answered explicitly like
 * any other mandatory field.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { createTestDepartment, deleteTestDepartment } from '../setup/test-department'

// lib/sla/business-hours.ts (via resolveSlaDeadlines(), called inside
// createRequestCore()) reads org business-hours config through the RLS-scoped
// createClient() — mocked the same way tests/integration/
// whatsapp-stage1-create-request-core.test.ts does, since this test runs
// outside any Next.js request scope (no real `cookies()` to read from).
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createRequestCore } from '@/lib/requests/create-request-core'

const mockedCreateClient = vi.mocked(createClient)
import { createEmptyDraft } from '@/lib/requests/questionnaire/types'
import { listQuestionnaireServices, searchSubCategories } from '@/lib/requests/questionnaire/catalog'
import { selectSubCategoryForDraft } from '@/lib/requests/questionnaire/subcategory'
import { resolveDraftFormFields, getNextQuestion } from '@/lib/requests/questionnaire/question-plan'
import { applyQuestionAnswer } from '@/lib/requests/questionnaire/answers'
import { checkDraftReadiness, buildReviewModel } from '@/lib/requests/questionnaire/review'
import { generateRequestTitle } from '@/lib/requests/questionnaire/title'
import { buildCreateRequestInputFromDraft } from '@/lib/requests/questionnaire/adapter'

const EXISTING_ORG_ID = '00000000-0000-0000-0000-000000000001'
const RUN_TAG = `stage3-1-e2e-${Date.now()}`
const TEAM_PREFIX = `F${Date.now().toString(36).slice(-4).toUpperCase()}`

// A dynamic textarea that is DELIBERATELY unrelated to the requester's own
// issue description — proves the two concepts never get conflated, even
// though both are free text.
const BUSINESS_JUSTIFICATION_FIELD_ID = 'business_justification'
const ISSUE_TYPE_FIELD_ID = 'issue_type'

type Fx = {
  orgId: string
  teamId: string
  serviceId: string
  slaPolicyId: string
  subCategoryId: string
  requester: TestUser
  cleanup: () => Promise<void>
}

async function setup(): Promise<Fx> {
  const admin = getAdmin()

  const departmentId = await createTestDepartment(admin, `Stage3.1 E2E Department ${RUN_TAG}`, EXISTING_ORG_ID)

  const { data: team, error: teamError } = await admin
    .from('teams')
    .insert({ name: `Stage3.1 E2E Team ${RUN_TAG}`, slug: `stage3-1-e2e-team-${RUN_TAG}`, prefix: TEAM_PREFIX, department_id: departmentId, org_id: EXISTING_ORG_ID })
    .select('id').single()
  if (teamError || !team) throw new Error(`[stage3.1 e2e fixtures] team: ${teamError?.message}`)

  const { data: slaPolicy, error: slaError } = await admin
    .from('sla_policies')
    .insert({
      org_id: EXISTING_ORG_ID,
      name: `Stage3.1 E2E SLA Policy ${RUN_TAG}`,
      config: {
        low: { response_hours: 24, resolution_hours: 48 },
        medium: { response_hours: 8, resolution_hours: 16 },
        urgent: { response_hours: 1, resolution_hours: 2 },
      },
    })
    .select('id').single()
  if (slaError || !slaPolicy) throw new Error(`[stage3.1 e2e fixtures] sla policy: ${slaError?.message}`)

  const { data: service, error: serviceError } = await admin
    .from('services')
    .insert({
      name: `Stage3.1 E2E Service ${RUN_TAG}`,
      slug: `stage3-1-e2e-service-${RUN_TAG}`,
      team_id: team.id,
      org_id: EXISTING_ORG_ID,
      default_priority: 'low',
      sla_policy_id: slaPolicy.id,
      status: 'published',
      form_fields: [],
      form_sections: [{
        id: 'sec1', title: 'Details', order: 0,
        fields: [
          { id: BUSINESS_JUSTIFICATION_FIELD_ID, type: 'textarea', label: 'Business Justification', required: true, order: 0 },
          { id: ISSUE_TYPE_FIELD_ID, type: 'select', label: 'Issue Type', required: true, order: 1,
            options: [{ value: 'hardware', label: 'Hardware' }, { value: 'software', label: 'Software' }] },
        ],
      }],
    })
    .select('id').single()
  if (serviceError || !service) throw new Error(`[stage3.1 e2e fixtures] service: ${serviceError?.message}`)

  const { data: category, error: categoryError } = await admin
    .from('service_categories')
    .insert({ name: `Stage3.1 E2E Category ${RUN_TAG}`, slug: `stage3-1-e2e-category-${RUN_TAG}`, org_id: EXISTING_ORG_ID })
    .select('id').single()
  if (categoryError || !category) throw new Error(`[stage3.1 e2e fixtures] category: ${categoryError?.message}`)

  const { data: subCategory, error: subCategoryError } = await admin
    .from('service_sub_categories')
    .insert({ name: `AC Not Cooling ${RUN_TAG}`, slug: `stage3-1-e2e-subcat-${RUN_TAG}`, category_id: category.id, is_active: true, sla_priority: 'urgent' })
    .select('id').single()
  if (subCategoryError || !subCategory) throw new Error(`[stage3.1 e2e fixtures] sub-category: ${subCategoryError?.message}`)

  const { error: tagError } = await admin.from('service_sub_category_tags').insert({ service_id: service.id, sub_category_id: subCategory.id })
  if (tagError) throw new Error(`[stage3.1 e2e fixtures] tag: ${tagError.message}`)

  const requester = await createTestUser('stage3-1-e2e-requester', 'Stage3.1 E2E Requester')

  return {
    orgId: EXISTING_ORG_ID,
    teamId: team.id,
    serviceId: service.id,
    slaPolicyId: slaPolicy.id,
    subCategoryId: subCategory.id,
    requester,
    cleanup: async () => {
      await admin.from('requests').delete().eq('service_id', service.id)
      await admin.from('service_sub_category_tags').delete().eq('service_id', service.id)
      await admin.from('service_sub_categories').delete().eq('id', subCategory.id)
      await admin.from('service_categories').delete().eq('id', category.id)
      await admin.from('services').delete().eq('id', service.id)
      await admin.from('sla_policies').delete().eq('id', slaPolicy.id)
      await admin.from('teams').delete().eq('id', team.id)
      await deleteTestDepartment(admin, departmentId)
      const { error } = await admin.auth.admin.deleteUser(requester.id)
      if (error) console.error('[stage3.1 e2e fixtures] cleanup: failed to delete test user', error.message)
    },
  }
}

describe('Stage 3.1, Step 17 — corrected description/title contract, end-to-end', () => {
  let fx: Fx
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setup()
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  it('walks the full pipeline: description → requests.description, title → requests.title, answers → requests.form_data — all independent', async () => {
    mockedCreateClient.mockResolvedValue(admin as never)

    // Step 2/3: catalog + search.
    const services = await listQuestionnaireServices({ client: admin, orgId: fx.orgId })
    const service = services.find((s) => s.id === fx.serviceId)
    expect(service).toBeTruthy()

    const searchResults = await searchSubCategories({ client: admin, orgId: fx.orgId, serviceId: fx.serviceId, query: 'cooling' })
    expect(searchResults[0]?.id).toBe(fx.subCategoryId)

    // Step 4/5: revalidate + derive category.
    const selection = await selectSubCategoryForDraft({ client: admin, orgId: fx.orgId, serviceId: fx.serviceId, subCategoryId: searchResults[0].id })
    expect(selection.ok).toBe(true)
    if (!selection.ok) throw new Error('expected ok')

    let draft = { ...createEmptyDraft({ orgId: fx.orgId, requesterId: fx.requester.id }), serviceId: fx.serviceId, subCategoryId: selection.subCategoryId, categoryId: selection.categoryId }

    // Step 6: description collection — a first-class draft property, never
    // written into `answers`.
    const issueDescription = 'The AC unit in Store 12 has stopped cooling entirely since this morning.'
    draft = { ...draft, description: issueDescription }

    // Step 7: title generation, once — Review and creation must both use
    // this exact value with no regeneration (idempotency).
    const generatedTitle = await generateRequestTitle({ serviceName: service!.name, subCategoryName: searchResults[0].name, description: draft.description })
    draft = { ...draft, title: generatedTitle }

    // Step 8/9/10: resolve form; the Business Justification textarea must
    // still be in the question plan — draft.description does NOT satisfy it.
    const { data: serviceRow } = await admin.from('services').select('form_sections, form_fields, template:form_templates(form_sections)').eq('id', fx.serviceId).single()
    const allFields = resolveDraftFormFields(serviceRow!)

    const firstQuestion = getNextQuestion(allFields, draft.answers)
    expect(firstQuestion?.id).toBe(BUSINESS_JUSTIFICATION_FIELD_ID)

    // Step 12: answer both mandatory fields explicitly through `answers` —
    // this is the ONLY way either becomes satisfied.
    const businessJustificationText = 'Store cannot operate the billing counter without functioning AC in peak summer.'
    const answer1 = applyQuestionAnswer({ field: firstQuestion!, rawValue: businessJustificationText, answers: draft.answers })
    expect(answer1.ok).toBe(true)
    if (!answer1.ok) throw new Error('expected ok')
    draft = { ...draft, answers: answer1.answers }

    const secondQuestion = getNextQuestion(allFields, draft.answers)
    expect(secondQuestion?.id).toBe(ISSUE_TYPE_FIELD_ID)
    const answer2 = applyQuestionAnswer({ field: secondQuestion!, rawValue: 'hardware', answers: draft.answers })
    expect(answer2.ok).toBe(true)
    if (!answer2.ok) throw new Error('expected ok')
    draft = { ...draft, answers: answer2.answers }

    expect(getNextQuestion(allFields, draft.answers)).toBeNull()

    // Step 14: readiness.
    const readiness = checkDraftReadiness(serviceRow!, draft.answers)
    expect(readiness.valid).toBe(true)

    // Step 15: review model — must show the SAME title/description that
    // will be stored, and the textarea's own answer (not the description).
    const review = buildReviewModel({ draft, service: { id: fx.serviceId, name: service!.name, ...serviceRow! }, subCategoryName: searchResults[0].name })
    expect(review.ready).toBe(true)
    expect(review.title).toBe(generatedTitle)
    expect(review.description).toBe(issueDescription)
    expect(review.fields.find((f) => f.fieldId === BUSINESS_JUSTIFICATION_FIELD_ID)?.value).toBe(businessJustificationText)
    expect(review.fields.find((f) => f.fieldId === ISSUE_TYPE_FIELD_ID)?.displayValue).toBe('Hardware')
    // The description text must not leak into any field entry.
    expect(review.fields.some((f) => f.value === issueDescription)).toBe(false)

    // Step 16: adapter — independent mapping, no cross-contamination.
    const adapted = buildCreateRequestInputFromDraft({ draft, service: serviceRow!, source: 'whatsapp' })
    expect(adapted.ok).toBe(true)
    if (!adapted.ok) throw new Error('expected ok')
    expect(adapted.input.description).toBe(issueDescription)
    expect(adapted.input.titleOverride).toBe(generatedTitle)
    expect(adapted.input.formData).toEqual({ [BUSINESS_JUSTIFICATION_FIELD_ID]: businessJustificationText, [ISSUE_TYPE_FIELD_ID]: 'hardware' })

    // Actual creation — real createRequestCore() call.
    const result = await createRequestCore({ client: admin, ...adapted.input })
    expect(result.error).toBeUndefined()
    expect(result.requestId).toBeTruthy()
    if (!result.requestId) throw new Error('expected requestId')

    const { data: created } = await admin
      .from('requests')
      .select('title, description, priority, sub_category_id, category_id, response_due_at, resolution_due_at, form_data, source_metadata')
      .eq('id', result.requestId)
      .single()

    // Priority comes from the sub-category's own sla_priority ('urgent'),
    // never from anything the draft/adapter set directly.
    expect(created?.priority).toBe('urgent')
    expect(created?.sub_category_id).toBe(fx.subCategoryId)
    expect(created?.category_id).toBeTruthy()
    // SLA deadlines actually resolved (not null) — proves Business
    // Rules/SLA machinery ran exactly as it does for a normal web ticket.
    expect(created?.response_due_at).toBeTruthy()
    expect(created?.resolution_due_at).toBeTruthy()

    // TEST 5 — Review/Create title parity: EXACT match, no service-name
    // prefix added, no re-derivation from form_data.
    expect(created?.title).toBe(generatedTitle)
    expect(created?.title).toBe(review.title)

    // TEST 6 — description DB parity: exact match (aside from trim).
    expect(created?.description).toBe(issueDescription)
    expect(created?.description).toBe(review.description)

    // form_data holds exactly the two explicit answers — the description
    // text never appears anywhere inside it.
    const formData = created?.form_data as Record<string, unknown>
    expect(formData).toEqual({ [BUSINESS_JUSTIFICATION_FIELD_ID]: businessJustificationText, [ISSUE_TYPE_FIELD_ID]: 'hardware' })
    expect(Object.values(formData)).not.toContain(issueDescription)
  })
})
