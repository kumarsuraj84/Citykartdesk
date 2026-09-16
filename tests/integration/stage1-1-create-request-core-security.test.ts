/**
 * Stage 1.1 Task 2 — createRequestCore() cross-tenant hardening.
 *
 * createRequestCore() is explicitly designed to be called two ways: with an
 * RLS-scoped session client (the web path) or with the service-role admin
 * client (Email Intake today, a future WhatsApp webhook tomorrow — see its
 * own doc comment on `client`). RLS provides no protection in the second
 * case, so every entity the function loads that could reference another
 * tenant must be explicitly re-validated. These tests call the core the way
 * a webhook handler would — admin client, `useAdminForWrites: true` — and
 * assert that a cross-org id anywhere in the input is rejected and never
 * produces a `requests` row.
 *
 * Uses the exact same authorization rules the web creation path already
 * relies on (no new authorization model): org-scoped service/profile/team
 * lookups, the pre-existing exclusivity constraint on
 * service_sub_category_tags, and the pre-existing location-tag check.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { deleteTestOrg } from '../setup/cleanup-org'
import { createTestDepartment, deleteTestDepartment } from '../setup/test-department'
import { createRequestCore } from '@/lib/requests/create-request-core'

const ORG_A_ID = '00000000-0000-0000-0000-000000000001' // the existing seeded org
const RUN_TAG = `stage1-1-sec-${Date.now()}`

type Fx = {
  orgAId: string
  orgBId: string
  teamAId: string
  teamBId: string
  serviceAId: string
  serviceBId: string
  inactiveServiceAId: string
  locationRestrictedServiceAId: string
  locationAId: string
  requesterA: TestUser
  requesterB: TestUser
  subCategoryBId: string
  cleanup: () => Promise<void>
}

async function setup(): Promise<Fx> {
  const admin = getAdmin()

  const { data: orgB, error: orgBError } = await admin
    .from('organizations')
    .insert({ name: `Stage1.1 Security Org B ${RUN_TAG}`, slug: `stage1-1-sec-org-b-${RUN_TAG}` })
    .select('id')
    .single()
  if (orgBError || !orgB) throw new Error(`[stage1.1 security fixtures] org B: ${orgBError?.message}`)

  const { data: deptB, error: deptBError } = await admin
    .from('departments')
    .insert({ name: `Stage1.1 Dept B ${RUN_TAG}`, org_id: orgB.id })
    .select('id')
    .single()
  if (deptBError || !deptB) throw new Error(`[stage1.1 security fixtures] dept B: ${deptBError?.message}`)

  const deptAId = await createTestDepartment(admin, `Stage1.1 Dept A ${RUN_TAG}`, ORG_A_ID)

  const teamAPrefix = `A${Date.now().toString(36).slice(-4).toUpperCase()}`
  const teamBPrefix = `B${Date.now().toString(36).slice(-4).toUpperCase()}`

  const [{ data: teamA, error: teamAError }, { data: teamB, error: teamBError }] = await Promise.all([
    admin.from('teams').insert({
      name: `Stage1.1 Team A ${RUN_TAG}`, slug: `stage1-1-team-a-${RUN_TAG}`, prefix: teamAPrefix,
      department_id: deptAId, org_id: ORG_A_ID,
    }).select('id').single(),
    admin.from('teams').insert({
      name: `Stage1.1 Team B ${RUN_TAG}`, slug: `stage1-1-team-b-${RUN_TAG}`, prefix: teamBPrefix,
      department_id: deptB.id, org_id: orgB.id,
    }).select('id').single(),
  ])
  if (teamAError || !teamA) throw new Error(`[stage1.1 security fixtures] team A: ${teamAError?.message}`)
  if (teamBError || !teamB) throw new Error(`[stage1.1 security fixtures] team B: ${teamBError?.message}`)

  const [
    { data: serviceA, error: serviceAError },
    { data: serviceB, error: serviceBError },
    { data: inactiveServiceA, error: inactiveServiceAError },
    { data: locationRestrictedServiceA, error: locationRestrictedServiceAError },
  ] = await Promise.all([
    admin.from('services').insert({
      name: `Stage1.1 Service A ${RUN_TAG}`, slug: `stage1-1-service-a-${RUN_TAG}`,
      team_id: teamA.id, org_id: ORG_A_ID, form_fields: [], form_sections: [],
    }).select('id').single(),
    admin.from('services').insert({
      name: `Stage1.1 Service B ${RUN_TAG}`, slug: `stage1-1-service-b-${RUN_TAG}`,
      team_id: teamB.id, org_id: orgB.id, form_fields: [], form_sections: [],
    }).select('id').single(),
    admin.from('services').insert({
      name: `Stage1.1 Inactive Service A ${RUN_TAG}`, slug: `stage1-1-inactive-service-a-${RUN_TAG}`,
      team_id: teamA.id, org_id: ORG_A_ID, form_fields: [], form_sections: [], is_active: false,
    }).select('id').single(),
    admin.from('services').insert({
      name: `Stage1.1 Location-Restricted Service A ${RUN_TAG}`, slug: `stage1-1-loc-service-a-${RUN_TAG}`,
      team_id: teamA.id, org_id: ORG_A_ID, form_fields: [], form_sections: [],
    }).select('id').single(),
  ])
  if (serviceAError || !serviceA) throw new Error(`[stage1.1 security fixtures] service A: ${serviceAError?.message}`)
  if (serviceBError || !serviceB) throw new Error(`[stage1.1 security fixtures] service B: ${serviceBError?.message}`)
  if (inactiveServiceAError || !inactiveServiceA) throw new Error(`[stage1.1 security fixtures] inactive service A: ${inactiveServiceAError?.message}`)
  if (locationRestrictedServiceAError || !locationRestrictedServiceA) throw new Error(`[stage1.1 security fixtures] location service A: ${locationRestrictedServiceAError?.message}`)

  // A Sub-Category tagged exclusively to Org B's service — used to prove a
  // cross-org id can never satisfy Org A's service's tagged set.
  const { data: categoryB, error: categoryBError } = await admin
    .from('service_categories')
    .insert({ name: `Stage1.1 Category B ${RUN_TAG}`, slug: `stage1-1-category-b-${RUN_TAG}`, org_id: orgB.id })
    .select('id')
    .single()
  if (categoryBError || !categoryB) throw new Error(`[stage1.1 security fixtures] category B: ${categoryBError?.message}`)

  const { data: subCategoryB, error: subCategoryBError } = await admin
    .from('service_sub_categories')
    .insert({ name: `Stage1.1 Sub-category B ${RUN_TAG}`, slug: `stage1-1-subcat-b-${RUN_TAG}`, category_id: categoryB.id })
    .select('id')
    .single()
  if (subCategoryBError || !subCategoryB) throw new Error(`[stage1.1 security fixtures] sub-category B: ${subCategoryBError?.message}`)

  const { error: tagBError } = await admin
    .from('service_sub_category_tags')
    .insert({ service_id: serviceB.id, sub_category_id: subCategoryB.id })
  if (tagBError) throw new Error(`[stage1.1 security fixtures] tag B: ${tagBError.message}`)

  // A Location tagged to serviceA's location-restricted variant, that the
  // requester is NOT at.
  const { data: location, error: locationError } = await admin
    .from('locations')
    .insert({ name: `Stage1.1 Restricted Location ${RUN_TAG}`, org_id: ORG_A_ID })
    .select('id')
    .single()
  if (locationError || !location) throw new Error(`[stage1.1 security fixtures] location: ${locationError?.message}`)
  const { error: locTagError } = await admin
    .from('service_location_tags')
    .insert({ service_id: locationRestrictedServiceA.id, location_id: location.id })
  if (locTagError) throw new Error(`[stage1.1 security fixtures] location tag: ${locTagError.message}`)

  const [requesterA, requesterB] = await Promise.all([
    createTestUser('stage1-1-sec-requester-a', 'Stage1.1 Requester A'),
    createTestUser('stage1-1-sec-requester-b', 'Stage1.1 Requester B'),
  ])
  // requesterA is already in Org A (default org for newly created test
  // users, matching every other fixture in this suite). requesterB must be
  // moved into Org B.
  const { error: moveBError } = await admin.from('profiles').update({ org_id: orgB.id }).eq('id', requesterB.id)
  if (moveBError) throw new Error(`[stage1.1 security fixtures] move requester B to org B: ${moveBError.message}`)

  return {
    orgAId: ORG_A_ID,
    orgBId: orgB.id,
    teamAId: teamA.id,
    teamBId: teamB.id,
    serviceAId: serviceA.id,
    serviceBId: serviceB.id,
    inactiveServiceAId: inactiveServiceA.id,
    locationRestrictedServiceAId: locationRestrictedServiceA.id,
    locationAId: location.id,
    requesterA,
    requesterB,
    subCategoryBId: subCategoryB.id,
    cleanup: async () => {
      await admin.from('requests').delete().in('service_id', [serviceA.id, serviceB.id, inactiveServiceA.id, locationRestrictedServiceA.id])
      await admin.from('service_location_tags').delete().eq('service_id', locationRestrictedServiceA.id)
      await admin.from('service_sub_category_tags').delete().eq('service_id', serviceB.id)
      await admin.from('service_sub_categories').delete().eq('id', subCategoryB.id)
      await admin.from('service_categories').delete().eq('id', categoryB.id)
      await admin.from('locations').delete().eq('id', location.id)
      await admin.from('services').delete().in('id', [serviceA.id, serviceB.id, inactiveServiceA.id, locationRestrictedServiceA.id])
      await admin.from('teams').delete().in('id', [teamA.id, teamB.id])
      await admin.from('departments').delete().eq('id', deptB.id)
      await deleteTestDepartment(admin, deptAId)
      for (const u of [requesterA, requesterB]) {
        const { error } = await admin.auth.admin.deleteUser(u.id)
        if (error) console.error('[stage1.1 security fixtures] cleanup: failed to delete test user', error.message)
      }
      await deleteTestOrg(admin, orgB.id)
    },
  }
}

async function requestCount(serviceId: string): Promise<number> {
  const admin = getAdmin()
  const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', serviceId)
  return count ?? 0
}

describe('Stage 1.1 Task 2 — createRequestCore() cross-tenant hardening', () => {
  let fx: Fx
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setup()
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  it('2A — requester in Org A, service in Org B: rejected, no request created', async () => {
    const before = await requestCount(fx.serviceBId)
    const result = await createRequestCore({
      client: admin,
      orgId: fx.orgAId,
      requesterId: fx.requesterA.id,
      actingUserId: fx.requesterA.id,
      serviceId: fx.serviceBId, // belongs to Org B
      formData: {},
      source: 'api',
      useAdminForWrites: true,
    })
    expect(result.requestId).toBeUndefined()
    expect(result.error).toBe('Service not found.')
    expect(await requestCount(fx.serviceBId)).toBe(before)
  })

  it('2B — Org A requester/service, Org B sub-category id: rejected (not tagged to this service), no request created', async () => {
    const before = await requestCount(fx.serviceAId)
    const result = await createRequestCore({
      client: admin,
      orgId: fx.orgAId,
      requesterId: fx.requesterA.id,
      actingUserId: fx.requesterA.id,
      serviceId: fx.serviceAId,
      subCategoryId: fx.subCategoryBId, // exclusively tagged to Org B's service
      formData: {},
      source: 'api',
      useAdminForWrites: true,
    })
    expect(result.requestId).toBeUndefined()
    expect(result.error).toBe('Selected category is not valid for this service.')
    expect(await requestCount(fx.serviceAId)).toBe(before)
  })

  it('2C — orgId=Org A, requesterId belongs to Org B: rejected, no request created (Stage 1.1 fix — previously silently ignored)', async () => {
    const before = await requestCount(fx.serviceAId)
    const result = await createRequestCore({
      client: admin,
      orgId: fx.orgAId,
      requesterId: fx.requesterB.id, // belongs to Org B
      actingUserId: fx.requesterB.id,
      serviceId: fx.serviceAId,
      formData: {},
      source: 'api',
      useAdminForWrites: true,
    })
    expect(result.requestId).toBeUndefined()
    expect(result.error).toBe('Requester not found.')
    expect(await requestCount(fx.serviceAId)).toBe(before)
  })

  it('2D — Org A request, teamIdOverride from Org B: rejected, no request created', async () => {
    const before = await requestCount(fx.serviceAId)
    const result = await createRequestCore({
      client: admin,
      orgId: fx.orgAId,
      requesterId: fx.requesterA.id,
      actingUserId: fx.requesterA.id,
      serviceId: fx.serviceAId,
      formData: {},
      source: 'email_intake',
      useAdminForWrites: true,
      teamIdOverride: fx.teamBId, // belongs to Org B
    })
    expect(result.requestId).toBeUndefined()
    expect(result.error).toBe('Selected team not found.')
    expect(await requestCount(fx.serviceAId)).toBe(before)
  })

  it('2E — inactive service: rejected, no request created', async () => {
    const before = await requestCount(fx.inactiveServiceAId)
    const result = await createRequestCore({
      client: admin,
      orgId: fx.orgAId,
      requesterId: fx.requesterA.id,
      actingUserId: fx.requesterA.id,
      serviceId: fx.inactiveServiceAId,
      formData: {},
      source: 'api',
      useAdminForWrites: true,
    })
    expect(result.requestId).toBeUndefined()
    expect(result.error).toBe('Service not found.')
    expect(await requestCount(fx.inactiveServiceAId)).toBe(before)
  })

  it('2F — location-restricted service, requester (role=user) not at an allowed location: rejected, no request created', async () => {
    const before = await requestCount(fx.locationRestrictedServiceAId)
    const result = await createRequestCore({
      client: admin,
      orgId: fx.orgAId,
      requesterId: fx.requesterA.id,
      actingUserId: fx.requesterA.id,
      serviceId: fx.locationRestrictedServiceAId,
      formData: {},
      source: 'web',
      useAdminForWrites: true,
      actingUserRoleForLocationCheck: 'user',
      actingUserLocationId: null, // not at the tagged location
    })
    expect(result.requestId).toBeUndefined()
    expect(result.error).toBe('Service not found.')
    expect(await requestCount(fx.locationRestrictedServiceAId)).toBe(before)
  })

  it('2F (control) — same location-restricted service, requester AT the allowed location: succeeds', async () => {
    const result = await createRequestCore({
      client: admin,
      orgId: fx.orgAId,
      requesterId: fx.requesterA.id,
      actingUserId: fx.requesterA.id,
      serviceId: fx.locationRestrictedServiceAId,
      formData: {},
      source: 'web',
      useAdminForWrites: true,
      actingUserRoleForLocationCheck: 'user',
      actingUserLocationId: fx.locationAId,
    })
    expect(result.error).toBeUndefined()
    expect(result.requestId).toBeTruthy()
  })

  it('2F (control) — agent-tier acting user is exempt from the location restriction even when not at the location', async () => {
    const result = await createRequestCore({
      client: admin,
      orgId: fx.orgAId,
      requesterId: fx.requesterA.id,
      actingUserId: fx.requesterA.id,
      serviceId: fx.locationRestrictedServiceAId,
      formData: {},
      source: 'web',
      useAdminForWrites: true,
      actingUserRoleForLocationCheck: 'agent',
      actingUserLocationId: null,
    })
    expect(result.error).toBeUndefined()
    expect(result.requestId).toBeTruthy()
  })

  it('control — a genuinely valid, same-org creation still succeeds (the hardening above didn\'t break the happy path)', async () => {
    const result = await createRequestCore({
      client: admin,
      orgId: fx.orgAId,
      requesterId: fx.requesterA.id,
      actingUserId: fx.requesterA.id,
      serviceId: fx.serviceAId,
      formData: {},
      source: 'api',
      useAdminForWrites: true,
    })
    expect(result.error).toBeUndefined()
    expect(result.requestId).toBeTruthy()
  })
})
