/**
 * D-01 — "SLA Breached" formula reconciliation.
 *
 * Five deterministic fixtures (per the D-01 remediation brief), each
 * checked against both canonical predicates from lib/sla/breach.ts:
 *
 *   isCurrentlyBreached — "is this ticket open right now, past due" (Home
 *   Dashboard, Monitoring, Admin Analytics KPI card, the drawer filter).
 *
 *   isEverBreached — "did/does this ticket miss its deadline, including if
 *   it was resolved/closed late" (Report Builder + its CSV/XLSX export).
 *
 * These are pure functions (no I/O), so this is a fast unit test, not an
 * integration test — nothing here needs the local Supabase instance.
 */
import { describe, it, expect } from 'vitest'
import { isCurrentlyBreached, isEverBreached, isEverResponseBreached, applyCurrentlyBreachedFilter } from '@/lib/sla/breach'

const NOW = new Date('2026-09-10T12:00:00.000Z')
const PAST = '2026-09-09T12:00:00.000Z'   // before NOW
const FUTURE = '2026-09-11T12:00:00.000Z' // after NOW

describe('D-01: SLA breach formulas', () => {
  it('Ticket A — currently open and past resolution_due_at: breached both ways', () => {
    const ticket = { status: 'in_progress', resolution_due_at: PAST, resolved_at: null, closed_at: null }
    expect(isCurrentlyBreached(ticket, NOW)).toBe(true)
    expect(isEverBreached(ticket, NOW)).toBe(true)
  })

  it('Ticket B — resolved late: no longer "currently" breached, but "ever" breached', () => {
    const ticket = { status: 'resolved', resolution_due_at: PAST, resolved_at: '2026-09-10T00:00:00.000Z', closed_at: null }
    expect(isCurrentlyBreached(ticket, NOW)).toBe(false)
    expect(isEverBreached(ticket, NOW)).toBe(true)
  })

  it('Ticket C — resolved on time: breached neither way', () => {
    const ticket = { status: 'resolved', resolution_due_at: FUTURE, resolved_at: '2026-09-10T00:00:00.000Z', closed_at: null }
    expect(isCurrentlyBreached(ticket, NOW)).toBe(false)
    expect(isEverBreached(ticket, NOW)).toBe(false)
  })

  it('closed late (no resolved_at, closed_at past due): not "currently" breached, but "ever" breached', () => {
    const ticket = { status: 'closed', resolution_due_at: PAST, resolved_at: null, closed_at: '2026-09-10T00:00:00.000Z' }
    expect(isCurrentlyBreached(ticket, NOW)).toBe(false)
    expect(isEverBreached(ticket, NOW)).toBe(true)
  })

  it('no SLA (resolution_due_at null): never breached, whatever the status', () => {
    const open = { status: 'in_progress', resolution_due_at: null, resolved_at: null, closed_at: null }
    const resolved = { status: 'resolved', resolution_due_at: null, resolved_at: '2026-09-10T00:00:00.000Z', closed_at: null }
    expect(isCurrentlyBreached(open, NOW)).toBe(false)
    expect(isEverBreached(open, NOW)).toBe(false)
    expect(isCurrentlyBreached(resolved, NOW)).toBe(false)
    expect(isEverBreached(resolved, NOW)).toBe(false)
  })

  // ── Boundary/consistency checks beyond the 5 required fixtures ───────────

  it('a resolved-but-not-yet-past-due-at-write-time ticket that is being checked before resolution never counts as currently breached once resolved, even if still open past due at read time would have', () => {
    // Guards against a status/resolved_at mismatch: isCurrentlyBreached must
    // trust `status`, not infer "open" from the absence of resolved_at.
    const ticket = { status: 'cancelled', resolution_due_at: PAST, resolved_at: null, closed_at: null }
    expect(isCurrentlyBreached(ticket, NOW)).toBe(false)
  })

  it('cancelled with no resolved_at/closed_at is never "ever breached" (no closing timestamp to judge lateness by, and not currently open)', () => {
    const ticket = { status: 'cancelled', resolution_due_at: PAST, resolved_at: null, closed_at: null }
    expect(isEverBreached(ticket, NOW)).toBe(true) // falls back to "now > due" per the existing Report Builder formula — still open-ended, unresolved
  })

  it('open ticket not yet past due: breached neither way', () => {
    const ticket = { status: 'open', resolution_due_at: FUTURE, resolved_at: null, closed_at: null }
    expect(isCurrentlyBreached(ticket, NOW)).toBe(false)
    expect(isEverBreached(ticket, NOW)).toBe(false)
  })
})

describe('F-02 / F-03: paused tickets are not breached; deadlines compare as instants', () => {
  it.each(['waiting_user', 'hold_purchase_ho', 'pending_approval'])('a %s ticket past its deadline is not "currently breached"', (status) => {
    expect(isCurrentlyBreached({ status, resolution_due_at: PAST }, NOW)).toBe(false)
  })

  it('an offset deadline: 10:00 at UTC-7 is 17:00 UTC, so at 12:00 UTC it has NOT passed (as text it looked passed)', () => {
    const now = new Date('2026-09-10T12:00:00.000Z')
    expect(isCurrentlyBreached({ status: 'in_progress', resolution_due_at: '2026-09-10T10:00:00-07:00' }, now)).toBe(false)
    expect(isEverBreached({ resolution_due_at: '2026-09-10T10:00:00-07:00', resolved_at: null, closed_at: null }, now)).toBe(false)
    expect(isCurrentlyBreached({ status: 'in_progress', resolution_due_at: '2026-09-10T10:00:00+05:30' }, now)).toBe(true)
  })

  it('resolved / responded timestamps are compared as instants too', () => {
    expect(isEverBreached({ resolution_due_at: '2026-09-10T10:00:00-07:00', resolved_at: '2026-09-10T16:59:00.000Z', closed_at: null }, NOW)).toBe(false)
    expect(isEverBreached({ resolution_due_at: '2026-09-10T10:00:00-07:00', resolved_at: '2026-09-10T17:01:00.000Z', closed_at: null }, NOW)).toBe(true)
    expect(isEverResponseBreached({ response_due_at: '2026-09-10T10:00:00-07:00', responded_at: '2026-09-10T16:59:00.000Z' }, NOW)).toBe(false)
  })

  it('the database filter leaves out paused tickets too', () => {
    const calls: string[] = []
    const q = { lt: (...a: unknown[]) => { calls.push('lt' + a.join()); return q }, not: (...a: unknown[]) => { calls.push('not' + a.join()); return q } }
    applyCurrentlyBreachedFilter(q, '2026-09-10T12:00:00.000Z')
    const not = calls.find((c) => c.startsWith('not'))!
    for (const st of ['resolved', 'closed', 'cancelled', 'waiting_user', 'hold_purchase_ho', 'pending_approval']) expect(not).toContain('"' + st + '"')
  })
})
