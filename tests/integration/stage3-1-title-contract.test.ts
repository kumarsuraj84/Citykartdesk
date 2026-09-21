/**
 * Stage 3.1 — createRequestCore()'s new `titleOverride` param: trust
 * boundary, sanitization, and backward compatibility.
 *
 * Every test here calls createRequestCore() directly (admin client,
 * useAdminForWrites — the shape a webhook handler would use) to prove the
 * REAL sanitization behavior, not a reimplementation of it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { deleteTestOrg } from '../setup/cleanup-org'
import { createTestDepartment, deleteTestDepartment } from '../setup/test-department'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createRequestCore } from '@/lib/requests/create-request-core'

const mockedCreateClient = vi.mocked(createClient)
const EXISTING_ORG_ID = '00000000-0000-0000-0000-000000000001'
const RUN_TAG = `stage3-1-title-${Date.now()}`
const TEAM_PREFIX = `G${Date.now().toString(36).slice(-4).toUpperCase()}`

const SUBJECT_FIELD_ID = 'subject'

type Fx = {
  orgId: string
  serviceId: string
  otherOrgServiceId: string
  requester: TestUser
  cleanup: () => Promise<void>
}

async function setup(): Promise<Fx> {
  const admin = getAdmin()

  const { data: orgB, error: orgBError } = await admin
    .from('organizations')
    .insert({ name: `Stage3.1 Title Org B ${RUN_TAG}`, slug: `stage3-1-title-org-b-${RUN_TAG}` })
    .select('id').single()
  if (orgBError || !orgB) throw new Error(`[stage3.1 title fixtures] org B: ${orgBError?.message}`)

  const departmentId = await createTestDepartment(admin, `Stage3.1 Title Department ${RUN_TAG}`, EXISTING_ORG_ID)

  const { data: team, error: teamError } = await admin
    .from('teams')
    .insert({ name: `Stage3.1 Title Team ${RUN_TAG}`, slug: `stage3-1-title-team-${RUN_TAG}`, prefix: TEAM_PREFIX, department_id: departmentId, org_id: EXISTING_ORG_ID })
    .select('id').single()
  if (teamError || !team) throw new Error(`[stage3.1 title fixtures] team: ${teamError?.message}`)

  const { data: service, error: serviceError } = await admin
    .from('services')
    .insert({
      name: `Stage3.1 Title Service ${RUN_TAG}`,
      slug: `stage3-1-title-service-${RUN_TAG}`,
      team_id: team.id,
      org_id: EXISTING_ORG_ID,
      default_priority: 'low',
      status: 'published',
      form_fields: [],
      form_sections: [{
        id: 'sec1', title: 'Details', order: 0,
        fields: [{ id: SUBJECT_FIELD_ID, type: 'text', label: 'Subject', required: true, order: 0 }],
      }],
    })
    .select('id').single()
  if (serviceError || !service) throw new Error(`[stage3.1 title fixtures] service: ${serviceError?.message}`)

  // A service belonging to a DIFFERENT org — used to prove titleOverride
  // cannot be used to smuggle through an otherwise-invalid, cross-org creation.
  const { data: otherOrgService, error: otherOrgServiceError } = await admin
    .from('services')
    .insert({
      name: `Stage3.1 Title Org B Service ${RUN_TAG}`,
      slug: `stage3-1-title-org-b-service-${RUN_TAG}`,
      team_id: team.id,
      org_id: orgB.id,
      form_fields: [], form_sections: [],
    })
    .select('id').single()
  if (otherOrgServiceError || !otherOrgService) throw new Error(`[stage3.1 title fixtures] other-org service: ${otherOrgServiceError?.message}`)

  const requester = await createTestUser('stage3-1-title-requester', 'Stage3.1 Title Requester')

  return {
    orgId: EXISTING_ORG_ID,
    serviceId: service.id,
    otherOrgServiceId: otherOrgService.id,
    requester,
    cleanup: async () => {
      await admin.from('requests').delete().eq('service_id', service.id)
      await admin.from('services').delete().in('id', [service.id, otherOrgService.id])
      await admin.from('teams').delete().eq('id', team.id)
      await deleteTestDepartment(admin, departmentId)
      const { error } = await admin.auth.admin.deleteUser(requester.id)
      if (error) console.error('[stage3.1 title fixtures] cleanup: failed to delete test user', error.message)
      // See tests/setup/cleanup-org.ts — clears the global_sla_config row a
      // DB trigger auto-creates for every org before deleting it.
      await deleteTestOrg(admin, orgB.id)
    },
  }
}

describe('Stage 3.1 — createRequestCore() titleOverride', () => {
  let fx: Fx
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setup()
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  async function create(overrides: Partial<Parameters<typeof createRequestCore>[0]>) {
    return createRequestCore({
      client: admin,
      orgId: fx.orgId,
      requesterId: fx.requester.id,
      actingUserId: fx.requester.id,
      serviceId: fx.serviceId,
      formData: { [SUBJECT_FIELD_ID]: 'A subject that satisfies the mandatory field' },
      source: 'whatsapp',
      useAdminForWrites: true,
      ...overrides,
    })
  }

  async function titleOf(requestId: string): Promise<string> {
    const { data } = await admin.from('requests').select('title').eq('id', requestId).single()
    return data?.title ?? ''
  }

  it('TEST 7 — no titleOverride supplied: the ticket title is the Subject field of the form (no service prefix)', async () => {
    const result = await create({})
    expect(result.error).toBeUndefined()
    if (!result.requestId) throw new Error('expected requestId')
    expect(await titleOf(result.requestId)).toBe('A subject that satisfies the mandatory field')
  })

  it('a valid titleOverride is stored verbatim, with NO service-name prefix', async () => {
    const result = await create({ titleOverride: 'Billing Counter Printer Not Printing' })
    expect(result.error).toBeUndefined()
    if (!result.requestId) throw new Error('expected requestId')
    expect(await titleOf(result.requestId)).toBe('Billing Counter Printer Not Printing')
  })

  it('a titleOverride with surrounding whitespace is trimmed', async () => {
    const result = await create({ titleOverride: '   Printer Issue   ' })
    if (!result.requestId) throw new Error('expected requestId')
    expect(await titleOf(result.requestId)).toBe('Printer Issue')
  })

  it('an empty-string titleOverride falls back to the existing form-derived title (does not fail creation)', async () => {
    const result = await create({ titleOverride: '' })
    expect(result.error).toBeUndefined()
    if (!result.requestId) throw new Error('expected requestId')
    expect(await titleOf(result.requestId)).toContain('A subject that satisfies the mandatory field')
  })

  it('a whitespace-only titleOverride falls back to the existing form-derived title (does not fail creation, never stores blank)', async () => {
    const result = await create({ titleOverride: '     ' })
    expect(result.error).toBeUndefined()
    if (!result.requestId) throw new Error('expected requestId')
    const title = await titleOf(result.requestId)
    expect(title.trim()).not.toBe('')
    expect(title).toContain('A subject that satisfies the mandatory field')
  })

  it('an over-length titleOverride is bounded, not rejected — creation still succeeds', async () => {
    const longTitle = 'x'.repeat(200)
    const result = await create({ titleOverride: longTitle })
    expect(result.error).toBeUndefined()
    if (!result.requestId) throw new Error('expected requestId')
    const title = await titleOf(result.requestId)
    expect(title.length).toBeLessThanOrEqual(120)
    expect(title).toBe('x'.repeat(120))
  })

  it('security: titleOverride does not bypass sub-category/org validation — an invalid selection is still rejected', async () => {
    const result = await create({ titleOverride: 'A Perfectly Fine Title', subCategoryId: '00000000-0000-0000-0000-0000000000ff' })
    expect(result.requestId).toBeUndefined()
    expect(result.error).toBe('Selected category is not valid for this service.')
  })

  it('security: titleOverride does not bypass cross-org service validation', async () => {
    const result = await create({ titleOverride: 'A Perfectly Fine Title', serviceId: fx.otherOrgServiceId })
    expect(result.requestId).toBeUndefined()
    expect(result.error).toBe('Service not found.')
  })

  it('security: titleOverride has no effect on priority (still DESK-derived from the service default)', async () => {
    const result = await create({ titleOverride: 'urgent: drop everything now' })
    expect(result.error).toBeUndefined()
    if (!result.requestId) throw new Error('expected requestId')
    const { data } = await admin.from('requests').select('priority').eq('id', result.requestId).single()
    expect(data?.priority).toBe('low') // the service's own default_priority, unaffected by title content
  })
})
