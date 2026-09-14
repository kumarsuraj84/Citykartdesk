/**
 * DESK-UI-012 — Audit Log "Details" column showed raw JSON
 * (`{"reason":"unsatisfied_with_resolution"...}`) as the default view.
 * metadataSummary() now produces a concise, human-readable line for common
 * metadata shapes, falling back to a readable "Key: value" list for
 * anything else — the exact raw JSON stays available via the "View
 * details" expand + copy in AuditDetailsCell, so no audit fidelity is lost.
 */
import { describe, it, expect } from 'vitest'
import { metadataSummary } from '@/app/(app)/admin/audit/AuditLogClient'

describe('metadataSummary()', () => {
  it('a from/to transition (the most common shape, e.g. status_changed) reads as a sentence', () => {
    expect(metadataSummary({ to: 'open', from: 'resolved' })).toBe('Changed from "resolved" to "open"')
  })

  it('a lone reason field reads as "Reason: ..."', () => {
    expect(metadataSummary({ reason: 'unsatisfied_with_resolution' })).toBe('Reason: unsatisfied_with_resolution')
  })

  it('a lone step field reads as "Step N"', () => {
    expect(metadataSummary({ step: 1 })).toBe('Step 1')
  })

  it('empty metadata renders a dash, not "{}"', () => {
    expect(metadataSummary({})).toBe('—')
  })

  it('an unrecognized shape falls back to a readable "Key: value" list, not raw JSON', () => {
    const summary = metadataSummary({ team_id: 'team-1', via: 'business_rule' })
    expect(summary).toBe('Team id: team-1 · Via: business_rule')
    expect(summary).not.toContain('{')
    expect(summary).not.toContain('"')
  })

  it('a null/undefined/empty-string value renders as a dash, not "null"/"undefined"', () => {
    expect(metadataSummary({ note: null })).toBe('Note: —')
  })

  it('a boolean value renders as Yes/No, not "true"/"false"', () => {
    expect(metadataSummary({ was_overridden: true })).toBe('Was overridden: Yes')
  })

  it('a long unrecognized payload is capped, never grows unbounded', () => {
    const meta = { a: '1'.repeat(60), b: '2'.repeat(60), c: '3'.repeat(60), d: '4'.repeat(60) }
    const summary = metadataSummary(meta)
    expect(summary.length).toBeLessThanOrEqual(110)
  })

  it('more than 4 keys are truncated with an ellipsis rather than silently dropped without a hint', () => {
    const summary = metadataSummary({ a: 1, b: 2, c: 3, d: 4, e: 5 })
    expect(summary).toContain('…')
  })
})
