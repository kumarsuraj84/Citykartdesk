// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/lib/actions/admin/business-rules', () => ({
  createBusinessRule: vi.fn(), updateBusinessRule: vi.fn(), deleteBusinessRule: vi.fn(), toggleBusinessRuleActive: vi.fn(), migrateLegacyRulesToBusinessRules: vi.fn(),
}))

import { BusinessRulesClient } from '@/app/(app)/admin/business-rules/BusinessRulesClient'
import { matchesRuleSearch } from '@/lib/rules/search'

afterEach(() => cleanup())

const rule = (id: string, name: string, description: string | null = null) => ({
  id, name, description, is_active: true, trigger: ['created' as const], schedule_check: null, schedule_threshold: null,
  conditions: [], conditions_logic: 'AND' as const, actions: [], execution_order: 1,
})
const rules = [rule('1', 'Route hardware requests'), rule('2', 'Escalate AC tickets', 'goes to the Admin group'), rule('3', 'Auto-assign IT tickets')]
const props = {
  rules, services: [], categories: [], subCategories: [], teams: [], profiles: [], agents: [], departments: [], locations: [], designations: [], functions: [],
  projects: [], templates: [], formFields: [], libraryFields: [], legacyRulesAvailable: false,
}

describe('searching business rules', () => {
  it('finds a rule from part of its name or description, any capitals, every word typed must match', () => {
    expect(matchesRuleSearch(rules[1], 'ac')).toBe(true)
    expect(matchesRuleSearch(rules[1], 'ESCALATE ticket')).toBe(true)
    expect(matchesRuleSearch(rules[1], 'admin group')).toBe(true)      // description
    expect(matchesRuleSearch(rules[1], 'hardware')).toBe(false)
    expect(matchesRuleSearch(rules[0], '   ')).toBe(true)              // nothing typed: every rule
  })
  it('the list narrows as you type, says how many matched, and can be cleared', () => {
    render(<BusinessRulesClient {...props} />)
    expect(screen.getByText('3 rules')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search rules'), { target: { value: 'tickets' } })
    expect(screen.getByText('2 of 3 rules')).toBeTruthy()
    expect(screen.queryByText('Route hardware requests')).toBeNull()
    expect(screen.getByText('Escalate AC tickets')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search rules'), { target: { value: 'zzz' } })
    expect(screen.getByText(/No rule matches/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Clear search'))
    expect(screen.getByText('3 rules')).toBeTruthy()
    expect(screen.getByText('Route hardware requests')).toBeTruthy()
  })
})
