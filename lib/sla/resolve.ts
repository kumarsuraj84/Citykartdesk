import type { FormField, SLAConfig, SLATier } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

type FieldSlaOverrideRow = {
  field_id: string
  option_value: string
  sla_config: SLAConfig
}

/**
 * Resolve the tightest field-level SLA override that applies to a submitted request.
 * field_sla_overrides (migration 20240101000092) is the most specific SLA layer — more
 * specific than services.sla_config, which is more specific than global_sla_config. See
 * lib/actions/requests.ts createRequest for how the three layers stack.
 *
 * A request can select more than one option value that carries an override (e.g. two
 * separate dropdown fields on the same form). When that happens, the tightest (minimum)
 * hours across all matches wins for each of response/resolution independently — the most
 * demanding condition present on the request should drive the deadline.
 */
export async function resolveFieldSlaTier(
  supabase: AnyClient,
  serviceId: string,
  priority: 'low' | 'medium' | 'high' | 'urgent',
  allFields: FormField[],
  formData: Record<string, unknown>
): Promise<SLATier | null> {
  const optionFields = allFields.filter(
    (f) => f.type === 'select' || f.type === 'multiselect' || f.type === 'radio'
  )
  if (optionFields.length === 0) return null

  const selectedByField = new Map<string, Set<string>>()
  for (const field of optionFields) {
    const raw = formData[field.id]
    const values = Array.isArray(raw) ? raw.map(String) : raw != null && raw !== '' ? [String(raw)] : []
    if (values.length) selectedByField.set(field.id, new Set(values))
  }
  if (selectedByField.size === 0) return null

  const { data } = await supabase
    .from('field_sla_overrides')
    .select('field_id, option_value, sla_config')
    .eq('service_id', serviceId)
  const overrides = (data ?? []) as FieldSlaOverrideRow[]
  if (overrides.length === 0) return null

  const matches = overrides.filter((o) => selectedByField.get(o.field_id)?.has(o.option_value))
  const tiers = matches.map((m) => m.sla_config?.[priority]).filter((t): t is SLATier => !!t)
  if (tiers.length === 0) return null

  const responseCandidates = tiers.map((t) => t.response_hours).filter((h): h is number => h != null)
  const resolutionCandidates = tiers.map((t) => t.resolution_hours).filter((h): h is number => h != null)
  if (responseCandidates.length === 0 && resolutionCandidates.length === 0) return null

  return {
    response_hours: responseCandidates.length ? Math.min(...responseCandidates) : null,
    resolution_hours: resolutionCandidates.length ? Math.min(...resolutionCandidates) : null,
  }
}
