import { describe, it, expect } from 'vitest'
import { STATUS_LABELS as APP } from '@/lib/constants/requests'
import { STATUS_LABEL as EXECUTIVE, STATUS_ORDER } from '@/lib/reporting/executive/engine'
import { STATUS_LABELS as EXPORT } from '@/lib/export/reports'

describe('one list of ticket status names (D-049)', () => {
  it('exports never show a raw status word: every ticket status has the app\'s own name', () => {
    for (const [k, label] of Object.entries(APP)) expect(EXPORT[k], k).toBe(label)
    expect(EXPORT.assigned).toBe('Assigned')
    expect(EXPORT.waiting_user).toBe('Waiting on User')
  })
  it('keeps the words that belong to tasks, approvals and projects', () => {
    for (const k of ['todo', 'done', 'pending', 'approved', 'rejected', 'on_hold']) expect(EXPORT[k], k).toBeTruthy()
  })
  it('the executive dashboard uses the same names and order, except the one shorter Hold label it was designed with', () => {
    for (const [k, label] of Object.entries(APP)) expect(EXECUTIVE[k], k).toBe(k === 'hold_purchase_ho' ? 'Hold - Purchase from HO' : label)
    expect(STATUS_ORDER).toEqual(Object.keys(APP))
  })
})
