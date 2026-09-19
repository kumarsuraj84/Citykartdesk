import { describe, expect, it } from 'vitest'
import { matchesConditions, type RuleCondition, type RuleEvaluationRequest } from '@/lib/rules/evaluate'

const request: RuleEvaluationRequest = {
  priority: 'medium',
  status: 'open',
  service_id: 'svc-1',
  category_id: 'cat-1',
  sub_category_id: 'sub-C',
  template_id: 'tpl-1',
  team_id: 'team-1',
  project_id: null,
  assigned_to: null,
  requester_id: 'u-1',
  requester_role: 'user',
  requester_department_id: null,
  requester_location_id: null,
  requester_designation_id: null,
  requester_function_id: null,
  title: 't',
  description: null,
  source_channel: 'portal',
  is_sla_breached: false,
  has_attachment: false,
  age_days: 0,
}

const cond = (c: Partial<RuleCondition>): RuleCondition =>
  ({ field: 'sub_category_id', operator: 'in', value: [], ...c }) as RuleCondition

describe('multi-value rule conditions', () => {
  it('in matches when the field is any of the listed values', () => {
    expect(matchesConditions(request, [cond({ value: ['sub-A', 'sub-C', 'sub-E'] })])).toBe(true)
  })

  it('in does not match when the field is none of the listed values', () => {
    expect(matchesConditions(request, [cond({ value: ['sub-A', 'sub-B'] })])).toBe(false)
  })

  it('not_in matches when the field is none of the listed values', () => {
    expect(matchesConditions(request, [cond({ operator: 'not_in', value: ['sub-A', 'sub-B'] })])).toBe(true)
  })

  it('not_in does not match when the field is one of the listed values', () => {
    expect(matchesConditions(request, [cond({ operator: 'not_in', value: ['sub-C', 'sub-D'] })])).toBe(false)
  })

  it('template AND category AND any-of sub categories reads as one rule', () => {
    const conditions: RuleCondition[] = [
      { field: 'template_id', operator: 'equals', value: 'tpl-1' },
      { field: 'category_id', operator: 'equals', value: 'cat-1', logic: 'AND' },
      { field: 'sub_category_id', operator: 'in', value: ['sub-A', 'sub-B', 'sub-C'], logic: 'AND' },
    ]
    expect(matchesConditions(request, conditions)).toBe(true)
    expect(matchesConditions({ ...request, sub_category_id: 'sub-Z' }, conditions)).toBe(false)
  })

  it('applies not_in per element for array-valued form fields', () => {
    const formCond: RuleCondition = { field: 'form_field', form_field_id: 'f1', operator: 'not_in', value: ['x', 'y'] }
    expect(matchesConditions({ ...request, form_data: { f1: ['a', 'y'] } }, [formCond])).toBe(false)
    expect(matchesConditions({ ...request, form_data: { f1: ['a', 'b'] } }, [formCond])).toBe(true)
  })
})
