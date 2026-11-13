/**
 * "Update employee codes and mobile numbers from a sheet" — the rules (lib/users/contact-update.ts).
 * The sheet is the truth for those two fields only: a value is written, an empty cell clears, a column that is not in the file is left alone.
 */
import { describe, it, expect } from 'vitest'
import { planContactUpdate, type ContactAccount } from '@/lib/users/contact-update'

const acct = (id: string, over: Partial<ContactAccount> = {}): ContactAccount => ({ id, role: 'user', employeeId: null, mobiles: [], ...over })
const accounts = (list: Record<string, ContactAccount>) => new Map(Object.entries(list))
const noGuard = () => null
const both = { hasEmployeeColumn: true, hasMobileColumn: true, guard: noGuard }

describe('planContactUpdate', () => {
  it('fills an empty employee code and an empty mobile number', () => {
    const p = planContactUpdate([{ email: 'a@x.com', employee_id: 'CS1', mobile_number: '9876543210' }], accounts({ 'a@x.com': acct('A') }), new Map(), both)
    expect(p.rows[0].employee).toEqual({ kind: 'change', before: null, after: 'CS1' })
    expect(p.rows[0].mobile).toEqual({ kind: 'change', before: null, after: '9876543210' })
    expect(p.counts).toMatchObject({ employeeSet: 1, mobileSet: 1, peopleFound: 1 })
  })

  it('an empty cell in the sheet clears the value (blank = blank)', () => {
    const p = planContactUpdate([{ email: 'a@x.com', employee_id: '', mobile_number: '' }], accounts({ 'a@x.com': acct('A', { employeeId: 'OLD1', mobiles: ['9876543210'] }) }), new Map([['9876543210', 'A']]), both)
    expect(p.rows[0].employee).toEqual({ kind: 'change', before: 'OLD1', after: null })
    expect(p.rows[0].mobile).toEqual({ kind: 'change', before: '9876543210', after: null })
    expect(p.counts).toMatchObject({ employeeCleared: 1, mobileCleared: 1 })
  })

  it('a different value in the sheet replaces the old one', () => {
    const p = planContactUpdate([{ email: 'a@x.com', employee_id: 'NEW', mobile_number: '9111111111' }], accounts({ 'a@x.com': acct('A', { employeeId: 'OLD', mobiles: ['9222222222'] }) }), new Map([['9222222222', 'A']]), both)
    expect(p.rows[0].employee).toEqual({ kind: 'change', before: 'OLD', after: 'NEW' })
    expect(p.rows[0].mobile).toEqual({ kind: 'change', before: '9222222222', after: '9111111111' })
  })

  it('the same value, in another spelling of the number, is not a change', () => {
    const p = planContactUpdate([{ email: 'a@x.com', employee_id: 'cs1', mobile_number: '+91 98765 43210' }], accounts({ 'a@x.com': acct('A', { employeeId: 'cs1', mobiles: ['9876543210'] }) }), new Map([['9876543210', 'A']]), both)
    expect(p.rows[0].employee).toEqual({ kind: 'unchanged' })
    expect(p.rows[0].mobile).toEqual({ kind: 'unchanged' })
  })

  it('a column that is not in the file is left alone', () => {
    const p = planContactUpdate([{ email: 'a@x.com', employee_id: '' }], accounts({ 'a@x.com': acct('A', { employeeId: 'KEEP', mobiles: ['9876543210'] }) }), new Map(), { ...both, hasMobileColumn: false })
    expect(p.rows[0].mobile).toEqual({ kind: 'not_in_file' })
    expect(p.rows[0].employee.kind).toBe('change') // the employee column IS in the file and is empty
  })

  it('never creates people: an e-mail without an account is only reported', () => {
    const p = planContactUpdate([{ email: 'new@x.com', employee_id: 'N1', mobile_number: '9876543210' }], accounts({}), new Map(), both)
    expect(p.rows[0].profileId).toBeNull()
    expect(p.counts.notFound).toBe(1)
    expect(p.problems[0]).toMatch(/no account/)
  })

  it('e-mail matching ignores case and spaces', () => {
    const p = planContactUpdate([{ email: '  A@X.com ', employee_id: 'CS1' }], accounts({ 'a@x.com': acct('A') }), new Map(), { ...both, hasMobileColumn: false })
    expect(p.rows[0].employee.kind).toBe('change')
  })

  it('an e-mail twice in the file blocks both rows', () => {
    const p = planContactUpdate([{ email: 'a@x.com', employee_id: 'A1' }, { email: 'a@x.com', employee_id: 'A2' }], accounts({ 'a@x.com': acct('A') }), new Map(), { ...both, hasMobileColumn: false })
    expect(p.rows.every((r) => r.rowError)).toBe(true)
  })

  it('a mobile number that is bad is not saved, the employee code of that row still is', () => {
    const p = planContactUpdate([{ email: 'a@x.com', employee_id: 'CS1', mobile_number: '12345' }], accounts({ 'a@x.com': acct('A') }), new Map(), both)
    expect(p.rows[0].employee.kind).toBe('change')
    expect(p.rows[0].mobile.kind).toBe('skipped')
  })

  it('the same number on two rows blocks both (nobody gets the wrong one silently)', () => {
    const p = planContactUpdate(
      [{ email: 'a@x.com', mobile_number: '9876543210' }, { email: 'b@x.com', mobile_number: '98765 43210' }],
      accounts({ 'a@x.com': acct('A'), 'b@x.com': acct('B') }), new Map(), { ...both, hasEmployeeColumn: false })
    expect(p.rows[0].mobile.kind).toBe('skipped')
    expect(p.rows[1].mobile.kind).toBe('skipped')
  })

  it('the same employee code on two rows blocks both', () => {
    const p = planContactUpdate(
      [{ email: 'a@x.com', employee_id: 'A9978' }, { email: 'b@x.com', employee_id: 'a9978' }],
      accounts({ 'a@x.com': acct('A'), 'b@x.com': acct('B') }), new Map(), { ...both, hasMobileColumn: false })
    expect(p.rows[0].employee.kind).toBe('skipped')
    expect(p.rows[1].employee.kind).toBe('skipped')
  })

  it('a number that already belongs to another person is not taken over', () => {
    const p = planContactUpdate([{ email: 'a@x.com', mobile_number: '9876543210' }], accounts({ 'a@x.com': acct('A') }), new Map([['9876543210', 'SOMEONE-ELSE']]), { ...both, hasEmployeeColumn: false })
    expect(p.rows[0].mobile.kind).toBe('skipped')
  })

  it('a shared login with several numbers is left alone', () => {
    const p = planContactUpdate([{ email: 'store@x.com', mobile_number: '9876543210' }], accounts({ 'store@x.com': acct('S', { mobiles: ['9111111111', '9222222222'] }) }), new Map(), { ...both, hasEmployeeColumn: false })
    expect(p.rows[0].mobile.kind).toBe('skipped')
  })

  it('an employee code that is too long is not saved', () => {
    const p = planContactUpdate([{ email: 'a@x.com', employee_id: 'X'.repeat(61) }], accounts({ 'a@x.com': acct('A') }), new Map(), { ...both, hasMobileColumn: false })
    expect(p.rows[0].employee.kind).toBe('skipped')
  })

  it('the "who may change whom" rule is honoured per field', () => {
    const p = planContactUpdate([{ email: 'root@x.com', employee_id: 'R1', mobile_number: '9876543210' }], accounts({ 'root@x.com': acct('R', { role: 'platform_owner' }) }), new Map(),
      { ...both, guard: (a) => (a.role === 'platform_owner' ? 'Only a platform owner can change this account.' : null) })
    expect(p.rows[0].employee.kind).toBe('skipped')
    expect(p.rows[0].mobile.kind).toBe('skipped')
  })

  it('blank on a person that already has nothing is "unchanged", not a change', () => {
    const p = planContactUpdate([{ email: 'a@x.com', employee_id: '', mobile_number: '' }], accounts({ 'a@x.com': acct('A') }), new Map(), both)
    expect(p.rows[0].employee).toEqual({ kind: 'unchanged' })
    expect(p.rows[0].mobile).toEqual({ kind: 'unchanged' })
  })
})
