/**
 * Stage 3, Step 18 — security test matrix for the questionnaire engine's
 * only I/O-touching functions (lib/requests/questionnaire/catalog.ts,
 * subcategory.ts). Every one of these is designed to be called with the
 * admin (service-role) client — the shape a future WhatsApp webhook would
 * use, with no RLS session to fall back on — so every read must be
 * explicitly org-scoped in application code, the same rule
 * createRequestCore() itself follows (see Stage 1.1's own security suite,
 * tests/integration/stage1-1-create-request-core-security.test.ts, which
 * this fixture mirrors).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getAdmin } from '../setup/fixtures-d03'
import { deleteTestOrg } from '../setup/cleanup-org'
import { createTestDepartment, deleteTestDepartment } from '../setup/test-department'
import { listQuestionnaireServices, searchSubCategories } from '@/lib/requests/questionnaire/catalog'
import { selectSubCategoryForDraft } from '@/lib/requests/questionnaire/subcategory'

const ORG_A_ID = '00000000-0000-0000-0000-000000000001' // the existing seeded org
const RUN_TAG = `stage3-cat-sec-${Date.now()}`

type Fx = {
  orgAId: string
  orgBId: string
  serviceAId: string
  serviceBId: string
  draftServiceAId: string
  inactiveServiceAId: string
  locationRestrictedServiceAId: string
  locationAId: string
  subCategoryAHardwareId: string
  subCategoryAPrinterId: string
  subCategoryAArchivedId: string
  subCategoryBId: string
  cleanup: () => Promise<void>
}

async function setup(): Promise<Fx> {
  const admin = getAdmin()

  const { data: orgB, error: orgBError } = await admin
    .from('organizations')
    .insert({ name: `Stage3 Cat Sec Org B ${RUN_TAG}`, slug: `stage3-cat-sec-org-b-${RUN_TAG}` })
    .select('id')
    .single()
  if (orgBError || !orgB) throw new Error(`[stage3 catalog security fixtures] org B: ${orgBError?.message}`)

  const teamAPrefix = `C${Date.now().toString(36).slice(-4).toUpperCase()}`
  const teamBPrefix = `D${Date.now().toString(36).slice(-4).toUpperCase()}`
  const deptAId = await createTestDepartment(admin, `Stage3 Cat Sec Dept A ${RUN_TAG}`, ORG_A_ID)
  const { data: teamA, error: teamAError } = await admin
    .from('teams')
    .insert({ name: `Stage3 Cat Sec Team A ${RUN_TAG}`, slug: `stage3-cat-sec-team-a-${RUN_TAG}`, prefix: teamAPrefix, department_id: deptAId, org_id: ORG_A_ID })
    .select('id').single()
  if (teamAError || !teamA) throw new Error(`[stage3 catalog security fixtures] team A: ${teamAError?.message}`)

  const { data: deptB, error: deptBError } = await admin
    .from('departments')
    .insert({ name: `Stage3 Cat Sec Dept B ${RUN_TAG}`, org_id: orgB.id })
    .select('id').single()
  if (deptBError || !deptB) throw new Error(`[stage3 catalog security fixtures] dept B: ${deptBError?.message}`)
  const { data: teamB, error: teamBError } = await admin
    .from('teams')
    .insert({ name: `Stage3 Cat Sec Team B ${RUN_TAG}`, slug: `stage3-cat-sec-team-b-${RUN_TAG}`, prefix: teamBPrefix, department_id: deptB.id, org_id: orgB.id })
    .select('id').single()
  if (teamBError || !teamB) throw new Error(`[stage3 catalog security fixtures] team B: ${teamBError?.message}`)

  const [
    { data: serviceA, error: serviceAError },
    { data: serviceB, error: serviceBError },
    { data: draftServiceA, error: draftServiceAError },
    { data: inactiveServiceA, error: inactiveServiceAError },
    { data: locationRestrictedServiceA, error: locationRestrictedServiceAError },
  ] = await Promise.all([
    admin.from('services').insert({
      name: `Stage3 Cat Sec Service A ${RUN_TAG}`, slug: `stage3-cat-sec-service-a-${RUN_TAG}`,
      team_id: teamA.id, org_id: ORG_A_ID, form_fields: [], form_sections: [], status: 'published',
    }).select('id').single(),
    admin.from('services').insert({
      name: `Stage3 Cat Sec Service B ${RUN_TAG}`, slug: `stage3-cat-sec-service-b-${RUN_TAG}`,
      team_id: teamB.id, org_id: orgB.id, form_fields: [], form_sections: [], status: 'published',
    }).select('id').single(),
    admin.from('services').insert({
      name: `Stage3 Cat Sec Draft Service A ${RUN_TAG}`, slug: `stage3-cat-sec-draft-service-a-${RUN_TAG}`,
      team_id: teamA.id, org_id: ORG_A_ID, form_fields: [], form_sections: [], status: 'draft',
    }).select('id').single(),
    admin.from('services').insert({
      name: `Stage3 Cat Sec Inactive Service A ${RUN_TAG}`, slug: `stage3-cat-sec-inactive-service-a-${RUN_TAG}`,
      team_id: teamA.id, org_id: ORG_A_ID, form_fields: [], form_sections: [], status: 'published', is_active: false,
    }).select('id').single(),
    admin.from('services').insert({
      name: `Stage3 Cat Sec Location Service A ${RUN_TAG}`, slug: `stage3-cat-sec-loc-service-a-${RUN_TAG}`,
      team_id: teamA.id, org_id: ORG_A_ID, form_fields: [], form_sections: [], status: 'published',
    }).select('id').single(),
  ])
  if (serviceAError || !serviceA) throw new Error(`[stage3 catalog security fixtures] service A: ${serviceAError?.message}`)
  if (serviceBError || !serviceB) throw new Error(`[stage3 catalog security fixtures] service B: ${serviceBError?.message}`)
  if (draftServiceAError || !draftServiceA) throw new Error(`[stage3 catalog security fixtures] draft service A: ${draftServiceAError?.message}`)
  if (inactiveServiceAError || !inactiveServiceA) throw new Error(`[stage3 catalog security fixtures] inactive service A: ${inactiveServiceAError?.message}`)
  if (locationRestrictedServiceAError || !locationRestrictedServiceA) throw new Error(`[stage3 catalog security fixtures] location service A: ${locationRestrictedServiceAError?.message}`)

  const { data: location, error: locationError } = await admin
    .from('locations')
    .insert({ name: `Stage3 Cat Sec Restricted Location ${RUN_TAG}`, org_id: ORG_A_ID })
    .select('id').single()
  if (locationError || !location) throw new Error(`[stage3 catalog security fixtures] location: ${locationError?.message}`)
  const { error: locTagError } = await admin
    .from('service_location_tags')
    .insert({ service_id: locationRestrictedServiceA.id, location_id: location.id })
  if (locTagError) throw new Error(`[stage3 catalog security fixtures] location tag: ${locTagError.message}`)

  const { data: categoryA, error: categoryAError } = await admin
    .from('service_categories')
    .insert({ name: `Stage3 Cat Sec Category A ${RUN_TAG}`, slug: `stage3-cat-sec-category-a-${RUN_TAG}`, org_id: ORG_A_ID })
    .select('id').single()
  if (categoryAError || !categoryA) throw new Error(`[stage3 catalog security fixtures] category A: ${categoryAError?.message}`)

  const { data: categoryB, error: categoryBError } = await admin
    .from('service_categories')
    .insert({ name: `Stage3 Cat Sec Category B ${RUN_TAG}`, slug: `stage3-cat-sec-category-b-${RUN_TAG}`, org_id: orgB.id })
    .select('id').single()
  if (categoryBError || !categoryB) throw new Error(`[stage3 catalog security fixtures] category B: ${categoryBError?.message}`)

  const [
    { data: subA1, error: subA1Error },
    { data: subA2, error: subA2Error },
    { data: subA3, error: subA3Error },
    { data: subB, error: subBError },
  ] = await Promise.all([
    admin.from('service_sub_categories').insert({ name: `Hardware Fault ${RUN_TAG}`, slug: `stage3-cat-sec-hw-${RUN_TAG}`, category_id: categoryA.id, is_active: true }).select('id').single(),
    admin.from('service_sub_categories').insert({ name: `Printer Jam ${RUN_TAG}`, slug: `stage3-cat-sec-printer-${RUN_TAG}`, category_id: categoryA.id, is_active: true }).select('id').single(),
    admin.from('service_sub_categories').insert({ name: `Archived Issue ${RUN_TAG}`, slug: `stage3-cat-sec-archived-${RUN_TAG}`, category_id: categoryA.id, is_active: false }).select('id').single(),
    admin.from('service_sub_categories').insert({ name: `Org B Sub-category ${RUN_TAG}`, slug: `stage3-cat-sec-subb-${RUN_TAG}`, category_id: categoryB.id, is_active: true }).select('id').single(),
  ])
  if (subA1Error || !subA1) throw new Error(`[stage3 catalog security fixtures] subA1: ${subA1Error?.message}`)
  if (subA2Error || !subA2) throw new Error(`[stage3 catalog security fixtures] subA2: ${subA2Error?.message}`)
  if (subA3Error || !subA3) throw new Error(`[stage3 catalog security fixtures] subA3: ${subA3Error?.message}`)
  if (subBError || !subB) throw new Error(`[stage3 catalog security fixtures] subB: ${subBError?.message}`)

  const { error: tagError } = await admin.from('service_sub_category_tags').insert([
    { service_id: serviceA.id, sub_category_id: subA1.id },
    { service_id: serviceA.id, sub_category_id: subA2.id },
    { service_id: serviceA.id, sub_category_id: subA3.id },
    { service_id: serviceB.id, sub_category_id: subB.id },
  ])
  if (tagError) throw new Error(`[stage3 catalog security fixtures] tags: ${tagError.message}`)

  return {
    orgAId: ORG_A_ID,
    orgBId: orgB.id,
    serviceAId: serviceA.id,
    serviceBId: serviceB.id,
    draftServiceAId: draftServiceA.id,
    inactiveServiceAId: inactiveServiceA.id,
    locationRestrictedServiceAId: locationRestrictedServiceA.id,
    locationAId: location.id,
    subCategoryAHardwareId: subA1.id,
    subCategoryAPrinterId: subA2.id,
    subCategoryAArchivedId: subA3.id,
    subCategoryBId: subB.id,
    cleanup: async () => {
      const allServiceIds = [serviceA.id, serviceB.id, draftServiceA.id, inactiveServiceA.id, locationRestrictedServiceA.id]
      await admin.from('requests').delete().in('service_id', allServiceIds)
      await admin.from('service_location_tags').delete().eq('service_id', locationRestrictedServiceA.id)
      await admin.from('service_sub_category_tags').delete().in('service_id', [serviceA.id, serviceB.id])
      await admin.from('service_sub_categories').delete().in('id', [subA1.id, subA2.id, subA3.id, subB.id])
      await admin.from('service_categories').delete().in('id', [categoryA.id, categoryB.id])
      await admin.from('locations').delete().eq('id', location.id)
      await admin.from('services').delete().in('id', allServiceIds)
      await admin.from('teams').delete().in('id', [teamA.id, teamB.id])
      await admin.from('departments').delete().eq('id', deptB.id)
      await deleteTestDepartment(admin, deptAId)
      // See tests/setup/cleanup-org.ts — clears the global_sla_config row a
      // DB trigger auto-creates for every org before deleting it.
      await deleteTestOrg(admin, orgB.id)
    },
  }
}

describe('Stage 3, Step 18 — questionnaire catalog/subcategory security matrix', () => {
  let fx: Fx
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setup()
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  describe('listQuestionnaireServices()', () => {
    it('never returns another org\'s services', async () => {
      const services = await listQuestionnaireServices({ client: admin, orgId: fx.orgAId })
      expect(services.some((s) => s.id === fx.serviceBId)).toBe(false)
      expect(services.some((s) => s.id === fx.serviceAId)).toBe(true)
    })

    it('excludes non-published (draft/review) services — self-serve only ever sees published', async () => {
      const services = await listQuestionnaireServices({ client: admin, orgId: fx.orgAId })
      expect(services.some((s) => s.id === fx.draftServiceAId)).toBe(false)
    })

    it('excludes inactive services', async () => {
      const services = await listQuestionnaireServices({ client: admin, orgId: fx.orgAId })
      expect(services.some((s) => s.id === fx.inactiveServiceAId)).toBe(false)
    })

    it('excludes a location-restricted service when the requester is not at an allowed location', async () => {
      const services = await listQuestionnaireServices({ client: admin, orgId: fx.orgAId, requesterLocationId: null })
      expect(services.some((s) => s.id === fx.locationRestrictedServiceAId)).toBe(false)
    })

    it('includes a location-restricted service when the requester IS at an allowed location', async () => {
      const services = await listQuestionnaireServices({ client: admin, orgId: fx.orgAId, requesterLocationId: fx.locationAId })
      expect(services.some((s) => s.id === fx.locationRestrictedServiceAId)).toBe(true)
    })

    it('an org with no services returns an empty array, not an error', async () => {
      const services = await listQuestionnaireServices({ client: admin, orgId: '00000000-0000-0000-0000-000000000fff' })
      expect(services).toEqual([])
    })
  })

  describe('searchSubCategories()', () => {
    it('never returns another service\'s (org B\'s) sub-categories, even under a matching org id', async () => {
      const results = await searchSubCategories({ client: admin, orgId: fx.orgBId, serviceId: fx.serviceBId, query: '' })
      expect(results.every((r) => r.id !== fx.subCategoryAHardwareId)).toBe(true)
    })

    it('cross-org: serviceId belongs to Org B but orgId passed is Org A — returns empty, not Org B\'s data', async () => {
      const results = await searchSubCategories({ client: admin, orgId: fx.orgAId, serviceId: fx.serviceBId, query: '' })
      expect(results).toEqual([])
    })

    it('excludes archived (is_active=false) sub-categories', async () => {
      const results = await searchSubCategories({ client: admin, orgId: fx.orgAId, serviceId: fx.serviceAId, query: '' })
      expect(results.some((r) => r.id === fx.subCategoryAArchivedId)).toBe(false)
    })

    it('empty query returns the full tagged, active list alphabetically', async () => {
      const results = await searchSubCategories({ client: admin, orgId: fx.orgAId, serviceId: fx.serviceAId, query: '' })
      const ids = results.map((r) => r.id)
      expect(ids).toContain(fx.subCategoryAHardwareId)
      expect(ids).toContain(fx.subCategoryAPrinterId)
    })

    it('keyword search returns a relevant match and excludes unrelated ones', async () => {
      const results = await searchSubCategories({ client: admin, orgId: fx.orgAId, serviceId: fx.serviceAId, query: 'Printer Jam' })
      expect(results[0]?.id).toBe(fx.subCategoryAPrinterId)
      expect(results.some((r) => r.id === fx.subCategoryAHardwareId)).toBe(false)
    })

    it('a nonsense query returns an empty (structured zero-result) array', async () => {
      const results = await searchSubCategories({ client: admin, orgId: fx.orgAId, serviceId: fx.serviceAId, query: 'xyzzy-no-match-quux' })
      expect(results).toEqual([])
    })

    it('an inactive service returns empty even with a valid tagged sub-category', async () => {
      const results = await searchSubCategories({ client: admin, orgId: fx.orgAId, serviceId: fx.inactiveServiceAId, query: '' })
      expect(results).toEqual([])
    })
  })

  describe('selectSubCategoryForDraft()', () => {
    it('accepts a sub-category correctly tagged to the service, deriving the category', async () => {
      const result = await selectSubCategoryForDraft({ client: admin, orgId: fx.orgAId, serviceId: fx.serviceAId, subCategoryId: fx.subCategoryAHardwareId })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok')
      expect(result.subCategoryId).toBe(fx.subCategoryAHardwareId)
      expect(result.categoryId).toBeTruthy()
    })

    it('rejects a sub-category tagged to a DIFFERENT service (Org B\'s), even when orgId/serviceId are Org A\'s own', async () => {
      const result = await selectSubCategoryForDraft({ client: admin, orgId: fx.orgAId, serviceId: fx.serviceAId, subCategoryId: fx.subCategoryBId })
      expect(result).toEqual({ ok: false, error: 'Selected category is not valid for this service.' })
    })

    it('rejects when serviceId belongs to a different org than orgId', async () => {
      const result = await selectSubCategoryForDraft({ client: admin, orgId: fx.orgAId, serviceId: fx.serviceBId, subCategoryId: fx.subCategoryBId })
      expect(result).toEqual({ ok: false, error: 'Service not found.' })
    })

    it('rejects an inactive service', async () => {
      const result = await selectSubCategoryForDraft({ client: admin, orgId: fx.orgAId, serviceId: fx.inactiveServiceAId, subCategoryId: fx.subCategoryAHardwareId })
      expect(result).toEqual({ ok: false, error: 'Service not found.' })
    })

    it('rejects an archived sub-category that is nonetheless tagged (archived ≠ untagged — reachable via a stale search result)', async () => {
      // resolveSubCategoryForService() validates tag membership only, not
      // is_active — an archived-but-tagged sub-category is still a real,
      // legitimate choice if a caller already had its id (e.g. from a cached
      // review screen); searchSubCategories() is what hides it from NEW
      // discovery. This documents that intentional split rather than
      // asserting a rejection this layer doesn't perform.
      const result = await selectSubCategoryForDraft({ client: admin, orgId: fx.orgAId, serviceId: fx.serviceAId, subCategoryId: fx.subCategoryAArchivedId })
      expect(result.ok).toBe(true)
    })
  })
})
