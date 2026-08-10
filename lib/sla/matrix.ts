import { createClient } from '@/lib/supabase/server'
import { resolveFormSections } from '@/lib/forms/sections'
import { flattenLeafOptions } from '@/lib/forms/options'
import type { FormField, SLAConfig } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type FieldSlaMatrixRow = {
  service_id: string
  service_name: string
  category_name: string
  sub_category_name: string | null
  field_id: string
  field_label: string
  option_value: string
  option_label: string
  sla_config: SLAConfig
}

/**
 * Flattens the whole service catalog into one row per (service, option-bearing field,
 * leaf option value) — the "Service Group / Service Sub Group / Field / Priority hours"
 * matrix shown at Request Configuration → Field SLA Matrix. Joined with any existing
 * field_sla_overrides so the matrix loads pre-filled with saved hours.
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
        rows.push({
          service_id: service.id,
          service_name: service.name,
          category_name: service.category?.name ?? '—',
          sub_category_name: service.sub_category?.name ?? null,
          field_id: field.id,
          field_label: field.label,
          option_value: leaf.value,
          option_label: leaf.label,
          sla_config: overrideMap.get(key) ?? {},
        })
      }
    }
  }
  return rows
}
