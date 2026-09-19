/**
 * Business Rules × Field Library — a single condition on a library field
 * matches a request no matter which template's copy of the field it answered,
 * and doesn't match a request whose form lacks the field. Runs the real,
 * unmodified runRulesForTrigger() against the local database.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { runRulesForTrigger } from '@/lib/rules/run'

describe('Business rule condition on a Field Library field', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  const ids: { lib?: string; tplA?: string; tplB?: string; rule?: string; requests: string[] } = { requests: [] }
  let serviceBId: string
  let originalTemplateA: string | null = null
  let originalTemplateB: string | null = null

  const section = (fieldId: string, libId: string) => [{
    id: 's1', title: 'Details', order: 0,
    fields: [{ id: fieldId, type: 'phone', label: 'Contact Number', required: false, order: 0, library_field_id: libId }],
  }]

  async function seed(serviceId: string, teamId: string, requesterId: string, formData: Record<string, unknown>) {
    const { data, error } = await admin
      .from('requests')
      .insert({ request_no: '', title: `rules-library ${Date.now()}`, requester_id: requesterId, service_id: serviceId, team_id: teamId, status: 'open', priority: 'low', form_data: formData as never })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seed failed: ${error?.message}`)
    ids.requests.push(data.id)
    return data.id
  }

  beforeAll(async () => {
    fx = await setupD03Fixtures()

    const { data: lib, error: libErr } = await admin
      .from('form_field_library')
      .insert({ org_id: fx.orgId, label: `ZZ rules contact ${Date.now()}`, type: 'phone' })
      .select('id').single()
    if (libErr || !lib) throw new Error(libErr?.message)
    ids.lib = lib.id

    const mkTemplate = async (name: string, fieldId: string) => {
      const { data, error } = await admin
        .from('form_templates')
        .insert({ org_id: fx.orgId, name, form_sections: section(fieldId, lib.id) })
        .select('id').single()
      if (error || !data) throw new Error(error?.message)
      return data.id
    }
    ids.tplA = await mkTemplate('ZZ rules tpl A', 'inst_a')
    ids.tplB = await mkTemplate('ZZ rules tpl B', 'inst_b')

    // Team B's service is used as the second service; remember both to restore.
    serviceBId = fx.teamB.serviceId
    const { data: svcs } = await admin.from('services').select('id, template_id').in('id', [fx.teamA.serviceId, serviceBId])
    originalTemplateA = svcs?.find((s) => s.id === fx.teamA.serviceId)?.template_id ?? null
    originalTemplateB = svcs?.find((s) => s.id === serviceBId)?.template_id ?? null
    await admin.from('services').update({ template_id: ids.tplA }).eq('id', fx.teamA.serviceId)
    await admin.from('services').update({ template_id: ids.tplB }).eq('id', serviceBId)

    const { data: rule, error: ruleErr } = await admin
      .from('business_rules')
      .insert({
        org_id: fx.orgId,
        name: 'ZZ rules library contact',
        trigger: ['created'],
        conditions: [{ field: 'form_field', library_field_id: lib.id, operator: 'equals', value: '9811111111' }],
        conditions_logic: 'AND',
        actions: [{ type: 'set_priority', params: { priority: 'urgent' } }],
        execution_order: 0,
      })
      .select('id').single()
    if (ruleErr || !rule) throw new Error(ruleErr?.message)
    ids.rule = rule.id
  }, 90_000)

  afterAll(async () => {
    if (ids.requests.length) await admin.from('requests').delete().in('id', ids.requests)
    if (ids.rule) await admin.from('business_rules').delete().eq('id', ids.rule)
    await admin.from('services').update({ template_id: originalTemplateA }).eq('id', fx.teamA.serviceId)
    await admin.from('services').update({ template_id: originalTemplateB }).eq('id', serviceBId)
    if (ids.tplA) await admin.from('form_templates').delete().eq('id', ids.tplA)
    if (ids.tplB) await admin.from('form_templates').delete().eq('id', ids.tplB)
    if (ids.lib) await admin.from('form_field_library').delete().eq('id', ids.lib)
    await fx.cleanup()
  }, 90_000)

  const priorityOf = async (id: string) =>
    (await admin.from('requests').select('priority').eq('id', id).single()).data?.priority

  it('fires for a request from template A with the matching answer', async () => {
    const id = await seed(fx.teamA.serviceId, fx.teamA.id, fx.requesterA.id, { inst_a: '9811111111' })
    await runRulesForTrigger('created', id)
    expect(await priorityOf(id)).toBe('urgent')
  })

  it('fires for a request from template B (a different copy of the same library field)', async () => {
    const id = await seed(serviceBId, fx.teamB.id, fx.requesterB.id, { inst_b: '9811111111' })
    await runRulesForTrigger('created', id)
    expect(await priorityOf(id)).toBe('urgent')
  })

  it('does not fire when the answer differs', async () => {
    const id = await seed(fx.teamA.serviceId, fx.teamA.id, fx.requesterA.id, { inst_a: '9800000000' })
    await runRulesForTrigger('created', id)
    expect(await priorityOf(id)).toBe('low')
  })

  it('does not fire when the request has no answer for the field', async () => {
    const id = await seed(fx.teamA.serviceId, fx.teamA.id, fx.requesterA.id, {})
    await runRulesForTrigger('created', id)
    expect(await priorityOf(id)).toBe('low')
  })
})
