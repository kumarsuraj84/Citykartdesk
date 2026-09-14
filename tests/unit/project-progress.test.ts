/**
 * Consolidated remediation — item 2: Project analytics "Avg Progress" = 0%.
 *
 * Root cause: three independent call sites (ProjectHeader.tsx's progress
 * bar, the project detail page's currentProgressPct seed, and
 * projectAnalytics.ts's owner/org "Avg Progress" rollup) each derived a
 * project's completion percentage purely from `done / total` linked
 * tasks+requests, with no fallback when `total === 0`. A project explicitly
 * marked "done" (or "cancelled") by its owner but with zero linked
 * tasks/requests — a real, common shape in the live data (e.g. many
 * Citykart projects have "No open project tasks assigned yet") — always
 * reported a misleading 0%, regardless of its own status.
 *
 * Fix: lib/projects/progress.ts's computeProjectProgressPct() is the one
 * canonical rule now used by all three call sites — status 'done' and
 * 'cancelled' short-circuit to a fixed value; every other status keeps the
 * original child-item ratio.
 *
 * Pure-function tests only — no DB/fixtures needed, and per the
 * remediation brief's rule against mutating genuine project records, this
 * intentionally never touches real or QA project rows.
 */
import { describe, it, expect } from 'vitest'
import { computeProjectProgressPct } from '@/lib/projects/progress'

describe('computeProjectProgressPct()', () => {
  it('a done project with zero linked tasks/requests reports 100%, not 0% (the reported bug)', () => {
    expect(computeProjectProgressPct('done', { done: 0, total: 0 })).toBe(100)
  })

  it('a done project always reports 100% regardless of its child-item ratio', () => {
    // Even a done project with e.g. 1 of 4 items marked done in the child
    // tables (stale/partial task cleanup) should still read 100% — the
    // project's own status is the authoritative signal, not its children.
    expect(computeProjectProgressPct('done', { done: 1, total: 4 })).toBe(100)
  })

  it('a cancelled project reports 0% regardless of its child-item ratio', () => {
    expect(computeProjectProgressPct('cancelled', { done: 2, total: 4 })).toBe(0)
  })

  it('a cancelled project with zero linked items also reports 0% (not NaN/undefined)', () => {
    expect(computeProjectProgressPct('cancelled', { done: 0, total: 0 })).toBe(0)
  })

  it('a not_started project with no linked items reports 0%', () => {
    expect(computeProjectProgressPct('not_started', { done: 0, total: 0 })).toBe(0)
  })

  it('an in_progress project with 0 of 4 done reports 0%', () => {
    expect(computeProjectProgressPct('in_progress', { done: 0, total: 4 })).toBe(0)
  })

  it('an in_progress project with 2 of 4 done reports 50%', () => {
    expect(computeProjectProgressPct('in_progress', { done: 2, total: 4 })).toBe(50)
  })

  it('an in_progress project with 4 of 4 done reports 100% via the child-item ratio (status not yet flipped to done)', () => {
    expect(computeProjectProgressPct('in_progress', { done: 4, total: 4 })).toBe(100)
  })

  it('a blocked project follows the same child-item ratio as in_progress', () => {
    expect(computeProjectProgressPct('blocked', { done: 1, total: 4 })).toBe(25)
  })

  it('owner average across mixed project statuses: a Done project with no children no longer drags the average to 0', () => {
    // Owner has 3 projects: one Done (0 linked items — the exact reported
    // scenario), one in_progress at 50%, one not_started at 0%.
    const projects: Array<{ status: Parameters<typeof computeProjectProgressPct>[0]; done: number; total: number }> = [
      { status: 'done', done: 0, total: 0 },
      { status: 'in_progress', done: 2, total: 4 },
      { status: 'not_started', done: 0, total: 0 },
    ]
    const pcts = projects.map((p) => computeProjectProgressPct(p.status, p))
    expect(pcts).toEqual([100, 50, 0])
    const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
    // Previously: (0 + 50 + 0) / 3 = 17% (the Done project silently
    // contributed 0, exactly the "0% even for Done projects" symptom).
    // Now: (100 + 50 + 0) / 3 = 50%.
    expect(avg).toBe(50)
  })

  it('owner average with a cancelled project: cancelled correctly pulls the average down rather than being ignored', () => {
    const projects: Array<{ status: Parameters<typeof computeProjectProgressPct>[0]; done: number; total: number }> = [
      { status: 'done', done: 0, total: 0 },
      { status: 'cancelled', done: 3, total: 4 }, // would have been 75% under the old ratio-only rule
    ]
    const pcts = projects.map((p) => computeProjectProgressPct(p.status, p))
    expect(pcts).toEqual([100, 0])
  })
})
