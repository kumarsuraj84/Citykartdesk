import { describe, it, expect, vi } from 'vitest'
import { evaluateAutomation, isMailExpected, loadAutomationFacts, type TicketFacts } from '@/lib/automation/diagnose'

vi.mock('server-only', () => ({}))

// C-03 / C-19: the automatic retry only works on steps the ticket was EXPECTED to have when it was made, and a table that cannot be read is an error, never "nothing found".

const NOW = new Date('2026-10-29T12:00:00Z')
const facts = (o: Omit<Partial<TicketFacts>, 'state'> & { state?: Partial<TicketFacts['state']> } = {}): TicketFacts => {
  const { state, ...rest } = o
  return {
    id: 'r1', request_no: 'CKSD-1', org_id: 'o', title: 'T', description: '', status: 'open', created_at: '2026-10-29T11:00:00Z', assigned_to: null, requester_id: 'u', category_id: 'c', categoryName: 'AC',
    programId: 'p', programName: 'RO', programActive: true, programRowType: 'store', oemKind: null, oemQuiet: false, isPms: false, cvmApproval: false,
    state: { exists: true, expected: { rules: true, vendor_mail: true, cvm: false }, mail_started_at: null, started_at: '2026-10-29T11:00:00Z', rules_ran_at: '2026-10-29T11:00:05Z', finished_at: '2026-10-29T11:00:09Z', auto_attempts: 0, auto_last_at: null, gave_up_at: null, last_rerun_at: null, ...state },
    mailSent: false, hasApproval: false, anyCreatedRule: false, storeCode: 'ALC', chosenAcValue: '', chosenMachineValue: '', mailProblem: null, cvmProblem: null,
    ...rest,
  }
}
const step = (f: TicketFacts, key: string) => evaluateAutomation(f, NOW).steps.find((s) => s.key === key)!

describe('what the automatic retry may run (C-03)', () => {
  it('a mail that was expected at creation and did not go out is retried by itself', () => {
    const s = step(facts(), 'vendor_mail')
    expect(s).toMatchObject({ state: 'missing', autoSafe: true, wasExpected: true })
    expect(evaluateAutomation(facts(), NOW).autoPending).toBe(true)
  })
  it('a category moved into a program (or a program switched on) AFTER the ticket was made is missing for a person to run, never retried by itself', () => {
    const f = facts({ state: { expected: { rules: true, vendor_mail: false, cvm: false } } })
    const s = step(f, 'vendor_mail')
    expect(s).toMatchObject({ state: 'missing', autoSafe: false, wasExpected: false })
    expect(s.detail).toMatch(/only a person can run it/)
    expect(evaluateAutomation(f, NOW).autoPending).toBe(false)   // nothing left for the retry: the ticket can be settled
    expect(evaluateAutomation(f, NOW).kind).toBe('broken')      // but the administrator still sees it and the button still works
  })
  it('a ticket with no record of its expected steps is never retried by itself', () => {
    const f = facts({ state: { expected: null } })
    expect(step(f, 'vendor_mail').autoSafe).toBe(false)
    expect(evaluateAutomation(f, NOW).autoPending).toBe(false)
    const untracked = facts({ state: { exists: false, expected: null } })
    expect(step(untracked, 'vendor_mail').autoSafe).toBe(false)
  })
  it('a mail that waits for the sheet to be fixed keeps the ticket under the retry, so it is run as soon as the sheet is right', () => {
    const f = facts({ mailProblem: 'The RO sheet has no e-mail address for store ALC.' })
    expect(step(f, 'vendor_mail').state).toBe('blocked')
    expect(evaluateAutomation(f, NOW).autoPending).toBe(true)
  })
  it('the CVM approval follows the same rule', () => {
    const exp = facts({ programId: null, cvmApproval: true, state: { expected: { rules: true, vendor_mail: false, cvm: true } } })
    expect(step(exp, 'cvm')).toMatchObject({ state: 'missing', autoSafe: true })
    const late = facts({ programId: null, cvmApproval: true, state: { expected: { rules: true, vendor_mail: false, cvm: false } } })
    expect(step(late, 'cvm')).toMatchObject({ state: 'missing', autoSafe: false })
  })
  it('Business Rules interrupted by a restart are retried only when they were expected', () => {
    const f = facts({ anyCreatedRule: true, state: { rules_ran_at: null, finished_at: null } })
    expect(step(f, 'rules')).toMatchObject({ state: 'missing', autoSafe: true })
    expect(step(facts({ anyCreatedRule: true, state: { rules_ran_at: null, expected: null } }), 'rules').autoSafe).toBe(false)
  })
  it('a mail that was started and never finished is "may or may not have gone out": a person decides, never the retry', () => {
    const f = facts({ state: { mail_started_at: '2026-10-29T11:30:00Z' } })
    const s = step(f, 'vendor_mail')
    expect(s.state).toBe('missing')
    expect(s.autoSafe).toBe(false)
    expect(s.detail).toMatch(/may or may not have gone out/)
    expect(step(facts({ mailSent: true, state: { mail_started_at: '2026-10-29T11:30:00Z' } }), 'vendor_mail').state).toBe('done')   // once the mail is recorded the marker does not matter
  })
  it('a manual approval counts as the approval (a person decision is not answered by a second, automatic one)', () => {
    expect(step(facts({ programId: null, cvmApproval: true, hasApproval: true, state: { expected: { rules: true, vendor_mail: false, cvm: true } } }), 'cvm').state).toBe('done')
  })
  it('the same rule decides what is expected when a ticket is made', () => {
    expect(isMailExpected({ programId: 'p', programActive: true, oemKind: null, isPms: false })).toBe(true)
    expect(isMailExpected({ programId: 'p', programActive: false, oemKind: null, isPms: false })).toBe(false)
    expect(isMailExpected({ programId: null, programActive: false, oemKind: 'ac', isPms: false })).toBe(true)
    expect(isMailExpected({ programId: null, programActive: false, oemKind: 'ac', isPms: true })).toBe(false)
    expect(isMailExpected({ programId: null, programActive: false, oemKind: null, isPms: false })).toBe(false)
  })
})

describe('a table that cannot be read is an error (C-19)', () => {
  // a database whose every table answers with an empty list, except the failing one and the tickets
  const db = (failing: string) => ({
    from: (table: string) => {
      const answer = table === failing
        ? { data: null, error: { message: 'relation is down' } }
        : { data: table === 'requests' ? [{ id: 'r1', org_id: 'o', category_id: null, service_id: null, requester_id: 'u', status: 'open' }] : [], error: null }
      const chain: unknown = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => unknown) => res(answer) : () => chain) })
      return chain
    },
  })
  it.each(['request_comments', 'approvals', 'request_program_snapshots', 'request_master_snapshots', 'request_automation_state', 'business_rules', 'profiles'])('%s failing stops the check instead of showing steps as missing', async (table) => {
    await expect(loadAutomationFacts(db(table), ['r1'], { check: false })).rejects.toThrow(/Could not check/)
  })
  it('with every table readable the check goes through', async () => {
    const out = await loadAutomationFacts(db('none'), ['r1'], { check: false })
    expect(out).toHaveLength(1)
  })
})
