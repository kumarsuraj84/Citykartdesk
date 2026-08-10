export type RuleConditionField =
  | 'priority'
  | 'status'
  | 'service_id'
  | 'category_id'
  | 'sub_category_id'
  | 'team_id'
  | 'requester_id'
  | 'title'
  | 'description'

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
  operator: RuleConditionOperator
  /** Unused for is_empty/is_not_empty. Array only for `in`. */
  value?: string | string[] | null
}

/**
 * The shape a caller must assemble before evaluating conditions — category_id/
 * sub_category_id live on `services`, not `requests`, so callers join
 * `service:services(category_id, sub_category_id)` and flatten before calling.
 */
export type RuleEvaluationRequest = {
  priority: string
  status: string
  service_id: string
  category_id: string | null
  sub_category_id: string | null
  team_id: string
  requester_id: string
  title: string
  description: string | null
}

function textIncludes(haystack: string | null | undefined, needle: string): boolean {
  return (haystack ?? '').toLowerCase().includes(needle.toLowerCase())
}

function matchesOne(fieldValue: unknown, condition: RuleCondition): boolean {
  const { operator, value } = condition

  if (operator === 'is_empty') return fieldValue == null || fieldValue === ''
  if (operator === 'is_not_empty') return fieldValue != null && fieldValue !== ''

  if (operator === 'in') {
    const values = Array.isArray(value) ? value : []
    return typeof fieldValue === 'string' && values.includes(fieldValue)
  }

  if (operator === 'contains' || operator === 'not_contains') {
    const needle = typeof value === 'string' ? value : ''
    const isMatch = textIncludes(typeof fieldValue === 'string' ? fieldValue : '', needle)
    return operator === 'contains' ? isMatch : !isMatch
  }

  // equals / not_equals
  const target = typeof value === 'string' ? value : ''
  const isMatch = fieldValue === target
  return operator === 'equals' ? isMatch : !isMatch
}

/** All conditions must match (ANDed) — an empty conditions array always matches. */
export function matchesConditions(request: RuleEvaluationRequest, conditions: RuleCondition[]): boolean {
  return conditions.every((condition) => matchesOne(request[condition.field], condition))
}
