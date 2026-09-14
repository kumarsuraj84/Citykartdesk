/**
 * DESK-UI-003 — task priority label mismatch ("Medium" in the list,
 * "Normal" in the detail modal, for the same value). Fix: one shared
 * TASK_PRIORITY_LABELS map (lib/constants/tasks.ts), now imported by
 * TaskBadges.tsx, TaskTable.tsx, and TaskDetailPanel.tsx (the one that used
 * to say "Normal") instead of each hardcoding its own copy.
 */
import { describe, it, expect } from 'vitest'
import { TASK_PRIORITY_LABELS } from '@/lib/constants/tasks'

describe('TASK_PRIORITY_LABELS — canonical task priority display mapping', () => {
  it('has exactly the three real TaskPriority enum values, each with a defined label', () => {
    expect(Object.keys(TASK_PRIORITY_LABELS).sort()).toEqual(['high', 'low', 'medium'])
  })

  it('every value renders as a real label — this is the regression check for the reported bug', () => {
    expect(TASK_PRIORITY_LABELS.low).toBe('Low')
    expect(TASK_PRIORITY_LABELS.medium).toBe('Medium')
    expect(TASK_PRIORITY_LABELS.high).toBe('High')
  })

  it('never renders "Normal" for medium — the exact defect that made the list and detail views disagree', () => {
    expect(TASK_PRIORITY_LABELS.medium).not.toBe('Normal')
  })
})
