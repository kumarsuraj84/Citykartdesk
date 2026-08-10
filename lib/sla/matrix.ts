import { createClient } from '@/lib/supabase/server'
import { resolveFormSections } from '@/lib/forms/sections'
import { flattenLeafOptions } from '@/lib/forms/options'
import type { FormField, SLAConfig } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const
type Priority = (typeof PRIORITIES)[number]

export type FieldSlaMatrixRow = {
  service_id: string
  service_name: string
  category_name: string
  sub_category_name: string | null
  field_id: string
  field_label: string
  option_value: string
  option_label: string
  priority: Priority
  response_hours: number | null
  resolution_hours: number | null
}

/**
 * Flattens the whole service catalog into one row per (service, option-bearing field,
 * leaf option value, priority) — the long-format "Service Group / Service Sub Group /
 * Field / Type of Priority / Response SLA / Resolution SLA" matrix shown at Request
 * Configuration → Field SLA Matrix. Every field value always gets all 4 priority rows
 * (even with no data yet) so admins can fill any of them in directly. Joined with any
 * existing field_sla_overrides so the matrix loads pre-filled with saved hours.
 *
 * This is the only SLA layer besides a service's own sla_config — see
 * lib/sla/resolve.ts resolveSlaDeadlines for how the two combine at request time.
 */
export async function getFieldSlaMatrix(): Promise<FieldSlaMatrixRow[]> {
  const supabase = (await createClient()) as unknown as AnyClient

  const [{ data: services }, { data: overridesData }] = await Promise.all([
    supabase
      .from('services')
      .select(
        'id, name, sort_order, form_sections, form_fields, category:service_categories(name), sub_category:service_sub_categories(name)'
      )
      .order('sort_order'),
    supabase.from('field_sla_overrides').select('service_id, field_id, option_value, sla_config'),
  ])

  const overrideMap = new Map<string, SLAConfig>()
  for (const o of overridesData ?? []) {
    overrideMap.set(`${o.service_id}::${o.field_id}::${o.option_value}`, (o.sla_config ?? {}) as SLAConfig)
  }

  const rows: FieldSlaMatrixRow[] = []
  for (const service of services ?? []) {
    const sections = resolveFormSections(service)
    const fields: FormField[] = sections.flatMap((s) => s.fields)
    const optionFields = fields.filter(
      (f) => f.type === 'select' || f.type === 'multiselect' || f.type === 'radio'
    )
    for (const field of optionFields) {
      for (const leaf of flattenLeafOptions(field.options)) {
        const key = `${service.id}::${field.id}::${leaf.value}`
        const slaConfig = overrideMap.get(key) ?? {}
        for (const priority of PRIORITIES) {
          const tier = slaConfig[priority]
          rows.push({
            service_id: service.id,
            service_name: service.name,
            category_name: service.category?.name ?? '—',
            sub_category_name: service.sub_category?.name ?? null,
            field_id: field.id,
            field_label: field.label,
            option_value: leaf.value,
            option_label: leaf.label,
            priority,
            response_hours: tier?.response_hours ?? null,
            resolution_hours: tier?.resolution_hours ?? null,
          })
        }
      }
    }
  }
  return rows
}

/**
 * Distinct field ids on a service that have at least one Field SLA Matrix override
 * configured. Used by the form builder to warn before deleting a field that would
 * orphan that configuration — field_sla_overrides.field_id is a snapshot string, not
 * an FK into services.form_sections, so deleting a field never cascades or errors;
 * the override rows just become silently unreachable through the UI.
 */
export async function getFieldIdsWithSlaOverrides(serviceId: string): Promise<string[]> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data } = await supabase
    .from('field_sla_overrides')
    .select('field_id')
    .eq('service_id', serviceId)
  return Array.from(new Set((data ?? []).map((r: { field_id: string }) => r.field_id)))
}
