// Stage 4 — shared test-only fixture builder for conversation integration
// tests. Creates a team + service (+ optional SLA policy) + sub-category
// tagged to it, all within a caller-supplied org (the real seed org unless
// the test specifically needs a second org for tenant-isolation checks).
import { getAdmin } from './fixtures-d03'
import type { FormField } from '@/types'

const EXISTING_ORG_ID = '00000000-0000-0000-0000-000000000001'
const EXISTING_DEPARTMENT_ID = '10000000-0000-0000-0000-000000000001'

export type ConversationFixture = {
  orgId: string
  teamId: string
  serviceId: string
  subCategoryId: string
  categoryId: string
  cleanup: () => Promise<void>
}

export async function setupConversationFixture(params: {
  runTag: string
  orgId?: string
  fields: FormField[]
  subCategoryPriority?: 'low' | 'medium' | 'high' | 'urgent'
}): Promise<ConversationFixture> {
  const admin = getAdmin()
  const orgId = params.orgId ?? EXISTING_ORG_ID
  const teamPrefix = `Q${Date.now().toString(36).slice(-4).toUpperCase()}`

  const { data: team, error: teamError } = await admin
    .from('teams')
    .insert({ name: `Conv Fixture Team ${params.runTag}`, slug: `conv-fixture-team-${params.runTag}`, prefix: teamPrefix, department_id: EXISTING_DEPARTMENT_ID, org_id: orgId })
    .select('id').single()
  if (teamError || !team) throw new Error(`[conversation fixtures] team: ${teamError?.message}`)

  const { data: slaPolicy, error: slaError } = await admin
    .from('sla_policies')
    .insert({
      org_id: orgId,
      name: `Conv Fixture SLA Policy ${params.runTag}`,
      config: {
        low: { response_hours: 24, resolution_hours: 48 },
        medium: { response_hours: 8, resolution_hours: 16 },
        high: { response_hours: 4, resolution_hours: 8 },
        urgent: { response_hours: 1, resolution_hours: 2 },
      },
    })
    .select('id').single()
  if (slaError || !slaPolicy) throw new Error(`[conversation fixtures] sla policy: ${slaError?.message}`)

  const { data: service, error: serviceError } = await admin
    .from('services')
    .insert({
      name: `Conv Fixture Service ${params.runTag}`,
      slug: `conv-fixture-service-${params.runTag}`,
      team_id: team.id,
      org_id: orgId,
      default_priority: 'low',
      sla_policy_id: slaPolicy.id,
      status: 'published',
      form_fields: [],
      form_sections: [{ id: 'sec1', title: 'Details', order: 0, fields: params.fields }],
    })
    .select('id').single()
  if (serviceError || !service) throw new Error(`[conversation fixtures] service: ${serviceError?.message}`)

  const { data: category, error: categoryError } = await admin
    .from('service_categories')
    .insert({ name: `Conv Fixture Category ${params.runTag}`, slug: `conv-fixture-category-${params.runTag}`, org_id: orgId })
    .select('id').single()
  if (categoryError || !category) throw new Error(`[conversation fixtures] category: ${categoryError?.message}`)

  const { data: subCategory, error: subCategoryError } = await admin
    .from('service_sub_categories')
    .insert({ name: `Printer Issue ${params.runTag}`, slug: `conv-fixture-subcat-${params.runTag}`, category_id: category.id, is_active: true, sla_priority: params.subCategoryPriority ?? 'urgent' })
    .select('id').single()
  if (subCategoryError || !subCategory) throw new Error(`[conversation fixtures] sub-category: ${subCategoryError?.message}`)

  const { error: tagError } = await admin.from('service_sub_category_tags').insert({ service_id: service.id, sub_category_id: subCategory.id })
  if (tagError) throw new Error(`[conversation fixtures] tag: ${tagError.message}`)

  return {
    orgId,
    teamId: team.id,
    serviceId: service.id,
    subCategoryId: subCategory.id,
    categoryId: category.id,
    cleanup: async () => {
      await admin.from('conversation_attachments').delete().in(
        'conversation_id',
        (await admin.from('request_conversations').select('id').eq('service_id', service.id)).data?.map((r: { id: string }) => r.id) ?? []
      )
      await admin.from('conversation_events').delete().eq('org_id', orgId).ilike('external_message_id', `%${params.runTag}%`)
      await admin.from('request_conversations').delete().eq('service_id', service.id)
      await admin.from('requests').delete().eq('service_id', service.id)
      await admin.from('service_sub_category_tags').delete().eq('service_id', service.id)
      await admin.from('service_sub_categories').delete().eq('id', subCategory.id)
      await admin.from('service_categories').delete().eq('id', category.id)
      await admin.from('services').delete().eq('id', service.id)
      await admin.from('sla_policies').delete().eq('id', slaPolicy.id)
      await admin.from('teams').delete().eq('id', team.id)
    },
  }
}
