import type { FormField, SLAConfig, SLATier } from '@/types'
import { computeSLADeadline } from '@/lib/sla/business-hours'

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
 * specific than the service's mapped SLA Policy (services.sla_policy_id →
 * sla_policies.config), which is the only other layer. There is no org-wide default layer
 * beneath it (the
 * old global_sla_config-backed "SLA Targets" screen was removed — a service/field with no
 * explicit override simply gets no SLA deadline). See resolveSlaDeadlines below for how
 * every request-facing action (create, priority change, reopen) computes deadlines.
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

/**
 * Single source of truth for computing a request's response/resolution deadlines —
 * used by createRequest, the REOPEN path in updateRequestStatus,
 * reclassifyRequest, and updateRequestCategory so every place a request gets (or
 * regets) an SLA deadline resolves the same two layers (field override > the
 * service's mapped SLA Policy) and applies the same business-hours-aware calendar
 * (nights/weekends/holidays excluded), instead of each call site re-deriving its
 * own flat wall-clock estimate.
 *
 * A Sub-Category no longer carries its own hours — it only carries a priority
 * label (service_sub_categories.sla_priority), which feeds `priority` itself at
 * the call site (see createRequest/updateRequestCategory) rather than being a
 * separate config layer here.
 *
 * `allFields`/`formData` are optional — omit them for contexts with no dynamic-form
 * submission to check against (e.g. a priority/service change after the request was
 * already created), which simply skips the field-level layer and falls straight to
 * the policy config.
 */
export async function resolveSlaDeadlines(
  supabase: AnyClient,
  params: {
    serviceId: string
    priority: 'low' | 'medium' | 'high' | 'urgent'
    // The config of the service's mapped SLA Policy (services.sla_policy_id →
    // sla_policies.config). Null/undefined when the service has no policy mapped.
    servicePolicyConfig: SLAConfig | null | undefined
    allFields?: FormField[]
    formData?: Record<string, unknown>
    from: Date
    // F-13: pauses already completed (the request's paused_ms_total, in pauseCreditMs() units). They are added to the SLA length BEFORE it is counted in business
    // minutes, so a recompute from the start never forgets a pause. A pause still in progress is NOT passed: it is credited once, when the pause ends.
    pauseCreditMs?: number
  }
): Promise<{ responseDueAt: string | null; resolutionDueAt: string | null }> {
  const { serviceId, priority, servicePolicyConfig, allFields = [], formData = {}, from, pauseCreditMs = 0 } = params
  const creditMinutes = pauseCreditMs > 0 ? pauseCreditMs / 60_000 : 0

  const fieldTier = await resolveFieldSlaTier(supabase, serviceId, priority, allFields, formData)
  const policyTier = servicePolicyConfig?.[priority]
  const responseHours = fieldTier?.response_hours ?? policyTier?.response_hours ?? null
  const resolutionHours = fieldTier?.resolution_hours ?? policyTier?.resolution_hours ?? null

  // Clamp to >= 0: a negative or non-finite hours value (misconfigured SLA
  // Policy/override, or a bad manual DB edit) would otherwise produce a due
  // date before `from` — a ticket that's already "breached" the instant
  // it's created/reprioritised, before anyone had a chance to act on it.
  const safeHours = (h: number | null): number | null =>
    h != null && Number.isFinite(Number(h)) ? Math.max(0, Number(h)) : null

  // computeSLADeadline returns null when the business-hours calendar has no
  // usable window at all (misconfiguration, already logged/alerted at its
  // own source) — that folds into the same "no SLA deadline" null this
  // function already returns when there's no applicable SLA tier, rather
  // than needing a separate error path here.
  const responseDeadline =
    safeHours(responseHours) != null
      ? await computeSLADeadline(from, Math.round(safeHours(responseHours)! * 60 + creditMinutes))
      : null
  const resolutionDeadline =
    safeHours(resolutionHours) != null
      ? await computeSLADeadline(from, Math.round(safeHours(resolutionHours)! * 60 + creditMinutes))
      : null
  const responseDueAt = responseDeadline?.toISOString() ?? null
  const resolutionDueAt = resolutionDeadline?.toISOString() ?? null

  return { responseDueAt, resolutionDueAt }
}

/**
 * When a ticket's SLA clock started: its creation, or the last time it was reopened (a reopen starts a brand-new clock, and its pause credit is cleared with it).
 * Recomputing deadlines from created_at for a reopened ticket put them months in the past, so it was "breached" the moment it was re-classified.
 */
export async function slaClockStart(
  client: AnyClient,
  request: { id: string; created_at: string; reopen_count?: number | null }
): Promise<Date> {
  const created = new Date(request.created_at)
  if (!(Number(request.reopen_count ?? 0) > 0)) return created
  const { data } = await client
    .from('request_activity')
    .select('created_at')
    .eq('request_id', request.id)
    .eq('action', 'reopened')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const reopened = data?.created_at ? new Date(data.created_at as string) : null
  return reopened && reopened > created ? reopened : created
}
