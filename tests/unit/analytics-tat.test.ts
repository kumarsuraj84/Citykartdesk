/**
 * Consolidated remediation — item 1: negative average resolution time.
 *
 * Root cause (confirmed against live local data): lib/queries/analytics.ts's
 * `hours(a, b)` did a plain `b - a` subtraction with no guard, and two
 * QA fixture rows (QA-20260910-RECON-B-resolved-late,
 * QA-20260910-RECON-C-resolved-on-time) have resolved_at earlier than
 * created_at — a seed-data anomaly, not a real lifecycle state (every write
 * path in lib/actions/requests.ts sets resolved_at to "now" at the moment
 * of transition). That negative hour value flowed unguarded into every
 * avg/median/group TAT figure and rendered as "-90m" via fmtHours.
 *
 * Fix: `computeTatHours()` excludes non-finite/negative durations from every
 * aggregate and reports how many were excluded; `fmtHours()` is a second,
 * independent guard so a negative/non-finite value can never render as a
 * plausible-looking duration even if a future caller bypasses the analytics
 * layer's own guard.
 */
import { describe, it, expect } from 'vitest'
import { computeTatHours } from '@/lib/queries/analytics'
import { fmtHours } from '@/lib/utils/fmt'

describe('computeTatHours()', () => {
  it('a normal resolved ticket (multi-hour) produces its correct positive duration', () => {
    const { values, anomalies } = computeTatHours([
      { created_at: '2026-09-10T08:00:00.000Z', resolved_at: '2026-09-10T12:30:00.000Z' },
    ])
    expect(values).toEqual([4.5])
    expect(anomalies).toBe(0)
  })

  it('a same-minute resolve produces ~0 hours, not excluded as an anomaly', () => {
    const { values, anomalies } = computeTatHours([
      { created_at: '2026-09-10T08:00:00.000Z', resolved_at: '2026-09-10T08:00:30.000Z' },
    ])
    expect(values[0]).toBeGreaterThanOrEqual(0)
    expect(values[0]).toBeLessThan(0.02)
    expect(anomalies).toBe(0)
  })

  it('a multi-day resolve produces its correct hour count', () => {
    const { values, anomalies } = computeTatHours([
      { created_at: '2026-09-08T00:00:00.000Z', resolved_at: '2026-09-10T00:00:00.000Z' },
    ])
    expect(values).toEqual([48])
    expect(anomalies).toBe(0)
  })

  it('is timezone-offset-agnostic: two ISO timestamps at the same instant in different offsets agree', () => {
    const { values } = computeTatHours([
      { created_at: '2026-09-10T08:00:00.000Z', resolved_at: '2026-09-10T14:30:00.000+05:30' /* == 09:00:00Z */ },
    ])
    expect(values[0]).toBeCloseTo(1, 5)
  })

  it('excludes a resolved_at earlier than created_at (the confirmed live-data anomaly) instead of producing a negative value', () => {
    const { values, anomalies } = computeTatHours([
      // Mirrors QA-20260910-RECON-B-resolved-late: created after resolved.
      { created_at: '2026-09-10T07:45:35.706Z', resolved_at: '2026-09-10T05:45:35.621Z' },
    ])
    expect(values).toEqual([])
    expect(anomalies).toBe(1)
  })

  it('excludes a malformed/non-finite timestamp rather than propagating NaN', () => {
    const { values, anomalies } = computeTatHours([
      { created_at: 'not-a-date', resolved_at: '2026-09-10T05:45:35.621Z' },
    ])
    expect(values).toEqual([])
    expect(anomalies).toBe(1)
  })

  it('skips rows with no resolved_at at all (not an anomaly — just unresolved)', () => {
    const { values, anomalies } = computeTatHours([
      { created_at: '2026-09-10T07:45:35.706Z', resolved_at: null },
    ])
    expect(values).toEqual([])
    expect(anomalies).toBe(0)
  })

  it('a mixed batch only counts the true anomalies and averages only the valid rows', () => {
    const { values, anomalies } = computeTatHours([
      { created_at: '2026-09-10T08:00:00.000Z', resolved_at: '2026-09-10T10:00:00.000Z' }, // 2h, valid
      { created_at: '2026-09-10T07:45:35.706Z', resolved_at: '2026-09-10T05:45:35.621Z' }, // anomaly
      { created_at: '2026-09-10T08:00:00.000Z', resolved_at: '2026-09-10T09:00:00.000Z' }, // 1h, valid
    ])
    expect(values).toEqual([2, 1])
    expect(anomalies).toBe(1)
  })
})

describe('fmtHours() — defensive UI guard against impossible durations', () => {
  it('renders a normal sub-hour duration in minutes', () => {
    expect(fmtHours(0.5)).toBe('30m')
  })

  it('renders a normal multi-hour duration in hours', () => {
    expect(fmtHours(4.5)).toBe('4.5h')
  })

  it('renders a normal multi-day duration in days', () => {
    expect(fmtHours(48)).toBe('2.0d')
  })

  it('never renders a negative duration — falls back to the empty-state dash', () => {
    expect(fmtHours(-1.5)).toBe('—')
    expect(fmtHours(-0.01)).toBe('—')
  })

  it('never renders a non-finite duration', () => {
    expect(fmtHours(NaN)).toBe('—')
    expect(fmtHours(Infinity)).toBe('—')
  })

  it('renders null as the empty-state dash', () => {
    expect(fmtHours(null)).toBe('—')
  })
})
