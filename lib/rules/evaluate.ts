export type RuleConditionField =
  | 'priority'
  | 'status'
  | 'service_id'
  | 'category_id'
  | 'sub_category_id'
  | 'team_id'
  | 'requester_id'
  | 'requester_department_id'
  | 'requester_location_id'
  | 'requester_designation_id'
  | 'requester_function_id'
  | 'title'
  | 'description'
  | 'form_field'

export type RuleConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'in'

export type RuleCondition = {
  field: RuleConditionField
  /** Only when field === 'form_field': which service form field (by id) this condition reads from request.form_data. */
  form_field_id?: string
  operator: RuleConditionOperator
  /** Unused for is_empty/is_not_empty. Array only for `in`. */
  value?: string | string[] | null
}

export type RuleConditionsLogic = 'AND' | 'OR'

/**
 * The shape a caller must assemble before evaluating conditions — category_id/
 * sub_category_id and the requester's department/location/designation/function
 * live on `services`/`profiles`, not `requests`, so callers join
 * `service:services(category_id, sub_category_id)` and
 * `requester:profiles!requester_id(department_id, location_id, designation_id, function_id)`
 * and flatten before calling. form_data is the request's submitted intake-form
 * values, keyed by form field id — used by `form_field` conditions.
 */
export type RuleEvaluationRequest = {
  priority: string
  status: string
  service_id: string
  category_id: string | null
  sub_category_id: string | null
  team_id: string
  requester_id: string
  requester_department_id: string | null
  requester_location_id: string | null
  requester_designation_id: string | null
  requester_function_id: string | null
  title: string
  description: string | null
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

  const fieldValue = toComparable(raw)

  if (operator === 'in') {
    const values = Array.isArray(value) ? value : []
    if (Array.isArray(raw)) return raw.some((v) => values.includes(toComparable(v)))
    return values.includes(fieldValue)
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
 * Evaluates a rule's conditions against a request. `logic` picks whether every
 * condition must match (AND, the original and default behaviour) or any one
 * match is enough (OR). An empty conditions array always matches, regardless
 * of logic — "no conditions" means "matches every request", not "matches
 * nothing" (which an empty OR would otherwise mean).
 */
export function matchesConditions(
  request: RuleEvaluationRequest,
  conditions: RuleCondition[],
  logic: RuleConditionsLogic = 'AND'
): boolean {
  if (conditions.length === 0) return true
  return logic === 'OR'
    ? conditions.some((condition) => matchesOne(request, condition))
    : conditions.every((condition) => matchesOne(request, condition))
}
