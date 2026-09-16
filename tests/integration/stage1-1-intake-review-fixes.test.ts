/**
 * Stage 1.1 Task 3/4 — Email Intake Review: required Sub-Category selection
 * and reviewer-suppliable answers for requester-mandatory fields the entity
 * autofill can't infer. Exercises the real approveAndCreate() Server Action
 * (lib/actions/intake/work.ts) end to end against the local Postgres/Auth
 * instance — same pattern as Stage 1's whatsapp-stage1-create-request-core
 * suite — proving the server-side wiring (WorkPayload's new
 * sub_category_id/additional_form_data fields → createRequestCore()) is
 * correct and safe. The Review UI's own client-side preview
 * (RequesterFieldsPanel + the requesterCompletion memo in ReviewClient.tsx)
 * is not covered by a DOM/component test here — see STAGE_1_1_REPORT.md's
 * "Regression Tests Added" section for that scoping decision.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, clientForToken, type TestUser } from '../setup/fixtures-d03'
import { deleteTestOrg } from '../setup/cleanup-org'
import { createTestDepartment, deleteTestDepartment } from '../setup/test-department'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { approveAndCreate } from '@/lib/actions/intake/work'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const RUN_TAG = `stage1-1-intake-${Date.now()}`
const TEAM_PREFIX = `I${Date.now().toString(36).slice(-4).toUpperCase()}`

const SELECT_FIELD_ID = 'issue_type'
const OPTIONAL_FIELD_ID = 'notes'
const TECH_FIELD_ID = 'tech_only'
const TITLE_FIELD_ID = 'subject_line' // label "Subject" — matches buildFormData()'s autofill regex

type Fx = {
  orgId: string
  teamId: string
  serviceId: string // required select + optional + technician-only fields, no sub-category
  serviceWithSubCatId: string // requires a sub-category, no other required fields
  subCategoryId: string
  reviewer: TestUser
  channelId: string
  priorIntakeAccess: boolean
  cleanup: () => Promise<void>
}

async function setup(): Promise<Fx> {
  const admin = getAdmin()

  const { data: priorIntakeAccess } = await admin
    .from('org_module_access')
    .select('enabled')
    .eq('org_id', ORG_ID)
    .eq('module', 'intake')
    .maybeSingle()
  await admin.from('org_module_access').upsert({ org_id: ORG_ID, module: 'intake', enabled: true }, { onConflict: 'org_id,module' })

  const departmentId = await createTestDepartment(admin, `Stage1.1 Intake Department ${RUN_TAG}`, ORG_ID)

  const { data: team, error: teamError } = await admin
    .from('teams')
    .insert({ name: `Stage1.1 Intake Team ${RUN_TAG}`, slug: `stage1-1-intake-team-${RUN_TAG}`, prefix: TEAM_PREFIX, department_id: departmentId, org_id: ORG_ID })
    .select('id')
    .single()
  if (teamError || !team) throw new Error(`[stage1.1 intake fixtures] team: ${teamError?.message}`)

  const { data: service, error: serviceError } = await admin
    .from('services')
    .insert({
      name: `Stage1.1 Intake Service ${RUN_TAG}`,
      slug: `stage1-1-intake-service-${RUN_TAG}`,
      team_id: team.id, org_id: ORG_ID, form_fields: [],
      form_sections: [{
        id: 'sec1', title: 'Details', order: 0,
        fields: [
          { id: TITLE_FIELD_ID, type: 'text', label: 'Subject', required: true, order: 0 },
          { id: SELECT_FIELD_ID, type: 'select', label: 'Issue Type', required: true, order: 1,
            options: [{ value: 'hardware', label: 'Hardware' }, { value: 'software', label: 'Software' }] },
          { id: OPTIONAL_FIELD_ID, type: 'textarea', label: 'Additional Notes', required: false, order: 2 },
          { id: TECH_FIELD_ID, type: 'text', label: 'Technician Only', required: true, order: 3, requester_can_view: false },
        ],
      }],
    })
    .select('id')
    .single()
  if (serviceError || !service) throw new Error(`[stage1.1 intake fixtures] service: ${serviceError?.message}`)

  const { data: serviceWithSubCat, error: serviceWithSubCatError } = await admin
    .from('services')
    .insert({
      name: `Stage1.1 Intake Sub-cat Service ${RUN_TAG}`,
      slug: `stage1-1-intake-subcat-service-${RUN_TAG}`,
      team_id: team.id, org_id: ORG_ID, form_fields: [],
      form_sections: [{ id: 'sec1', title: 'Details', order: 0,
        fields: [{ id: TITLE_FIELD_ID, type: 'text', label: 'Subject', required: true, order: 0 }] }],
    })
    .select('id')
    .single()
  if (serviceWithSubCatError || !serviceWithSubCat) throw new Error(`[stage1.1 intake fixtures] sub-cat service: ${serviceWithSubCatError?.message}`)

  const { data: category, error: categoryError } = await admin
    .from('service_categories')
    .insert({ name: `Stage1.1 Intake Category ${RUN_TAG}`, slug: `stage1-1-intake-category-${RUN_TAG}`, org_id: ORG_ID })
    .select('id')
    .single()
  if (categoryError || !category) throw new Error(`[stage1.1 intake fixtures] category: ${categoryError?.message}`)

  const { data: subCategory, error: subCategoryError } = await admin
    .from('service_sub_categories')
    .insert({ name: `Stage1.1 Intake Sub-category ${RUN_TAG}`, slug: `stage1-1-intake-subcat-${RUN_TAG}`, category_id: category.id })
    .select('id')
    .single()
  if (subCategoryError || !subCategory) throw new Error(`[stage1.1 intake fixtures] sub-category: ${subCategoryError?.message}`)

  const { error: tagError } = await admin
    .from('service_sub_category_tags')
    .insert({ service_id: serviceWithSubCat.id, sub_category_id: subCategory.id })
  if (tagError) throw new Error(`[stage1.1 intake fixtures] tag: ${tagError.message}`)

  const reviewer = await createTestUser('stage1-1-intake-reviewer', 'Stage1.1 Intake Reviewer')
  await admin.from('profiles').update({ role: 'agent', department_id: departmentId }).eq('id', reviewer.id)
  await admin.from('team_members').insert({ team_id: team.id, user_id: reviewer.id, org_id: ORG_ID })

  const { data: channel, error: channelError } = await admin
    .from('intake_channels')
    .insert({ org_id: ORG_ID, type: 'api', name: `Stage1.1 Intake API Channel ${RUN_TAG}` })
    .select('id')
    .single()
  if (channelError || !channel) throw new Error(`[stage1.1 intake fixtures] channel: ${channelError?.message}`)

  return {
    orgId: ORG_ID,
    teamId: team.id,
    serviceId: service.id,
    serviceWithSubCatId: serviceWithSubCat.id,
    subCategoryId: subCategory.id,
    reviewer,
    channelId: channel.id,
    priorIntakeAccess: priorIntakeAccess?.enabled ?? false,
    cleanup: async () => {
      await admin.from('requests').delete().in('service_id', [service.id, serviceWithSubCat.id])
      const { data: msgs } = await admin.from('intake_messages').select('id').eq('channel_id', channel.id)
      const msgIds = (msgs ?? []).map((m: { id: string }) => m.id)
      if (msgIds.length) {
        await admin.from('intake_reviews').delete().in('message_id', msgIds)
        await admin.from('intake_messages').delete().in('id', msgIds)
      }
      await admin.from('intake_channels').delete().eq('id', channel.id)
      await admin.from('team_members').delete().eq('team_id', team.id)
      await admin.from('service_sub_category_tags').delete().eq('service_id', serviceWithSubCat.id)
      await admin.from('service_sub_categories').delete().eq('id', subCategory.id)
      await admin.from('service_categories').delete().eq('id', category.id)
      await admin.from('services').delete().in('id', [service.id, serviceWithSubCat.id])
      await admin.from('teams').delete().eq('id', team.id)
      const { error } = await admin.auth.admin.deleteUser(reviewer.id)
      if (error) console.error('[stage1.1 intake fixtures] cleanup: failed to delete reviewer', error.message)
      await deleteTestDepartment(admin, departmentId)
      await admin.from('org_module_access').upsert({ org_id: ORG_ID, module: 'intake', enabled: priorIntakeAccess?.enabled ?? false }, { onConflict: 'org_id,module' })
    },
  }
}

async function createReview(fx: Fx, subject: string): Promise<string> {
  const admin = getAdmin()
  const { data: msg, error: msgError } = await admin
    .from('intake_messages')
    .insert({ org_id: fx.orgId, channel_id: fx.channelId, subject, body_text: subject, external_message_id: `${RUN_TAG}-${subject}` })
    .select('id')
    .single()
  if (msgError || !msg) throw new Error(`[stage1.1 intake] message: ${msgError?.message}`)

  const { data: review, error: reviewError } = await admin
    .from('intake_reviews')
    .insert({ org_id: fx.orgId, message_id: msg.id })
    .select('id')
    .single()
  if (reviewError || !review) throw new Error(`[stage1.1 intake] review: ${reviewError?.message}`)
  return review.id
}

describe('Stage 1.1 Task 3/4 — Email Intake Review: sub-category + mandatory field UX', () => {
  let fx: Fx
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setup()
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  it('Gap A — service requires a Sub-Category, none chosen: conversion rejected, no request created', async () => {
    actAs(fx.reviewer)
    const reviewId = await createReview(fx, `${RUN_TAG}-no-subcat`)
    const before = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceWithSubCatId)

    const result = await approveAndCreate(
      reviewId,
      { final_type: 'request', final_department: null, final_category: null, final_subcategory: null, final_priority: 'medium' },
      { type: 'request', title: 'Needs a category', description: '', service_id: fx.serviceWithSubCatId, team_id: fx.teamId }
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.error).toBe('Category is required.')

    const after = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceWithSubCatId)
    expect(after.count).toBe(before.count)
  })

  it('Gap A — a valid, same-org Sub-Category is chosen: conversion succeeds', async () => {
    actAs(fx.reviewer)
    const reviewId = await createReview(fx, `${RUN_TAG}-valid-subcat`)

    const result = await approveAndCreate(
      reviewId,
      { final_type: 'request', final_department: null, final_category: null, final_subcategory: null, final_priority: 'medium' },
      { type: 'request', title: 'Subject', description: '', service_id: fx.serviceWithSubCatId, team_id: fx.teamId, sub_category_id: fx.subCategoryId }
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.workType !== 'request') throw new Error('expected a request')

    const { data: row } = await admin.from('requests').select('sub_category_id, category_id').eq('id', result.workId).single()
    expect(row?.sub_category_id).toBe(fx.subCategoryId)
    expect(row?.category_id).toBeTruthy()
  })

  it('cross-org sub-category injection via the reviewer payload: rejected, no request created', async () => {
    const admin2 = getAdmin()
    // A second org + service + sub-category, tagged exclusively to that
    // OTHER service — reusing the same exclusivity-constraint reasoning as
    // the Task 2 security suite, but proven here specifically through the
    // approveAndCreate() Server Action's new sub_category_id payload field.
    const { data: orgB } = await admin2.from('organizations').insert({ name: `Stage1.1 Intake Org B ${RUN_TAG}`, slug: `stage1-1-intake-org-b-${RUN_TAG}` }).select('id').single()
    if (!orgB) throw new Error('failed to create org B')
    const { data: categoryB } = await admin2.from('service_categories').insert({ name: `Stage1.1 Intake Cat B ${RUN_TAG}`, slug: `stage1-1-intake-catb-${RUN_TAG}`, org_id: orgB.id }).select('id').single()
    if (!categoryB) throw new Error('failed to create category B')
    const { data: subCategoryB } = await admin2.from('service_sub_categories').insert({ name: `Stage1.1 Intake Subcat B ${RUN_TAG}`, slug: `stage1-1-intake-subcatb-${RUN_TAG}`, category_id: categoryB.id }).select('id').single()
    if (!subCategoryB) throw new Error('failed to create sub-category B')

    actAs(fx.reviewer)
    const reviewId = await createReview(fx, `${RUN_TAG}-cross-org-subcat`)
    const before = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceWithSubCatId)

    const result = await approveAndCreate(
      reviewId,
      { final_type: 'request', final_department: null, final_category: null, final_subcategory: null, final_priority: 'medium' },
      { type: 'request', title: 'Subject', description: '', service_id: fx.serviceWithSubCatId, team_id: fx.teamId, sub_category_id: subCategoryB.id }
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.error).toBe('Selected category is not valid for this service.')

    const after = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceWithSubCatId)
    expect(after.count).toBe(before.count)

    await admin2.from('service_sub_categories').delete().eq('id', subCategoryB.id)
    await admin2.from('service_categories').delete().eq('id', categoryB.id)
    await deleteTestOrg(admin2, orgB.id)
  })

  it('missing mandatory select (autofill cannot provide it): conversion blocked', async () => {
    actAs(fx.reviewer)
    const reviewId = await createReview(fx, `${RUN_TAG}-missing-select`)

    const result = await approveAndCreate(
      reviewId,
      { final_type: 'request', final_department: null, final_category: null, final_subcategory: null, final_priority: 'medium' },
      { type: 'request', title: 'Subject', description: 'no select given', service_id: fx.serviceId, team_id: fx.teamId }
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.error).toBe('Issue Type is required.')
  })

  it('reviewer supplies a valid select option via additional_form_data: conversion succeeds', async () => {
    actAs(fx.reviewer)
    const reviewId = await createReview(fx, `${RUN_TAG}-valid-select`)

    const result = await approveAndCreate(
      reviewId,
      { final_type: 'request', final_department: null, final_category: null, final_subcategory: null, final_priority: 'medium' },
      {
        type: 'request', title: 'Subject', description: 'now with a select', service_id: fx.serviceId, team_id: fx.teamId,
        additional_form_data: { [SELECT_FIELD_ID]: 'hardware' },
      }
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.workType !== 'request') throw new Error('expected a request')

    const { data: row } = await admin.from('requests').select('form_data').eq('id', result.workId).single()
    expect((row?.form_data as Record<string, unknown>)?.[SELECT_FIELD_ID]).toBe('hardware')
  })

  it('invalid select option (not in the configured options list): rejected', async () => {
    actAs(fx.reviewer)
    const reviewId = await createReview(fx, `${RUN_TAG}-invalid-select`)

    // Stage 3 hardened validateFieldValue() to cross-check select/radio/
    // multiselect values against the field's configured options list (see
    // lib/validation/formFields.ts) — shared by every channel, so an
    // out-of-list value submitted through Email Intake's reviewer conversion
    // is rejected exactly the same as it would be on the web form.
    const result = await approveAndCreate(
      reviewId,
      { final_type: 'request', final_department: null, final_category: null, final_subcategory: null, final_priority: 'medium' },
      {
        type: 'request', title: 'Subject', description: '', service_id: fx.serviceId, team_id: fx.teamId,
        additional_form_data: { [SELECT_FIELD_ID]: 'not-a-real-option' },
      }
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.error).toBe('"not-a-real-option" is not a valid option for "Issue Type".')
  })

  it('optional field left empty: conversion succeeds', async () => {
    actAs(fx.reviewer)
    const reviewId = await createReview(fx, `${RUN_TAG}-optional-empty`)

    const result = await approveAndCreate(
      reviewId,
      { final_type: 'request', final_department: null, final_category: null, final_subcategory: null, final_priority: 'medium' },
      {
        type: 'request', title: 'Subject', description: '', service_id: fx.serviceId, team_id: fx.teamId,
        additional_form_data: { [SELECT_FIELD_ID]: 'software' }, // OPTIONAL_FIELD_ID deliberately omitted
      }
    )
    expect(result.ok).toBe(true)
  })

  it('technician-only field (requester_can_view=false): never blocks conversion, even though it\'s required', async () => {
    actAs(fx.reviewer)
    const reviewId = await createReview(fx, `${RUN_TAG}-tech-only`)

    const result = await approveAndCreate(
      reviewId,
      { final_type: 'request', final_department: null, final_category: null, final_subcategory: null, final_priority: 'medium' },
      {
        type: 'request', title: 'Subject', description: '', service_id: fx.serviceId, team_id: fx.teamId,
        additional_form_data: { [SELECT_FIELD_ID]: 'hardware' }, // TECH_FIELD_ID deliberately never supplied
      }
    )
    expect(result.ok).toBe(true)
  })
})
