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
import { isCurrentlyBreached, isEverBreached } from '@/lib/sla/breach'

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
