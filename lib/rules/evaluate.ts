export type RuleConditionField =
  | 'priority'
  | 'status'
  | 'service_id'
  | 'category_id'
  | 'sub_category_id'
  | 'template_id'
  | 'team_id'
  | 'project_id'
  | 'assigned_to'
  | 'requester_id'
  | 'requester_role'
  | 'requester_department_id'
  | 'requester_location_id'
  | 'requester_designation_id'
  | 'requester_function_id'
  | 'title'
  | 'description'
  | 'source_channel'
  | 'is_sla_breached'
  | 'has_attachment'
  | 'age_days'
  | 'form_field'

export type RuleConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'

export type RuleCondition = {
  field: RuleConditionField
  /** Only when field === 'form_field': which service form field (by id) this condition reads from request.form_data. */
  form_field_id?: string
  operator: RuleConditionOperator
  /** Unused for is_empty/is_not_empty. Array only for `in`/`not_in`. */
  value?: string | string[] | null
  /** How this condition combines with the ONE BEFORE it (ignored on the first
   *  condition, which has nothing to combine with). Undefined on a condition
   *  saved before per-row logic existed — matchesConditions() falls back to
   *  the rule's legacy `conditions_logic` for those. See matchesConditions(). */
  logic?: RuleConditionsLogic
}

export type RuleConditionsLogic = 'AND' | 'OR'

/**
 * The shape a caller must assemble before evaluating conditions — category_id/
 * sub_category_id/template_id and the requester's role/department/location/
 * designation/function live on `services`/`profiles`, not `requests`, so
 * callers join `service:services(category_id, sub_category_id, template_id)`
 * and `requester:profiles!requester_id(role, department_id, location_id,
 * designation_id, function_id)` and flatten before calling. form_data is the
 * request's submitted intake-form values, keyed by form field id — used by
 * `form_field` conditions. `is_sla_breached`/`has_attachment`/`age_days` are
 * computed by the caller, not raw columns — see lib/rules/run.ts.
 */
export type RuleEvaluationRequest = {
  priority: string
  status: string
  service_id: string
  category_id: string | null
  sub_category_id: string | null
  template_id: string | null
  team_id: string
  project_id: string | null
  assigned_to: string | null
  requester_id: string
  requester_role: string
  requester_department_id: string | null
  requester_location_id: string | null
  requester_designation_id: string | null
  requester_function_id: string | null
  title: string
  description: string | null
  source_channel: string
  is_sla_breached: boolean
  has_attachment: boolean
  age_days: number
  form_data?: Record<string, unknown> | null
}

function textIncludes(haystack: string | null | undefined, needle: string): boolean {
  return (haystack ?? '').toLowerCase().includes(needle.toLowerCase())
}

/** Raw field value for a condition — form_field conditions read from form_data instead of a fixed column. */
function rawFieldValue(request: RuleEvaluationRequest, condition: RuleCondition): unknown {
  if (condition.field === 'form_field') {
    if (!condition.form_field_id) return null
    return request.form_data?.[condition.form_field_id] ?? null
  }
  return request[condition.field]
}

/** Coerces a raw form/request value (string, number, boolean, string[]) into the string the text-based operators compare against. */
function toComparable(raw: unknown): string {
  if (raw == null) return ''
  if (Array.isArray(raw)) return raw.join(', ')
  return typeof raw === 'string' ? raw : String(raw)
}

function matchesOne(request: RuleEvaluationRequest, condition: RuleCondition): boolean {
  const { operator, value } = condition
  const raw = rawFieldValue(request, condition)

  if (operator === 'is_empty') return raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)
  if (operator === 'is_not_empty') return !(raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0))

  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
    if (raw == null || raw === '') return false
    const n = Number(raw)
    const target = Number(Array.isArray(value) ? value[0] : value)
    if (Number.isNaN(n) || Number.isNaN(target)) return false
    if (operator === 'gt') return n > target
    if (operator === 'gte') return n >= target
    if (operator === 'lt') return n < target
    return n <= target
  }

  const fieldValue = toComparable(raw)

  if (operator === 'in' || operator === 'not_in') {
    const values = Array.isArray(value) ? value : []
    const isMatch = Array.isArray(raw)
      ? raw.some((v) => values.includes(toComparable(v)))
      : values.includes(fieldValue)
    return operator === 'in' ? isMatch : !isMatch
  }

  if (operator === 'contains' || operator === 'not_contains') {
    const needle = typeof value === 'string' ? value : ''
    // Array raw values (e.g. a multiselect form field) match per-element — the
    // joined "A, B" string would otherwise defeat substring matching intended
    // against a single selected option.
    const isMatch = Array.isArray(raw)
      ? raw.some((v) => textIncludes(toComparable(v), needle))
      : textIncludes(fieldValue, needle)
    return operator === 'contains' ? isMatch : !isMatch
  }

  // equals / not_equals — for an array raw value, "equals X" means X is among
  // the selections (membership), not that the joined string equals X exactly.
  const target = typeof value === 'string' ? value : ''
  const isMatch = Array.isArray(raw)
    ? raw.some((v) => toComparable(v) === target)
    : fieldValue === target
  return operator === 'equals' ? isMatch : !isMatch
}

/**
 * Evaluates a rule's conditions against a request. Each condition (after the
 * first) carries its own `logic` — AND or OR — describing how it combines with
 * the condition immediately before it, evaluated left-to-right with the usual
 * AND-binds-tighter-than-OR precedence: consecutive AND-connected conditions
 * form a group, and an OR starts a new group, so
 *   [X, Y(AND), A(OR), B(AND)]
 * reads as "(X AND Y) OR (A AND B)" — sum-of-products, not a single global
 * switch. `fallbackLogic` (the rule's legacy `conditions_logic` column) is
 * used only for a condition with no `logic` of its own — i.e. a rule saved
 * before per-condition logic existed, so it keeps evaluating exactly as
 * before rather than silently changing behaviour.
 *
 * An empty conditions array always matches — "no conditions" means "matches
 * every request", not "matches nothing" (which an empty OR would otherwise mean).
 */
export function matchesConditions(
  request: RuleEvaluationRequest,
  conditions: RuleCondition[],
  fallbackLogic: RuleConditionsLogic = 'AND'
): boolean {
  if (conditions.length === 0) return true

  const groups: RuleCondition[][] = [[conditions[0]]]
  for (let i = 1; i < conditions.length; i++) {
    const connector = conditions[i].logic ?? fallbackLogic
    if (connector === 'OR') {
      groups.push([conditions[i]])
    } else {
      groups[groups.length - 1].push(conditions[i])
    }
  }

  return groups.some((group) => group.every((condition) => matchesOne(request, condition)))
}
